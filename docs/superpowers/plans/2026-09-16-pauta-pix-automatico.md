# Pauta de migração para o PIX automático — plano de implementação

> **Para quem executa:** use `superpowers:subagent-driven-development` (recomendado) ou
> `superpowers:executing-plans`, tarefa por tarefa. Os passos usam caixinha (`- [ ]`).

**Objetivo:** o TOM passa a publicar, nos grupos das 3 unidades, a lista fatiada de clientes
que precisam migrar para o PIX automático, com lote diário no painel, baixa automática pela
fonte e relatório semanal de desempenho no grupo PIX AUTOMÁTICO L.A.

**Arquitetura:** camada pura (`src/services/pix-migracao.js`) decide ordem, lote e texto; o
ritual (`src/rituals/pix-migracao.js`) lê a RPC do LA Report e mexe no painel; o dispatcher
chama os dois nos horários que cada unidade já usa. Espelha a pauta de anamnese, inclusive na
forma de publicar (INSERT em `group_chat_messages`, que o bridge espelha no WhatsApp).

**Tecnologia:** Node.js, `node:test` nativo, Supabase JS, pm2 na VPS.

**Spec:** `docs/superpowers/specs/2026-09-16-pauta-pix-automatico-design.md`

## Restrições globais

- Fonte única: `get_pix_migracao_v1(p_unidade_id, p_fatia)` no LA Report, via `laReportClient`
  (service_role) **sempre** dentro de `consultaComRetry`, com `error` checado. Falha de fonte é
  falha-fechada: não publica número nenhum.
- Dado com mais de 48h (`dado_atualizado_em`) → não cobra; publica a linha de fonte velha.
- Prioridade das fatias, nesta ordem: `autorizacao_pendente`, `pix_avulso`, `cheque`, `boleto`,
  `dinheiro`, `cartao_com_falha`, `cartao_avulso`, `sem_historico`.
- Lote diário por unidade: 10 clientes. Teto de sanidade: 15 filhas por unidade por dia.
- Meta comunicada ao time: **31/10/2026**.
- Nada de telefone, CPF, e-mail, valor ou número de fatura no grupo. Só nome do pagador e dos
  alunos.
- Voz do TOM é sagrada: todo texto vem da camada pura, nunca do LLM.
- `marker_type` próprio: `'PAUTA_PIX'` (não colidir com o `like(reason)` de `PAUTA_ANAMNESE`).
- Testes ao lado do código. Suíte:
  `TEST_COLLAB_ID=5bf93a06-01b9-4927-a147-9b74b576e760 node --env-file=.env --test src/`.
  **Commit só depois de `grep -q "^# fail 0$"` no arquivo da suíte.**
- Deploy: `git pull --rebase` → `push` → `pm2 restart tom` com a árvore limpa.

## Arquivos

| Arquivo | Responsabilidade |
|---|---|
| `src/services/pix-migracao.js` (novo) | PURO: ordem das fatias, lote do dia, títulos, mensagem da unidade, relatório semanal, ritmo |
| `src/services/pix-migracao.test.js` (novo) | testes da camada pura |
| `src/rituals/pix-migracao.js` (novo) | lê a RPC, monta o pacote do dia, fecha quem saiu, devolve texto |
| `src/rituals/pix-migracao.test.js` (novo) | testes do ritual com `deps` injetáveis (sem banco) |
| `src/rituals/pix-pauta-harness.test.js` (novo) | harness: recorta o dispatcher como texto e prova o gatilho |
| `src/rituals/dispatcher.js` | 2 blocos novos: pauta diária por unidade e relatório semanal |
| `src/engine.js` | atalho "cadastrei o fulano no automático" |

---

### Tarefa 1: camada pura — fatias, lote do dia e títulos

**Arquivos:** criar `src/services/pix-migracao.js` e `src/services/pix-migracao.test.js`.

**Interfaces produzidas:**
`FATIAS` (array na ordem de prioridade), `ROTULO` (mapa fatia→`{emoji, nome}`),
`LOTE_DIARIO = 10`, `TETO_FILHAS = 15`, `META_YMD = '2026-10-31'`,
`fatiaDoCliente(linha) -> string`, `ordenarPorPrioridade(linhas) -> linhas`,
`loteDoDia(linhas, { tamanho }) -> linhas`, `contagemPorFatia(linhas) -> Map`,
`tituloDaFilha(linha) -> string`.

- [ ] **Passo 1: escrever o teste que falha**

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const p = require('./pix-migracao');

const c = (fatia, nome, extra = {}) => ({
  pagador_chave: `u:${nome}`, pagador_nome: nome, alunos: [nome + ' filho'],
  categoria: fatia === 'autorizacao_pendente' ? 'autorizacao_pendente' : 'migrar',
  fatia: fatia === 'autorizacao_pendente' ? null : fatia, ...extra,
});

test('autorização pendente vem antes do pix avulso, e o resto na ordem combinada', () => {
  const ordem = p.ordenarPorPrioridade([
    c('sem_historico', 'E'), c('cheque', 'C'), c('pix_avulso', 'B'),
    c('autorizacao_pendente', 'A'), c('boleto', 'D'),
  ]).map((x) => x.pagador_nome);
  assert.deepStrictEqual(ordem, ['A', 'B', 'C', 'D', 'E']);
});

test('dentro da mesma fatia, ordena por nome', () => {
  const ordem = p.ordenarPorPrioridade([c('pix_avulso', 'Zeca'), c('pix_avulso', 'Ana')])
    .map((x) => x.pagador_nome);
  assert.deepStrictEqual(ordem, ['Ana', 'Zeca']);
});

test('o lote do dia respeita o tamanho e mantém a prioridade', () => {
  const linhas = [...Array(30)].map((_, i) => c(i < 3 ? 'autorizacao_pendente' : 'pix_avulso', `N${String(i).padStart(2, '0')}`));
  const lote = p.loteDoDia(linhas, { tamanho: p.LOTE_DIARIO });
  assert.strictEqual(lote.length, 10);
  assert.strictEqual(lote.filter((x) => x.categoria === 'autorizacao_pendente').length, 3);
});

test('contagem por fatia inclui a autorização pendente como fatia própria', () => {
  const m = p.contagemPorFatia([c('pix_avulso', 'A'), c('pix_avulso', 'B'), c('autorizacao_pendente', 'C')]);
  assert.strictEqual(m.get('pix_avulso'), 2);
  assert.strictEqual(m.get('autorizacao_pendente'), 1);
});

test('título da filha leva o pagador e os alunos, sem telefone nem valor', () => {
  const t = p.tituloDaFilha({ ...c('pix_avulso', 'Maria'), alunos: ['João', 'Ana'] });
  assert.strictEqual(t, 'PIX automático — Maria (João, Ana)');
  assert.ok(!/\d{4}/.test(t));
});
```

- [ ] **Passo 2: rodar e ver falhar**

`cd /opt/LA-Organizer && node --env-file=.env --test src/services/pix-migracao.test.js`
Esperado: falha com "Cannot find module './pix-migracao'".

- [ ] **Passo 3: implementar o mínimo**

```js
'use strict';
// pix-migracao.js — pauta de migração para o PIX automático. PURO (sem I/O).
const FATIAS = ['autorizacao_pendente', 'pix_avulso', 'cheque', 'boleto', 'dinheiro',
  'cartao_com_falha', 'cartao_avulso', 'sem_historico'];
const ROTULO = {
  autorizacao_pendente: { emoji: '🔵', nome: 'Cadastrados sem cobrança' },
  pix_avulso: { emoji: '🔴', nome: 'Pix avulso' },
  cheque: { emoji: '🟠', nome: 'Cheque' },
  boleto: { emoji: '🟡', nome: 'Boleto' },
  dinheiro: { emoji: '🟡', nome: 'Dinheiro' },
  cartao_com_falha: { emoji: '🟣', nome: 'Cartão falhando' },
  cartao_avulso: { emoji: '🟣', nome: 'Maquininha' },
  sem_historico: { emoji: '⚪', nome: 'Sem histórico' },
};
const LOTE_DIARIO = 10;
const TETO_FILHAS = 15;
const META_YMD = '2026-10-31';

const fatiaDoCliente = (l) => (l.categoria === 'autorizacao_pendente' ? 'autorizacao_pendente' : (l.fatia || 'sem_historico'));
const ordenarPorPrioridade = (linhas) => [...(linhas || [])].sort((a, b) => {
  const d = FATIAS.indexOf(fatiaDoCliente(a)) - FATIAS.indexOf(fatiaDoCliente(b));
  return d !== 0 ? d : String(a.pagador_nome || '').localeCompare(String(b.pagador_nome || ''), 'pt-BR');
});
const loteDoDia = (linhas, { tamanho = LOTE_DIARIO } = {}) => ordenarPorPrioridade(linhas).slice(0, tamanho);
function contagemPorFatia(linhas) {
  const m = new Map();
  for (const l of linhas || []) { const f = fatiaDoCliente(l); m.set(f, (m.get(f) || 0) + 1); }
  return m;
}
const tituloDaFilha = (l) => `PIX automático — ${l.pagador_nome}${(l.alunos || []).length ? ` (${l.alunos.join(', ')})` : ''}`;

module.exports = { FATIAS, ROTULO, LOTE_DIARIO, TETO_FILHAS, META_YMD, fatiaDoCliente, ordenarPorPrioridade, loteDoDia, contagemPorFatia, tituloDaFilha };
```

- [ ] **Passo 4: rodar e ver passar** (mesmo comando do passo 2).

- [ ] **Passo 5: mutantes**

Escreva `scratchpad/loteNN/mutantes.js` no padrão da casa (restaura sempre) com 4 mutantes:
(1) remover `autorizacao_pendente` da frente de `FATIAS`; (2) trocar o `slice(0, tamanho)` por
`slice(0, 100)`; (3) tirar o desempate por nome; (4) fazer `fatiaDoCliente` devolver `l.fatia`
puro (perde o caso da autorização pendente, que tem `fatia` nula). Todos têm que dar `fail >= 1`.

- [ ] **Passo 6: commit**

```bash
git add src/services/pix-migracao.js src/services/pix-migracao.test.js
git commit -m "feat(pix): camada pura da pauta de migracao (fatias, lote, titulo)"
```

---

### Tarefa 2: camada pura — texto da pauta da unidade

**Arquivos:** modificar `src/services/pix-migracao.js` e `src/services/pix-migracao.test.js`.

**Interfaces consumidas:** `ROTULO`, `contagemPorFatia`, `loteDoDia`, `META_YMD`.
**Interfaces produzidas:** `mensagemDaUnidade({ unidadeNome, linhas, lote, dataBr, fonteVelha }) -> string`.

- [ ] **Passo 1: escrever o teste que falha**

```js
test('mensagem: cabeçalho com total e meta, lote por extenso, resto contado', () => {
  const linhas = [
    { pagador_chave: 'a', pagador_nome: 'Ana Lima', alunos: ['Rafa'], categoria: 'autorizacao_pendente', fatia: null },
    { pagador_chave: 'b', pagador_nome: 'Bruno Sá', alunos: ['Léo'], categoria: 'migrar', fatia: 'pix_avulso' },
    { pagador_chave: 'c', pagador_nome: 'Carla Dias', alunos: ['Tina'], categoria: 'migrar', fatia: 'cheque' },
  ];
  const txt = p.mensagemDaUnidade({ unidadeNome: 'Campo Grande', linhas, lote: linhas.slice(0, 2), dataBr: '16/09' });
  assert.match(txt, /^💠 \*PIX automático — Campo Grande\* · 3 clientes · meta 31\/10/);
  assert.match(txt, /🔵 \*Cadastrados sem cobrança\* \(1\) — resolver primeiro\n {3}• Ana Lima \(Rafa\)/);
  assert.match(txt, /🔴 \*Pix avulso\* \(1\)\n {3}• Bruno Sá \(Léo\)/);
  assert.match(txt, /🟠 Cheque \(1\)/, 'fatia fora do lote aparece contada');
  assert.ok(!txt.includes('Carla Dias'), 'quem não está no lote não é citado');
});

test('mensagem: fatia sem ninguém não aparece', () => {
  const txt = p.mensagemDaUnidade({ unidadeNome: 'Barra', linhas: [{ pagador_nome: 'X', alunos: [], categoria: 'migrar', fatia: 'pix_avulso', pagador_chave: 'x' }], lote: [], dataBr: '16/09' });
  assert.ok(!txt.includes('Cheque'));
});

test('mensagem: fonte velha não publica número, avisa', () => {
  const txt = p.mensagemDaUnidade({ unidadeNome: 'Barra', linhas: [], lote: [], dataBr: '16/09', fonteVelha: true });
  assert.match(txt, /não atualizou/i);
  assert.ok(!/\(\d+\)/.test(txt));
});
```

- [ ] **Passo 2: rodar e ver falhar** — `TypeError: p.mensagemDaUnidade is not a function`.

- [ ] **Passo 3: implementar**

```js
function mensagemDaUnidade({ unidadeNome, linhas, lote, dataBr, fonteVelha = false }) {
  const cab = `💠 *PIX automático — ${unidadeNome}*`;
  if (fonteVelha) return `${cab}\n_A fonte do LA Report não atualizou hoje — não vou cobrar número que não medi._`;
  const todas = linhas || [];
  const noLote = new Set((lote || []).map((l) => l.pagador_chave));
  const cont = contagemPorFatia(todas);
  const metaBr = META_YMD.slice(8, 10) + '/' + META_YMD.slice(5, 7);
  const linhasTxt = [`${cab} · ${todas.length} clientes · meta ${metaBr} · ${dataBr}`];
  const resumo = [];
  for (const f of FATIAS) {
    const n = cont.get(f) || 0;
    if (!n) continue;
    const doLote = ordenarPorPrioridade(todas.filter((l) => fatiaDoCliente(l) === f && noLote.has(l.pagador_chave)));
    if (!doLote.length) { resumo.push(`${ROTULO[f].emoji} ${ROTULO[f].nome} (${n})`); continue; }
    const extra = f === 'autorizacao_pendente' ? ' — resolver primeiro' : '';
    linhasTxt.push(`${ROTULO[f].emoji} *${ROTULO[f].nome}* (${n})${extra}\n`
      + doLote.map((l) => `   • ${l.pagador_nome}${(l.alunos || []).length ? ` (${l.alunos.join(', ')})` : ''}`).join('\n'));
  }
  if (resumo.length) linhasTxt.push(resumo.join(' · '));
  return linhasTxt.join('\n');
}
```

- [ ] **Passo 4: rodar e ver passar.**

- [ ] **Passo 5: mutantes** — (1) publicar todos os nomes em vez do lote; (2) ignorar
`fonteVelha`; (3) manter fatia com zero cliente. Todos precisam matar.

- [ ] **Passo 6: commit**

```bash
git add src/services/pix-migracao.js src/services/pix-migracao.test.js
git commit -m "feat(pix): texto da pauta por unidade (fatias hierarquicas, lote por extenso)"
```

---

### Tarefa 3: camada pura — relatório semanal

**Arquivos:** modificar `src/services/pix-migracao.js` e o teste.

**Interfaces produzidas:**
`barra(pct) -> string` (10 blocos, `▓`/`░`),
`ritmoNecessario({ faltam, hojeYmd, metaYmd }) -> { semanas, porSemana }`,
`relatorioSemanal({ unidades, periodoBr, hojeYmd }) -> string`, onde `unidades` é
`[{ nome, total, migrados, migradosNaSemana, pendentesAutorizacao }]`.

- [ ] **Passo 1: escrever o teste que falha**

```js
test('barra de progresso com 10 blocos', () => {
  assert.strictEqual(p.barra(0), '░░░░░░░░░░');
  assert.strictEqual(p.barra(58), '▓▓▓▓▓░░░░░');
  assert.strictEqual(p.barra(100), '▓▓▓▓▓▓▓▓▓▓');
});

test('ritmo necessário até a meta', () => {
  const r = p.ritmoNecessario({ faltam: 142, hojeYmd: '2026-10-19', metaYmd: '2026-10-31' });
  assert.strictEqual(r.semanas, 2);
  assert.strictEqual(r.porSemana, 71);
});

test('ritmo não divide por zero quando a meta já passou', () => {
  const r = p.ritmoNecessario({ faltam: 10, hojeYmd: '2026-11-05', metaYmd: '2026-10-31' });
  assert.strictEqual(r.semanas, 0);
  assert.strictEqual(r.porSemana, 10);
});

test('relatório semanal: geral, unidades, pendentes e ritmo', () => {
  const txt = p.relatorioSemanal({
    periodoBr: '13 a 19/10', hojeYmd: '2026-10-19',
    unidades: [
      { nome: 'Campo Grande', total: 226, migrados: 93, migradosNaSemana: 12, pendentesAutorizacao: 4 },
      { nome: 'Recreio', total: 76, migrados: 58, migradosNaSemana: 9, pendentesAutorizacao: 3 },
    ],
  });
  assert.match(txt, /💠 \*PIX automático — semana de 13 a 19\/10\*/);
  assert.match(txt, /Geral\s+▓+░*\s+50%\s+\(151 de 302\)/);
  assert.match(txt, /Campo Grande .*41% \(93\/226\) — 12 nesta semana/);
  assert.match(txt, /🔵 Cadastrados sem cobrança: 7/);
  assert.match(txt, /Ritmo: faltam 2 semanas e 151 clientes → 76 por semana/);
  assert.ok(!/•/.test(txt), 'relatório semanal não lista nomes');
});
```

- [ ] **Passo 2: rodar e ver falhar.**

- [ ] **Passo 3: implementar**

```js
const barra = (pct) => { const c = Math.max(0, Math.min(10, Math.round(Number(pct) / 10))); return '▓'.repeat(c) + '░'.repeat(10 - c); };
function ritmoNecessario({ faltam, hojeYmd, metaYmd = META_YMD }) {
  const dias = Math.ceil((Date.parse(metaYmd + 'T00:00:00-03:00') - Date.parse(hojeYmd + 'T00:00:00-03:00')) / 86400000);
  const semanas = Math.max(0, Math.ceil(dias / 7));
  return { semanas, porSemana: semanas ? Math.ceil(faltam / semanas) : faltam };
}
function relatorioSemanal({ unidades, periodoBr, hojeYmd }) {
  const us = unidades || [];
  const total = us.reduce((s, u) => s + u.total, 0);
  const migrados = us.reduce((s, u) => s + u.migrados, 0);
  const pend = us.reduce((s, u) => s + (u.pendentesAutorizacao || 0), 0);
  const pct = total ? Math.round((migrados / total) * 100) : 0;
  const faltam = total - migrados;
  const r = ritmoNecessario({ faltam, hojeYmd });
  const linhas = [`💠 *PIX automático — semana de ${periodoBr}*`,
    `Geral  ${barra(pct)}  ${pct}%  (${migrados} de ${total}) · meta ${META_YMD.slice(8, 10)}/${META_YMD.slice(5, 7)}`];
  for (const u of us) {
    const p2 = u.total ? Math.round((u.migrados / u.total) * 100) : 0;
    linhas.push(`${u.nome} ${barra(p2)} ${p2}% (${u.migrados}/${u.total}) — ${u.migradosNaSemana} nesta semana`);
  }
  if (pend) linhas.push(`🔵 Cadastrados sem cobrança: ${pend}`);
  linhas.push(`Ritmo: faltam ${r.semanas} semanas e ${faltam} clientes → ${r.porSemana} por semana.`);
  return linhas.join('\n');
}
```

- [ ] **Passo 4: rodar e ver passar.**

- [ ] **Passo 5: mutantes** — (1) `Math.round` → `Math.floor` na barra; (2) semanas sem
`Math.max(0,...)`; (3) relatório citando nomes. Todos precisam matar.

- [ ] **Passo 6: commit**

```bash
git add src/services/pix-migracao.js src/services/pix-migracao.test.js
git commit -m "feat(pix): relatorio semanal puro (barra, percentual, ritmo ate a meta)"
```

---

### Tarefa 4: ritual — ler a fonte, montar o lote, fechar quem saiu

**Arquivos:** criar `src/rituals/pix-migracao.js` e `src/rituals/pix-migracao.test.js`.

**Interfaces consumidas:** camada pura da Tarefa 1–2; `consultaComRetry` de
`src/lib/consulta-com-retry.js`; `createTaskGroup` de `src/services/task-groups.js`
(`{ supabase, groupId, createdBy, input: { title, recurrence, groupDueDate, subtasks } }`).

**Interfaces produzidas:**
`PREFIXO_CONTAINER = '💠 PIX automático — migrar · '`,
`pautaPixDaUnidade({ supabase, laReport, unidadeId, unidadeNome, groupId, criadoPor, hoje, deps = {} })`
→ `{ criou, jaExistia, total, lote, fechadas, texto, motivo, fonteVelha }`.

Regras: (1) `error` da RPC → `{ motivo }` e nada mais; (2) `dado_atualizado_em` com mais de 48h
→ `fonteVelha: true`, sem criar pacote; (3) antes de criar o lote do dia, fecha as filhas do
pacote de ontem cujo `pagador_chave` não está mais em `migrar`/`autorizacao_pendente`;
(4) teto: nunca cria mais que `TETO_FILHAS` filhas.

- [ ] **Passo 1: escrever o teste que falha** (sem banco, com `deps` e `laReport` falsos)

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const r = require('./pix-migracao');

const linha = (nome, fatia, cat = 'migrar') => ({ pagador_chave: 'k-' + nome, pagador_nome: nome, alunos: [nome], categoria: cat, fatia, dado_atualizado_em: new Date().toISOString() });
const laReportOk = (linhas) => ({ rpc: async () => ({ data: linhas, error: null }) });

test('monta o lote do dia e devolve o texto', async () => {
  const criadas = [];
  const out = await r.pautaPixDaUnidade({
    supabase: null, laReport: laReportOk([linha('Ana', 'pix_avulso'), linha('Bia', null, 'autorizacao_pendente')]),
    unidadeId: 'u1', unidadeNome: 'Barra', groupId: 'g1', criadoPor: 'c1', hoje: '2026-09-16',
    deps: { pacoteExiste: async () => false, criarPacote: async ({ input }) => { criadas.push(...input.subtasks); return { groupId: 'm1' }; }, filhasPendentes: async () => [], fecharFilha: async () => {} },
  });
  assert.strictEqual(out.criou, true);
  assert.strictEqual(out.total, 2);
  assert.strictEqual(criadas.length, 2);
  assert.match(out.texto, /💠 \*PIX automático — Barra\*/);
  assert.match(criadas[0].title, /^PIX automático — Bia/, 'autorização pendente entra primeiro');
});

test('fonte falhou: não cria nada e diz o motivo', async () => {
  const out = await r.pautaPixDaUnidade({ supabase: null, laReport: { rpc: async () => ({ data: null, error: { message: 'timeout' } }) }, unidadeId: 'u1', unidadeNome: 'Barra', groupId: 'g1', criadoPor: 'c1', hoje: '2026-09-16', deps: { pacoteExiste: async () => false, criarPacote: async () => { throw new Error('não podia criar'); } } });
  assert.strictEqual(out.criou, false);
  assert.match(out.motivo, /LA Report/);
});

test('fonte velha (mais de 48h): avisa e não cria pacote', async () => {
  const velha = { ...linha('Ana', 'pix_avulso'), dado_atualizado_em: new Date(Date.now() - 72 * 3600e3).toISOString() };
  const out = await r.pautaPixDaUnidade({ supabase: null, laReport: laReportOk([velha]), unidadeId: 'u1', unidadeNome: 'Barra', groupId: 'g1', criadoPor: 'c1', hoje: '2026-09-16', deps: { pacoteExiste: async () => false, criarPacote: async () => { throw new Error('não podia criar'); } } });
  assert.strictEqual(out.fonteVelha, true);
  assert.strictEqual(out.criou, false);
  assert.match(out.texto, /não atualizou/i);
});

test('quem saiu da lista tem a filha fechada', async () => {
  const fechadas = [];
  const out = await r.pautaPixDaUnidade({
    supabase: null, laReport: laReportOk([linha('Ana', 'pix_avulso')]),
    unidadeId: 'u1', unidadeNome: 'Barra', groupId: 'g1', criadoPor: 'c1', hoje: '2026-09-16',
    deps: { pacoteExiste: async () => true, criarPacote: async () => { throw new Error('já existe'); },
      filhasPendentes: async () => [{ id: 't1', title: 'PIX automático — Ana (Ana)' }, { id: 't2', title: 'PIX automático — Zeca (Zeca)' }],
      fecharFilha: async (id) => fechadas.push(id) },
  });
  assert.deepStrictEqual(fechadas, ['t2'], 'só fecha quem não está mais na fonte');
  assert.strictEqual(out.fechadas, 1);
});

test('teto de sanidade: nunca cria mais que TETO_FILHAS', async () => {
  const muitos = [...Array(40)].map((_, i) => linha('N' + i, 'pix_avulso'));
  let n = 0;
  await r.pautaPixDaUnidade({ supabase: null, laReport: laReportOk(muitos), unidadeId: 'u1', unidadeNome: 'Barra', groupId: 'g1', criadoPor: 'c1', hoje: '2026-09-16',
    deps: { pacoteExiste: async () => false, criarPacote: async ({ input }) => { n = input.subtasks.length; return { groupId: 'm1' }; }, filhasPendentes: async () => [], fecharFilha: async () => {} } });
  assert.ok(n <= require('../services/pix-migracao').TETO_FILHAS);
});
```

- [ ] **Passo 2: rodar e ver falhar** — `Cannot find module './pix-migracao'`.

- [ ] **Passo 3: implementar** o ritual com `deps` injetáveis e os padrões reais:
`consultaComRetry(() => laReport.rpc('get_pix_migracao_v1', { p_unidade_id: unidadeId, p_fatia: null }))`;
filtrar `categoria in ('migrar','autorizacao_pendente')`; `deps.pacoteExiste` consultando `tasks`
por `assigned_group_id + due_date + is_group=true + title = PREFIXO_CONTAINER + DD/MM`;
`deps.criarPacote` = `createTaskGroup`; `deps.filhasPendentes` listando filhas `status='pending'`
do container de hoje/ontem; `deps.fecharFilha` marcando `status='done'`. O texto sai de
`mensagemDaUnidade`. Nenhum `whatsapp.sendMessage` aqui — o ritual só devolve o texto.

- [ ] **Passo 4: rodar e ver passar.**

- [ ] **Passo 5: mutantes** — (1) não checar `error` da RPC; (2) ignorar o teto; (3) fechar
filha que ainda está na fonte; (4) criar pacote mesmo com fonte velha.

- [ ] **Passo 6: commit**

```bash
git add src/rituals/pix-migracao.js src/rituals/pix-migracao.test.js
git commit -m "feat(pix): ritual da pauta (fonte, lote do dia, baixa de quem saiu)"
```

---

### Tarefa 5: dispatcher — publicar a pauta no horário de cada unidade

**Arquivos:** modificar `src/rituals/dispatcher.js`; criar `src/rituals/pix-pauta-harness.test.js`.

O bloco novo vai **logo depois** do bloco da fala de abertura da anamnese (hoje em ~L4456), no
mesmo slot por unidade (`horaDeAberturaDaUnidade`), publicando uma segunda mensagem no grupo.
Decisão registrada: mensagem própria, não dentro da mensagem da anamnese — assim não se mexe
no texto da anamnese nem nas catracas dele.

- [ ] **Passo 1: escrever o harness que falha**

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const D = fs.readFileSync(path.join(__dirname, 'dispatcher.js'), 'utf8');
const umaVez = (s) => { const n = D.split(s).length - 1; assert.strictEqual(n, 1, `âncora "${s}" apareceu ${n}x`); return true; };

test('a pauta do PIX roda no horário de abertura de cada unidade', () => {
  umaVez("const _pixHoras = _pautaAbertura.horariosDeAberturaDoDia(_pautaDiaSemana);");
  umaVez("const _pixHoraDaUnidade = _pautaAbertura.horaDeAberturaDaUnidade(situAl.nomeDaUnidade(unidadeId), _pautaDiaSemana);");
});

test('idempotência com marcador próprio, sem colidir com a anamnese', () => {
  umaVez("marker_type: 'PAUTA_PIX'");
  umaVez("const _pixChave = `pauta_pix:${unidadeId}:${now.ymd}`;");
  assert.ok(!/PAUTA_PIX[\s\S]{0,400}PAUTA_ANAMNESE'/.test(D), 'o bloco do PIX não pode ler o marcador da anamnese');
});

test('publica no grupo pelo mesmo caminho da anamnese (group_chat_messages)', () => {
  const i = D.indexOf('const _pixChave');
  const trecho = D.slice(i, i + 4000);
  assert.ok(trecho.includes("from('group_chat_messages')"), 'a pauta do PIX precisa ir pelo group_chat_messages');
  assert.ok(!trecho.includes('whatsapp.sendMessage'), 'envio cru no ritual quebra a trava de quiet gates');
});

test('force novo está na whitelist', () => {
  umaVez("'pauta_pix'");
});
```

- [ ] **Passo 2: rodar e ver falhar** — as âncoras aparecem 0 vezes.

- [ ] **Passo 3: implementar o bloco** no dispatcher, no padrão dos 6 blocos existentes:
`try/catch por unidade`, busca do grupo por `la_report_unidade_id` com `wa_group_jid` não nulo,
consulta de idempotência em `marker_logs` (`marker_type: 'PAUTA_PIX'`, `like(reason, '<chave>%')`,
`in('result', ['executed','skipped'])`), chamada de `pautaPixDaUnidade`, INSERT do texto em
`group_chat_messages` (`role:'tom'`, `kind:'text'`, `channel:'app'`) com a mesma guarda por
cabeçalho usada na anamnese, e `marker_logs` no fim com
`reason: \`${_pixChave} total=${r.total} lote=${r.lote.length} fech=${r.fechadas}${r.motivo ? ' erro=' + r.motivo : ''}\`.slice(0,300)`
e `result` `'executed'` / `'fallback'` (fonte falhou) / `'skipped'` (domingo ou sem cliente).
Adicionar `'pauta_pix'` à whitelist de `opts.force` (~L3857).

- [ ] **Passo 4: rodar o harness e ver passar** e conferir no ar com
`node --env-file=.env scripts/dispatcher-run.js --force pauta_pix` (ou o equivalente do repo)
em horário fora de expediente, com o grupo QA.

- [ ] **Passo 5: commit**

```bash
git add src/rituals/dispatcher.js src/rituals/pix-pauta-harness.test.js
git commit -m "feat(pix): pauta do PIX publicada no horario de abertura de cada unidade"
```

---

### Tarefa 6: dispatcher — relatório semanal no grupo do PIX

**Arquivos:** modificar `src/rituals/dispatcher.js`; teste no mesmo harness da Tarefa 5.

**Pré-requisito:** o grupo **PIX AUTOMÁTICO L.A** precisa existir em `work_groups` com
`wa_group_jid` preenchido e um `slug` estável (`pix-automatico`). Se não existir, o bloco
registra `fallback` com o motivo e não falha calado.

- [ ] **Passo 1: escrever o teste que falha**

```js
test('relatório semanal do PIX: segunda às 10h, no grupo pix-automatico', () => {
  umaVez("const _pixRelatorioSlot = timeToSlot('10:00');");
  umaVez("now.dow === 1 && _pixRelatorioSlot === slotNow");
  umaVez("eq('slug', 'pix-automatico')");
  umaVez("const _pixRelChave = `pix_relatorio:${now.ymd}`;");
});
```

- [ ] **Passo 2: rodar e ver falhar.**

- [ ] **Passo 3: implementar**: bloco `if (opts.force === 'pix_relatorio' || (now.dow === 1 && _pixRelatorioSlot === slotNow))`,
lendo as 3 unidades pela RPC (uma chamada por unidade, sem `p_fatia`), montando
`{ nome, total, migrados, migradosNaSemana, pendentesAutorizacao }` — `migrados` conta
`categoria='ja_migrou'`, `migradosNaSemana` conta `migrou_em >= hoje-7d`, `total` = migrados +
a migrar + pendentes — e publicando `relatorioSemanal(...)` no grupo do PIX por
`group_chat_messages`. Idempotência por `marker_logs` (`PAUTA_PIX`, chave `pix_relatorio:<ymd>`).
Adicionar `'pix_relatorio'` à whitelist do `opts.force`.

- [ ] **Passo 4: rodar o harness e ver passar.**

- [ ] **Passo 5: commit**

```bash
git add src/rituals/dispatcher.js src/rituals/pix-pauta-harness.test.js
git commit -m "feat(pix): relatorio semanal de migracao no grupo do PIX (segunda 10h)"
```

---

### Tarefa 7: engine — atalho "cadastrei o fulano no automático"

**Arquivos:** modificar `src/engine.js`; criar `src/lib/pix-cadastro-informado.js` e
`src/lib/pix-cadastro-informado.test.js`.

**Interfaces produzidas:** `detectarCadastroInformado(texto) -> { nome } | null`,
`textoCadastroInformado(nome) -> string`.

- [ ] **Passo 1: escrever o teste que falha**

```js
const c = require('./pix-cadastro-informado');
test('reconhece o aviso de cadastro no automático', () => {
  assert.deepStrictEqual(c.detectarCadastroInformado('cadastrei a Ana Lima no pix automático'), { nome: 'Ana Lima' });
  assert.deepStrictEqual(c.detectarCadastroInformado('coloquei o Bruno Sá no PIX automático'), { nome: 'Bruno Sá' });
  assert.strictEqual(c.detectarCadastroInformado('o pix automático é bom'), null);
  assert.strictEqual(c.detectarCadastroInformado('cadastrei a Ana no sistema'), null);
});
test('o texto avisa que a confirmação vem da fonte', () => {
  const t = c.textoCadastroInformado('Ana Lima');
  assert.match(t, /Ana Lima/);
  assert.match(t, /confiro (na|no) (fonte|Emusys)/i);
});
```

- [ ] **Passo 2: rodar e ver falhar.**

- [ ] **Passo 3: implementar** a lib pura (regex sobre fala curta, sem `\b` colado em vogal
acentuada) e, no `engine.js`, um interceptador **antes do LLM**: acha a filha pendente cujo
título casa o nome (`ilike`), marca `status='done'`, grava
`logMarker(collab.id, 'PIX_CADASTRO', 'executed', \`informado:${pagadorChave}\`, null)` e responde
com `textoCadastroInformado`. Se não achar a tarefa, **não** dá baixa: responde que não achou
(pergunta não é falha).

- [ ] **Passo 4: rodar e ver passar.**

- [ ] **Passo 5: reabertura em 7 dias** — no ritual da Tarefa 4, antes de montar o lote:
quem tem `PIX_CADASTRO` informado há mais de 7 dias e **continua** em `migrar` na fonte volta
para o lote, com a filha recriada e a linha honesta no texto
("_você me disse que cadastrou, mas o Emusys ainda não mostra_"). Teste com `deps` falsos e
relógio injetado.

- [ ] **Passo 6: commit**

```bash
git add src/lib/pix-cadastro-informado.js src/lib/pix-cadastro-informado.test.js src/engine.js src/rituals/pix-migracao.js src/rituals/pix-migracao.test.js
git commit -m "feat(pix): atalho de baixa informada com reconferencia na fonte em 7 dias"
```

---

### Tarefa 8: E2E, suíte, deploy e registro

- [ ] **Passo 1: E2E** em `scratchpad/loteNN/e2e.js`, pelo `processMessage` real no perfil QA
`5bf93a06-01b9-4927-a147-9b74b576e760`, com `ai/provider.chat` simulado e
`whatsapp.sendMessage`/`sendVoice` interceptados: (1) "cadastrei a Fulana no pix automático" dá
baixa na filha e responde o texto do sistema; (2) nome que não está na lista não dá baixa.
Grupo do teste tem que ter `wa_group_jid` nulo — nunca envio real.

- [ ] **Passo 2: pauta no grupo QA** — rodar `--force pauta_pix` apontando para o grupo QA e
conferir o texto publicado em `group_chat_messages` (sem espelhar no WhatsApp, porque o jid é
nulo).

- [ ] **Passo 3: suíte inteira**

```bash
TEST_COLLAB_ID=5bf93a06-01b9-4927-a147-9b74b576e760 node --env-file=.env --test src/ > /tmp/suite.txt 2>&1; grep -E "^# (tests|pass|fail)" /tmp/suite.txt
```

- [ ] **Passo 4: commit gateado e deploy**

```bash
grep -q "^# fail 0$" /tmp/suite.txt && git add -u && git commit -m "feat(pix): pauta de migracao para o PIX automatico" && git pull --rebase && git push && pm2 restart tom
```

- [ ] **Passo 5: registrar** — KI/ADR curto em `tom_known_issues` não se aplica (não é bug);
registrar no `docs/ops/` a retomada do dia com os SHAs, e anotar na memória o desenho da baixa
pela fonte e o pré-requisito do grupo do PIX.

---

## Autorrevisão

- **Cobertura da spec:** prioridade e fatias (T1, T2), baixa pela fonte em duas etapas (T4),
  atalho com reconferência (T7), lote diário de 10 (T1, T4), pauta na cadência de cada unidade
  (T5), relatório semanal com meta e ritmo (T3, T6), guardas de fonte velha e teto (T2, T4),
  privacidade (T1, T2, T3 — testes provam que não há número de telefone nem nomes no
  relatório), pré-requisito do grupo (T6).
- **Sem placeholders:** todo passo tem comando ou código.
- **Nomes conferidos entre tarefas:** `mensagemDaUnidade`, `relatorioSemanal`, `loteDoDia`,
  `TETO_FILHAS`, `pautaPixDaUnidade`, `PREFIXO_CONTAINER`, `PIX_CADASTRO`, `PAUTA_PIX`,
  `pauta_pix`, `pix_relatorio`.
- **Ponto de atenção conhecido:** a fonte tem até 24h de atraso (espelho diário do Emusys);
  quem cadastra hoje some da lista amanhã — é o que o atalho da T7 cobre.
