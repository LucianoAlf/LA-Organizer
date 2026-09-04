# Pauta de Anamnese — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Todo dia de manhã o TOM monta, nas três unidades, a pauta dos alunos que têm aula hoje e estão sem anamnese; à noite fecha a pauta lendo a fonte e escala quem já falhou três vezes.

**Architecture:** Um módulo de funções PURAS (`anamnese-pauta.js`) decide tudo — quem entra, em que ordem, que degrau da escada, que texto sai. Um repositório fino (`anamnese-pauta-repo.js`) fala com a tabela nova. Um ritual (`rituals/anamnese-pauta.js`) orquestra e é o único que toca RPC, `tasks` e `group_chat_messages`. O dispatcher só chama nos dois slots. Reusa `createTaskGroup` (container + filhas) e `filtrarPorRecorte` (fonte única de "sem anamnese") em vez de reimplementar.

**Tech Stack:** Node 20 (CommonJS), `node:test` + `node:assert`, Supabase JS (`@supabase/supabase-js`), PostgREST. Sem framework de teste externo.

**Spec:** `docs/superpowers/specs/2026-09-03-pauta-de-anamnese-design.md`

## Global Constraints

- **Suíte baseline: 3539 testes, 3 falhas** — as três de `system-loadout` (`operational: passar loadout full == não passar loadout`, `conversational: é o prefixo-voz EXATO do full`, `conversational: ctx devolvido é ÍNTEGRO`). Qualquer outra falha é regressão.
- Rodar a suíte com `node --env-file=.env --test src/` a partir de `/opt/LA-Organizer` na VPS.
- **Nunca envio real no teste.** E2E só em grupo sombra com `wa_group_jid = NULL` — o bridge-out (`runOutboundOnce`) só varre grupos com jid, então a trava é estrutural. O harness DEVE abortar se o grupo tiver jid.
- **`situacao-aluno.filtrarPorRecorte(pessoas, 'anamnese')` é a única definição de "sem anamnese".** Nunca reimplementar o filtro.
- **`marker_logs.result` aceita só `executed` | `rejected` | `skipped` | `fallback`.** `pending` viola o CHECK constraint (medido em 03/09).
- **Sempre checar `error` de toda chamada Supabase.** Consulta com coluna errada devolve `{data:null,error}` e vira "zero linhas" silencioso — foi a causa de dois erros de diagnóstico em 03/09.
- Fuso da casa é `America/Sao_Paulo` (UTC−3). O dia da pauta é o dia em BRT.
- Deploy: commit + push + `pm2 restart tom` na VPS. A cópia da VPS É produção.
- `git add` com caminhos explícitos, nunca `-A` (o repo abriga o HOME dos agentes).

---

### Task 1: Tabela `anamnese_pauta` e o repositório

**Files:**
- Create: `migrations/20260904_anamnese_pauta.sql`
- Create: `src/services/anamnese-pauta-repo.js`
- Test: `src/services/anamnese-pauta-repo.test.js`

**Interfaces:**
- Consumes: nada (primeira task).
- Produces:
  - `registrarAparicoes(sb, { unidadeId, dia, pessoas })` → `Promise<{gravadas:number, erro:string|null}>` — `pessoas` é array de `pessoa_chave` (string). Idempotente por `(unidade_id, pessoa_chave, dia)`.
  - `gravarResultado(sb, { unidadeId, dia, pessoaChave, resultado })` → `Promise<boolean>` — `resultado` ∈ `'preencheu'|'nao_preencheu'|'sem_verificacao'`.
  - `contarFalhas(sb, { unidadeId, pessoas })` → `Promise<Map<string, number>>` — quantas linhas `nao_preencheu` cada `pessoa_chave` tem. `null` em caso de erro de leitura (NUNCA Map vazio, que se confundiria com "ninguém falhou").

- [ ] **Step 1: Escrever a migration**

Criar `migrations/20260904_anamnese_pauta.sql`:

```sql
-- PAUTA DE ANAMNESE (spec 2026-09-03)
-- Livro de APARIÇÕES: uma linha por aluno por dia em que ele entrou na pauta do dia.
-- O `resultado` é gravado na passada da noite, lendo a fonte (LA Report).
-- Por que tabela e não as tarefas arquivadas: o título da tarefa carrega o NOME, e nome não é
-- chave (23 "Maria" só no Recreio). `pessoa_chave` é a chave canônica da RPC.
-- 'sem_verificacao' existe porque dia em que a RPC caiu NÃO pode contar contra o aluno.
CREATE TABLE IF NOT EXISTS public.anamnese_pauta (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  unidade_id    uuid NOT NULL,
  pessoa_chave  text NOT NULL,
  dia           date NOT NULL,
  resultado     text,          -- preencheu | nao_preencheu | sem_verificacao | null (dia em curso)
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- A chave que impede linha dupla quando o ritual roda duas vezes no mesmo slot.
CREATE UNIQUE INDEX IF NOT EXISTS anamnese_pauta_uq
  ON public.anamnese_pauta (unidade_id, pessoa_chave, dia);

-- A contagem da escada lê por (unidade, pessoa) filtrando resultado.
CREATE INDEX IF NOT EXISTS anamnese_pauta_escada_idx
  ON public.anamnese_pauta (unidade_id, pessoa_chave, resultado);
```

Sem CHECK em `resultado` de propósito: CHECK em coluna de texto vira drift código↔banco (lição `FIN-INVOICE-INTENT-KIND-CONSTRAINT`, e o `marker_logs_result_check` que me mordeu em 03/09).

- [ ] **Step 2: Escrever o teste que falha**

Criar `src/services/anamnese-pauta-repo.test.js`:

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { registrarAparicoes, gravarResultado, contarFalhas } = require('./anamnese-pauta-repo');

// supabase de mentira: encadeável, guarda o que foi escrito, devolve o que mandarmos
function fakeSb({ rows = [], erro = null } = {}) {
  const escritas = [];
  const api = {
    _escritas: escritas,
    from() { return api; },
    insert(v) { escritas.push({ op: 'insert', v }); return api; },
    update(v) { escritas.push({ op: 'update', v }); return api; },
    upsert(v, o) { escritas.push({ op: 'upsert', v, o }); return api; },
    select() { return api; },
    eq(c, v) { escritas.push({ op: 'eq', c, v }); return api; },
    in() { return api; },
    then(res) { return Promise.resolve({ data: rows, error: erro }).then(res); },
  };
  return api;
}

test('registrarAparicoes grava uma linha por pessoa, idempotente', async () => {
  const sb = fakeSb();
  const r = await registrarAparicoes(sb, { unidadeId: 'u1', dia: '2026-09-10', pessoas: ['pk1', 'pk2'] });
  assert.strictEqual(r.erro, null);
  assert.strictEqual(r.gravadas, 2);
  const up = sb._escritas.find((e) => e.op === 'upsert');
  assert.ok(up, 'usa upsert — o ritual pode rodar duas vezes no mesmo slot');
  assert.strictEqual(up.o.onConflict, 'unidade_id,pessoa_chave,dia');
});

test('registrarAparicoes com lista vazia não escreve nada', async () => {
  const sb = fakeSb();
  const r = await registrarAparicoes(sb, { unidadeId: 'u1', dia: '2026-09-10', pessoas: [] });
  assert.strictEqual(r.gravadas, 0);
  assert.strictEqual(sb._escritas.length, 0);
});

test('erro de escrita é DITO, não engolido', async () => {
  const sb = fakeSb({ erro: { message: 'boom' } });
  const r = await registrarAparicoes(sb, { unidadeId: 'u1', dia: '2026-09-10', pessoas: ['pk1'] });
  assert.strictEqual(r.gravadas, 0);
  assert.match(r.erro, /boom/);
});

test('contarFalhas conta só nao_preencheu, por pessoa', async () => {
  const sb = fakeSb({ rows: [
    { pessoa_chave: 'pk1', resultado: 'nao_preencheu' },
    { pessoa_chave: 'pk1', resultado: 'nao_preencheu' },
    { pessoa_chave: 'pk2', resultado: 'nao_preencheu' },
  ] });
  const m = await contarFalhas(sb, { unidadeId: 'u1', pessoas: ['pk1', 'pk2', 'pk3'] });
  assert.strictEqual(m.get('pk1'), 2);
  assert.strictEqual(m.get('pk2'), 1);
  assert.strictEqual(m.get('pk3') || 0, 0);
});

// Map vazio significa "ninguém falhou". Erro de leitura NÃO pode dizer isso.
test('contarFalhas devolve null em erro de leitura, nunca Map vazio', async () => {
  const sb = fakeSb({ erro: { message: 'timeout' } });
  assert.strictEqual(await contarFalhas(sb, { unidadeId: 'u1', pessoas: ['pk1'] }), null);
});

test('gravarResultado carimba o resultado e devolve false em erro', async () => {
  const ok = fakeSb();
  assert.strictEqual(await gravarResultado(ok, { unidadeId: 'u1', dia: '2026-09-10', pessoaChave: 'pk1', resultado: 'preencheu' }), true);
  const ruim = fakeSb({ erro: { message: 'x' } });
  assert.strictEqual(await gravarResultado(ruim, { unidadeId: 'u1', dia: '2026-09-10', pessoaChave: 'pk1', resultado: 'preencheu' }), false);
});
```

- [ ] **Step 3: Rodar e ver falhar**

```bash
ssh tom "cd /opt/LA-Organizer && node --env-file=.env --test src/services/anamnese-pauta-repo.test.js"
```
Esperado: FALHA com `Cannot find module './anamnese-pauta-repo'`.

- [ ] **Step 4: Escrever o repositório**

Criar `src/services/anamnese-pauta-repo.js`:

```js
'use strict';
// Acesso à tabela anamnese_pauta. Fino de propósito: quem decide é o módulo puro; aqui só
// entra e sai do banco. TODA chamada checa `error` — consulta com coluna errada devolve
// { data:null, error } e viraria "zero linhas" em silêncio (custou dois diagnósticos errados
// em 03/09).

async function registrarAparicoes(sb, { unidadeId, dia, pessoas } = {}) {
  const lista = [...new Set((pessoas || []).filter(Boolean))];
  if (!lista.length) return { gravadas: 0, erro: null };
  const linhas = lista.map((pessoa_chave) => ({ unidade_id: unidadeId, pessoa_chave, dia }));
  // upsert: o cron bate o mesmo slot mais de uma vez; sem isto a 2ª passada estoura o UNIQUE.
  const { error } = await sb.from('anamnese_pauta')
    .upsert(linhas, { onConflict: 'unidade_id,pessoa_chave,dia', ignoreDuplicates: true });
  if (error) {
    console.error(`[Pauta] registrarAparicoes falhou unidade=${unidadeId} dia=${dia}: ${error.message}`);
    return { gravadas: 0, erro: error.message };
  }
  return { gravadas: linhas.length, erro: null };
}

async function gravarResultado(sb, { unidadeId, dia, pessoaChave, resultado } = {}) {
  const { error } = await sb.from('anamnese_pauta')
    .update({ resultado, updated_at: new Date().toISOString() })
    .eq('unidade_id', unidadeId).eq('pessoa_chave', pessoaChave).eq('dia', dia);
  if (error) {
    console.error(`[Pauta] gravarResultado falhou ${pessoaChave} ${dia}: ${error.message}`);
    return false;
  }
  return true;
}

// Devolve null (NÃO Map vazio) quando a leitura falha: Map vazio significa "ninguém falhou",
// e o chamador tomaria decisão de escada em cima de uma mentira.
async function contarFalhas(sb, { unidadeId, pessoas } = {}) {
  const lista = [...new Set((pessoas || []).filter(Boolean))];
  if (!lista.length) return new Map();
  const { data, error } = await sb.from('anamnese_pauta')
    .select('pessoa_chave, resultado')
    .eq('unidade_id', unidadeId).eq('resultado', 'nao_preencheu')
    .in('pessoa_chave', lista);
  if (error) {
    console.error(`[Pauta] contarFalhas falhou unidade=${unidadeId}: ${error.message}`);
    return null;
  }
  const m = new Map();
  (data || []).forEach((r) => m.set(r.pessoa_chave, (m.get(r.pessoa_chave) || 0) + 1));
  return m;
}

module.exports = { registrarAparicoes, gravarResultado, contarFalhas };
```

- [ ] **Step 5: Rodar e ver passar**

```bash
ssh tom "cd /opt/LA-Organizer && node --env-file=.env --test src/services/anamnese-pauta-repo.test.js"
```
Esperado: `# pass 6` / `# fail 0`.

- [ ] **Step 6: Aplicar a migration**

Aplicar `migrations/20260904_anamnese_pauta.sql` no Supabase (projeto do TOM) e conferir:

```bash
ssh tom "cd /opt/LA-Organizer && node --env-file=.env -e \"
const { createClient } = require('./node_modules/@supabase/supabase-js');
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
sb.from('anamnese_pauta').select('id').limit(1).then(({error}) => console.log(error ? 'ERRO: '+error.message : 'tabela ok'));
\""
```
Esperado: `tabela ok`.

- [ ] **Step 7: Commit**

```bash
git add migrations/20260904_anamnese_pauta.sql src/services/anamnese-pauta-repo.js src/services/anamnese-pauta-repo.test.js
git commit -m "feat(pauta): tabela anamnese_pauta e o repositorio da escada"
```

---

### Task 2: Quem entra na pauta de hoje, e em que ordem

**Files:**
- Create: `src/services/anamnese-pauta.js`
- Test: `src/services/anamnese-pauta.test.js`

**Interfaces:**
- Consumes: `situacao-aluno.filtrarPorRecorte(pessoas, 'anamnese')`.
- Produces:
  - `diaDaAula(resumo)` → `number|null` — 0=domingo … 6=sábado, lido de `"Canto — Segunda-feira 19:00"`.
  - `horaDaAula(resumo)` → `string|null` — `"19:00"`.
  - `pautaDoDia(pessoas, diaSemana)` → `Array<{pessoa, hora, curso}>` ordenado por hora crescente. `pessoas` já filtradas por "sem anamnese" pelo chamador.

- [ ] **Step 1: Escrever o teste que falha**

Criar `src/services/anamnese-pauta.test.js`:

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { diaDaAula, horaDaAula, pautaDoDia } = require('./anamnese-pauta');

const P = (nome, aulas) => ({ nome, pessoa_chave: 'pk-' + nome, aulas_resumo: aulas });

test('diaDaAula lê o dia da semana do texto da RPC', () => {
  assert.strictEqual(diaDaAula('Canto — Segunda-feira 19:00'), 1);
  assert.strictEqual(diaDaAula('Bateria — Terça 17:00'), 2);
  assert.strictEqual(diaDaAula('Canto — Sábado 11:00'), 6);
  assert.strictEqual(diaDaAula('Violão — 19:00'), null, 'sem dia no texto não chuta');
});

test('horaDaAula lê o horário', () => {
  assert.strictEqual(horaDaAula('Canto — Segunda-feira 19:00'), '19:00');
  assert.strictEqual(horaDaAula('Bateria — Sábado 09:00'), '09:00');
  assert.strictEqual(horaDaAula('Canto — Segunda'), null);
});

test('pautaDoDia traz só quem tem aula NAQUELE dia', () => {
  const r = pautaDoDia([
    P('Alice', ['Canto — Segunda-feira 19:00']),
    P('Bento', ['Bateria — Terça 17:00']),
  ], 1);
  assert.deepStrictEqual(r.map((x) => x.pessoa.nome), ['Alice']);
});

// A lista se lê na ordem em que o dia acontece — é o que a transforma em roteiro.
test('pautaDoDia ordena por horário, não por nome', () => {
  const r = pautaDoDia([
    P('Zeca', ['Canto — Quarta 20:00']),
    P('Ana', ['Canto — Quarta 08:00']),
    P('Bia', ['Canto — Quarta 14:00']),
  ], 3);
  assert.deepStrictEqual(r.map((x) => x.pessoa.nome), ['Ana', 'Bia', 'Zeca']);
  assert.deepStrictEqual(r.map((x) => x.hora), ['08:00', '14:00', '20:00']);
});

test('aluno com aula em dois dias aparece nos dois — são duas chances', () => {
  const p = P('Duda', ['Canto — Segunda 10:00', 'Bateria — Quinta 16:00']);
  assert.strictEqual(pautaDoDia([p], 1).length, 1);
  assert.strictEqual(pautaDoDia([p], 4).length, 1);
  assert.strictEqual(pautaDoDia([p], 2).length, 0);
});

test('duas aulas no MESMO dia viram uma entrada, na primeira hora', () => {
  const p = P('Ravi', ['Canto — Terça 09:00', 'Bateria — Terça 15:00']);
  const r = pautaDoDia([p], 2);
  assert.strictEqual(r.length, 1, 'uma linha por aluno por dia, não uma por aula');
  assert.strictEqual(r[0].hora, '09:00', 'a primeira aula é quando ele chega na escola');
});

test('sem aulas ou sem horário legível fica de fora, sem quebrar', () => {
  assert.deepStrictEqual(pautaDoDia([P('X', [])], 1), []);
  assert.deepStrictEqual(pautaDoDia([P('Y', ['Canto — Segunda'])], 1), []);
  assert.deepStrictEqual(pautaDoDia(null, 1), []);
});

test('o curso viaja junto, pra aparecer no título da filha', () => {
  const r = pautaDoDia([P('Alice', ['Canto — Segunda-feira 19:00'])], 1);
  assert.strictEqual(r[0].curso, 'Canto');
});
```

- [ ] **Step 2: Rodar e ver falhar**

```bash
ssh tom "cd /opt/LA-Organizer && node --env-file=.env --test src/services/anamnese-pauta.test.js"
```
Esperado: FALHA com `Cannot find module './anamnese-pauta'`.

- [ ] **Step 3: Escrever o módulo**

Criar `src/services/anamnese-pauta.js`:

```js
'use strict';
// Decisões PURAS da pauta de anamnese. Nada aqui toca banco nem RPC — o ritual orquestra.
// Ver docs/superpowers/specs/2026-09-03-pauta-de-anamnese-design.md.

const DIAS = ['domingo', 'segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado'];

function _norm(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

// "Canto — Segunda-feira 19:00" → 1. Sem dia no texto devolve null; NÃO chuta.
function diaDaAula(resumo) {
  const t = _norm(resumo);
  for (let i = 0; i < DIAS.length; i += 1) if (t.includes(DIAS[i])) return i;
  return null;
}

function horaDaAula(resumo) {
  const m = String(resumo || '').match(/\b(\d{1,2}):(\d{2})\b/);
  return m ? `${m[1].padStart(2, '0')}:${m[2]}` : null;
}

function _curso(resumo) {
  return String(resumo || '').split('—')[0].trim() || null;
}

// Uma linha por ALUNO por dia (não por aula), na hora da PRIMEIRA aula — que é quando ele
// chega na escola, e é aí que o tablet funciona.
function pautaDoDia(pessoas, diaSemana) {
  const saida = [];
  for (const pessoa of (pessoas || [])) {
    const doDia = (pessoa.aulas_resumo || [])
      .filter((a) => diaDaAula(a) === diaSemana && horaDaAula(a))
      .sort((a, b) => String(horaDaAula(a)).localeCompare(String(horaDaAula(b))));
    if (!doDia.length) continue;
    saida.push({ pessoa, hora: horaDaAula(doDia[0]), curso: _curso(doDia[0]) });
  }
  return saida.sort((a, b) => a.hora.localeCompare(b.hora));
}

module.exports = { diaDaAula, horaDaAula, pautaDoDia, DIAS };
```

- [ ] **Step 4: Rodar e ver passar**

```bash
ssh tom "cd /opt/LA-Organizer && node --env-file=.env --test src/services/anamnese-pauta.test.js"
```
Esperado: `# pass 8` / `# fail 0`.

- [ ] **Step 5: Commit**

```bash
git add src/services/anamnese-pauta.js src/services/anamnese-pauta.test.js
git commit -m "feat(pauta): quem entra na pauta de hoje e em que ordem (puro)"
```

---

### Task 3: A escada e os títulos

**Files:**
- Modify: `src/services/anamnese-pauta.js`
- Test: `src/services/anamnese-pauta.test.js` (adicionar ao fim)

**Interfaces:**
- Consumes: `pautaDoDia` (Task 2), `contarFalhas` (Task 1) — o chamador passa o Map pronto.
- Produces:
  - `degrau(falhas)` → `1 | 2 | 3` — `falhas` é o número de `nao_preencheu` do aluno. 0 falhas → 1; 1 falha → 2; 2+ → 3.
  - `tituloDaFilha({ pessoa, hora, curso }, falhas)` → `string`.
  - `tituloDaEscalada(pessoa, falhas)` → `string`.
  - `separarPorDegrau(itens, mapaFalhas)` → `{ pauta: Array, escalados: Array }` — degrau 3 sai da pauta e vai pra `escalados`.

- [ ] **Step 1: Escrever o teste que falha**

Adicionar ao fim de `src/services/anamnese-pauta.test.js`:

```js
const { degrau, tituloDaFilha, tituloDaEscalada, separarPorDegrau } = require('./anamnese-pauta');

test('degrau: 0 falhas é 1ª vez, 1 falha é 2ª, 2+ é escalada', () => {
  assert.strictEqual(degrau(0), 1);
  assert.strictEqual(degrau(1), 2);
  assert.strictEqual(degrau(2), 3);
  assert.strictEqual(degrau(9), 3);
  assert.strictEqual(degrau(undefined), 1, 'sem histórico é 1ª vez');
});

test('título da filha: 1ª vez é limpo, 2ª carrega a marca', () => {
  const item = { pessoa: { nome: 'Alice Cagnin' }, hora: '14:00', curso: 'Canto' };
  assert.strictEqual(tituloDaFilha(item, 0), '14:00 Anamnese — Alice Cagnin (Canto)');
  assert.strictEqual(tituloDaFilha(item, 1),
    '14:00 Anamnese — Alice Cagnin (Canto) ⚠️ 2ª semana — não preencheu na anterior');
});

test('título da escalada diz quantas semanas', () => {
  assert.strictEqual(tituloDaEscalada({ nome: 'Alice Cagnin' }, 2),
    'Mandar link da anamnese — Alice Cagnin (2 semanas sem preencher)');
  assert.strictEqual(tituloDaEscalada({ nome: 'Alice Cagnin' }, 4),
    'Mandar link da anamnese — Alice Cagnin (4 semanas sem preencher)');
});

// A pauta do dia é descartável; a escalada é dívida. Elas não podem se misturar.
test('separarPorDegrau tira o degrau 3 da pauta', () => {
  const itens = [
    { pessoa: { nome: 'Ana', pessoa_chave: 'pk1' }, hora: '09:00', curso: 'Canto' },
    { pessoa: { nome: 'Bia', pessoa_chave: 'pk2' }, hora: '10:00', curso: 'Canto' },
    { pessoa: { nome: 'Cid', pessoa_chave: 'pk3' }, hora: '11:00', curso: 'Canto' },
  ];
  const mapa = new Map([['pk1', 0], ['pk2', 1], ['pk3', 2]]);
  const r = separarPorDegrau(itens, mapa);
  assert.deepStrictEqual(r.pauta.map((x) => x.pessoa.nome), ['Ana', 'Bia']);
  assert.deepStrictEqual(r.escalados.map((x) => x.pessoa.nome), ['Cid']);
  assert.strictEqual(r.escalados[0].falhas, 2, 'a escalada leva o número junto pro título');
});

test('sem mapa de falhas, todo mundo é 1ª vez — nunca escala no escuro', () => {
  const itens = [{ pessoa: { nome: 'Ana', pessoa_chave: 'pk1' }, hora: '09:00', curso: 'Canto' }];
  const r = separarPorDegrau(itens, null);
  assert.strictEqual(r.pauta.length, 1);
  assert.strictEqual(r.escalados.length, 0);
});
```

- [ ] **Step 2: Rodar e ver falhar**

```bash
ssh tom "cd /opt/LA-Organizer && node --env-file=.env --test src/services/anamnese-pauta.test.js"
```
Esperado: FALHA com `degrau is not a function`.

- [ ] **Step 3: Implementar**

Adicionar em `src/services/anamnese-pauta.js`, antes do `module.exports`:

```js
// ── A ESCADA ──────────────────────────────────────────────────────────────────────────────
// Conta APARIÇÕES falhadas, não cliques: contar "a equipe tentou" faria a escalada depender de
// todo mundo marcar checkbox certinho todo dia, e isso quebra na primeira semana corrida.
function degrau(falhas) {
  const n = Number(falhas) || 0;
  if (n >= 2) return 3;
  return n === 1 ? 2 : 1;
}

function tituloDaFilha({ pessoa, hora, curso }, falhas) {
  const base = `${hora} Anamnese — ${pessoa.nome}${curso ? ` (${curso})` : ''}`;
  return degrau(falhas) === 2 ? `${base} ⚠️ 2ª semana — não preencheu na anterior` : base;
}

function tituloDaEscalada(pessoa, falhas) {
  const n = Number(falhas) || 0;
  return `Mandar link da anamnese — ${pessoa.nome} (${n} semanas sem preencher)`;
}

// Degrau 3 SAI da pauta: no terceiro encontro o problema deixou de ser "lembrar na aula".
// `mapaFalhas` null (erro de leitura) → todo mundo é 1ª vez. Nunca escalar no escuro.
function separarPorDegrau(itens, mapaFalhas) {
  const pauta = [];
  const escalados = [];
  for (const item of (itens || [])) {
    const falhas = mapaFalhas ? (mapaFalhas.get(item.pessoa.pessoa_chave) || 0) : 0;
    if (degrau(falhas) === 3) escalados.push({ ...item, falhas });
    else pauta.push({ ...item, falhas });
  }
  return { pauta, escalados };
}
```

E trocar o `module.exports` por:

```js
module.exports = {
  diaDaAula, horaDaAula, pautaDoDia, DIAS,
  degrau, tituloDaFilha, tituloDaEscalada, separarPorDegrau,
};
```

- [ ] **Step 4: Rodar e ver passar**

```bash
ssh tom "cd /opt/LA-Organizer && node --env-file=.env --test src/services/anamnese-pauta.test.js"
```
Esperado: `# pass 13` / `# fail 0`.

- [ ] **Step 5: Commit**

```bash
git add src/services/anamnese-pauta.js src/services/anamnese-pauta.test.js
git commit -m "feat(pauta): a escada por aparicoes e os titulos (puro)"
```

---

### Task 4: O texto que sai no grupo

**Files:**
- Modify: `src/services/anamnese-pauta.js`
- Test: `src/services/anamnese-pauta.test.js` (adicionar ao fim)

**Interfaces:**
- Consumes: a saída de `separarPorDegrau` (Task 3).
- Produces: `mensagemDoGrupo({ itens, unidadeNome, dataBr })` → `string` — texto pronto pro WhatsApp. `null` se `itens` vazio.

- [ ] **Step 1: Escrever o teste que falha**

Adicionar ao fim de `src/services/anamnese-pauta.test.js`:

```js
const { mensagemDoGrupo } = require('./anamnese-pauta');

const ITENS = [
  { pessoa: { nome: 'Arthur Bezerra' }, hora: '08:00', curso: 'Bateria' },
  { pessoa: { nome: 'Maria Isabel' }, hora: '09:00', curso: 'Canto' },
  { pessoa: { nome: 'Davi Reis' }, hora: '09:00', curso: 'Canto' },
  { pessoa: { nome: 'Alice Cagnin' }, hora: '14:00', curso: 'Canto' },
];

test('a mensagem diz o número e SÓ os primeiros horários', () => {
  const m = mensagemDoGrupo({ itens: ITENS, unidadeNome: 'Recreio', dataBr: 'qua 10/09' });
  assert.match(m, /4 alunos/);
  assert.match(m, /qua 10\/09/);
  assert.match(m, /08:00 Arthur Bezerra/);
  // quem tem aula às 14h não precisa aparecer às 7h30
  assert.doesNotMatch(m, /Alice Cagnin/, 'só os 3 primeiros — 43 nomes ninguém lê num zap');
  assert.match(m, /painel/, 'aponta pro painel, onde a lista inteira está');
});

test('singular quando é um só', () => {
  const m = mensagemDoGrupo({ itens: [ITENS[0]], unidadeNome: 'Barra', dataBr: 'sáb 13/09' });
  assert.match(m, /1 aluno com aula hoje/);
  assert.doesNotMatch(m, /alunos/);
});

test('pauta vazia não gera mensagem — dia limpo é silêncio, não spam', () => {
  assert.strictEqual(mensagemDoGrupo({ itens: [], unidadeNome: 'Recreio', dataBr: 'dom 14/09' }), null);
});
```

- [ ] **Step 2: Rodar e ver falhar**

```bash
ssh tom "cd /opt/LA-Organizer && node --env-file=.env --test src/services/anamnese-pauta.test.js"
```
Esperado: FALHA com `mensagemDoGrupo is not a function`.

- [ ] **Step 3: Implementar**

Adicionar em `src/services/anamnese-pauta.js`:

```js
const PRIMEIROS_NO_ZAP = 3;

// Os N primeiros HORÁRIOS, não os N primeiros nomes alfabéticos: quem chega às 8h é quem
// importa quando o dia começa. A lista inteira mora no painel.
function mensagemDoGrupo({ itens, unidadeNome, dataBr } = {}) {
  const lista = itens || [];
  if (!lista.length) return null;
  const n = lista.length;
  const cabeca = lista.slice(0, PRIMEIROS_NO_ZAP)
    .map((i) => `${i.hora} ${i.pessoa.nome}`).join(' · ');
  return `📋 *Anamnese — hoje (${dataBr})*\n`
    + `${n} aluno${n > 1 ? 's' : ''} com aula hoje ainda sem anamnese.\n`
    + `${n > PRIMEIROS_NO_ZAP ? 'Os primeiros' : 'Hoje'}: ${cabeca}\n`
    + 'A lista completa está no painel do grupo.';
}
```

E incluir `mensagemDoGrupo, PRIMEIROS_NO_ZAP` no `module.exports`.

- [ ] **Step 4: Rodar e ver passar**

```bash
ssh tom "cd /opt/LA-Organizer && node --env-file=.env --test src/services/anamnese-pauta.test.js"
```
Esperado: `# pass 16` / `# fail 0`.

- [ ] **Step 5: Commit**

```bash
git add src/services/anamnese-pauta.js src/services/anamnese-pauta.test.js
git commit -m "feat(pauta): o texto que sai no grupo (puro)"
```

---

### Task 5: O ritual que monta a pauta

**Files:**
- Create: `src/rituals/anamnese-pauta.js`
- Test: `src/rituals/anamnese-pauta.test.js`

**Interfaces:**
- Consumes: `anamnese-pauta.js` (Tasks 2–4), `anamnese-pauta-repo.js` (Task 1), `situacao-aluno.filtrarPorRecorte` / `UNIDADES_IDS` / `nomeDaUnidade`, `task-groups.createTaskGroup`.
- Produces: `montarPautaDaUnidade({ supabase, laReport, unidadeId, groupId, criadoPor, hoje, deps })` → `Promise<{criou:boolean, total:number, escalados:number, motivo:string|null, itens:Array}>`.

**Regras que o teste tem que provar:** RPC falha → não cria nada e diz por quê; acima de 120 → não cria e diz por quê; mapa de falhas null → ninguém escala; pauta vazia → não cria pacote.

- [ ] **Step 1: Escrever o teste que falha**

Criar `src/rituals/anamnese-pauta.test.js`:

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { montarPautaDaUnidade, TETO_FILHAS } = require('./anamnese-pauta');

const aluno = (nome, hora, temAnamnese) => ({
  nome, pessoa_chave: 'pk-' + nome, classificacao: 'LA',
  aulas_resumo: [`Canto — Segunda-feira ${hora}`],
  anamnese_preenchida: !!temAnamnese, cadastro_faltando: temAnamnese ? [] : ['anamnese'],
});

function deps({ rpcErro = null, alunos = [], falhas = new Map(), criar = null } = {}) {
  const criadas = [];
  return {
    criadas,
    laReport: { rpc: async () => ({ data: rpcErro ? null : alunos, error: rpcErro }) },
    repo: {
      registrarAparicoes: async () => ({ gravadas: alunos.length, erro: null }),
      contarFalhas: async () => falhas,
    },
    criarPacote: criar || (async (arg) => { criadas.push(arg); return { groupId: 'g-mae', childIds: [] }; }),
  };
}

// SEGUNDA-FEIRA = 2026-09-07
const SEGUNDA = '2026-09-07';

test('monta a pauta com quem tem aula hoje e está sem anamnese', async () => {
  const d = deps({ alunos: [aluno('Ana', '09:00', false), aluno('Bia', '08:00', false), aluno('Cid', '10:00', true)] });
  const r = await montarPautaDaUnidade({
    supabase: {}, laReport: d.laReport, unidadeId: 'u1', groupId: 'grp', criadoPor: 'c1',
    hoje: SEGUNDA, deps: d,
  });
  assert.strictEqual(r.criou, true);
  assert.strictEqual(r.total, 2, 'Cid já tem anamnese e fica de fora');
  const arg = d.criadas[0];
  assert.deepStrictEqual(arg.input.subtasks.map((s) => s.title.slice(0, 5)), ['08:00', '09:00'],
    'ordenado por horário');
});

// Meio pacote é pior que zero: o time confia na lista e quem faltar passa batido.
test('RPC falha → NÃO cria nada e diz o motivo', async () => {
  const d = deps({ rpcErro: { message: 'timeout' } });
  const r = await montarPautaDaUnidade({
    supabase: {}, laReport: d.laReport, unidadeId: 'u1', groupId: 'grp', criadoPor: 'c1',
    hoje: SEGUNDA, deps: d,
  });
  assert.strictEqual(r.criou, false);
  assert.match(r.motivo, /timeout|consulta/i);
  assert.strictEqual(d.criadas.length, 0);
});

test('acima do teto de sanidade NÃO cria e avisa', async () => {
  const muitos = Array.from({ length: TETO_FILHAS + 1 }, (_, i) => aluno('A' + i, '09:00', false));
  const d = deps({ alunos: muitos });
  const r = await montarPautaDaUnidade({
    supabase: {}, laReport: d.laReport, unidadeId: 'u1', groupId: 'grp', criadoPor: 'c1',
    hoje: SEGUNDA, deps: d,
  });
  assert.strictEqual(r.criou, false);
  assert.match(r.motivo, /teto/i);
  assert.strictEqual(d.criadas.length, 0);
});

test('pauta vazia não cria pacote', async () => {
  const d = deps({ alunos: [aluno('Cid', '10:00', true)] });
  const r = await montarPautaDaUnidade({
    supabase: {}, laReport: d.laReport, unidadeId: 'u1', groupId: 'grp', criadoPor: 'c1',
    hoje: SEGUNDA, deps: d,
  });
  assert.strictEqual(r.criou, false);
  assert.strictEqual(r.total, 0);
  assert.strictEqual(d.criadas.length, 0);
});

test('quem já falhou 2x sai da pauta e vira escalada', async () => {
  const d = deps({
    alunos: [aluno('Ana', '09:00', false), aluno('Cid', '10:00', false)],
    falhas: new Map([['pk-Cid', 2]]),
  });
  const r = await montarPautaDaUnidade({
    supabase: {}, laReport: d.laReport, unidadeId: 'u1', groupId: 'grp', criadoPor: 'c1',
    hoje: SEGUNDA, deps: d,
  });
  assert.strictEqual(r.total, 1, 'só a Ana na pauta do dia');
  assert.strictEqual(r.escalados, 1);
});

test('erro ao ler a escada não escala ninguém', async () => {
  const d = deps({ alunos: [aluno('Cid', '10:00', false)], falhas: null });
  d.repo.contarFalhas = async () => null;
  const r = await montarPautaDaUnidade({
    supabase: {}, laReport: d.laReport, unidadeId: 'u1', groupId: 'grp', criadoPor: 'c1',
    hoje: SEGUNDA, deps: d,
  });
  assert.strictEqual(r.escalados, 0, 'sem histórico confiável, ninguém é escalado');
  assert.strictEqual(r.total, 1);
});
```

- [ ] **Step 2: Rodar e ver falhar**

```bash
ssh tom "cd /opt/LA-Organizer && node --env-file=.env --test src/rituals/anamnese-pauta.test.js"
```
Esperado: FALHA com `Cannot find module './anamnese-pauta'`.

- [ ] **Step 3: Implementar o ritual**

Criar `src/rituals/anamnese-pauta.js`:

```js
'use strict';
// Ritual da pauta de anamnese. Orquestra e mais nada: quem decide é src/services/anamnese-pauta.
// Ver docs/superpowers/specs/2026-09-03-pauta-de-anamnese-design.md.

const situ = require('../services/situacao-aluno');
const pura = require('../services/anamnese-pauta');
const repoPadrao = require('../services/anamnese-pauta-repo');

// O pico medido em 03/09 foi 80 (Campo Grande, terça). 120 significa que a base ou a conta
// mudou — melhor gritar do que despejar 300 linhas no painel de quem trabalha.
const TETO_FILHAS = 120;

function _diaSemanaBrt(ymd) {
  return new Date(`${ymd}T12:00:00Z`).getUTCDay();
}

async function montarPautaDaUnidade({ supabase, laReport, unidadeId, groupId, criadoPor, hoje, deps = {} }) {
  const repo = deps.repo || repoPadrao;
  const criarPacote = deps.criarPacote
    || ((arg) => require('../services/task-groups').createTaskGroup(arg));

  const { data, error } = await laReport.rpc('get_situacao_alunos_v1',
    { p_unidade_id: unidadeId, p_apenas_pendentes: false });
  if (error) {
    return { criou: false, total: 0, escalados: 0, motivo: `consulta do LA Report falhou: ${error.message}`, itens: [] };
  }

  // fonte ÚNICA de "sem anamnese" — se a pauta usasse regra própria, um dia o card diria 225
  // e a pauta 231, e ninguém confiaria em nenhum dos dois
  const semAnamnese = situ.filtrarPorRecorte(data || [], 'anamnese');
  const itens = pura.pautaDoDia(semAnamnese, _diaSemanaBrt(hoje));
  if (!itens.length) return { criou: false, total: 0, escalados: 0, motivo: null, itens: [] };

  if (itens.length > TETO_FILHAS) {
    return { criou: false, total: itens.length, escalados: 0, itens: [],
      motivo: `teto de sanidade: ${itens.length} alunos (máximo ${TETO_FILHAS}) — não montei a pauta` };
  }

  const mapa = await repo.contarFalhas(supabase, { unidadeId, pessoas: itens.map((i) => i.pessoa.pessoa_chave) });
  const { pauta, escalados } = pura.separarPorDegrau(itens, mapa);

  await repo.registrarAparicoes(supabase, {
    unidadeId, dia: hoje, pessoas: itens.map((i) => i.pessoa.pessoa_chave),
  });

  const [a, m, d2] = hoje.split('-');
  await criarPacote({
    supabase, groupId, createdBy: criadoPor,
    input: {
      title: `📋 Anamnese — quem tem aula hoje · ${d2}/${m}`,
      recurrence: null,
      groupDueDate: hoje,
      subtasks: pauta.map((i) => ({ title: pura.tituloDaFilha(i, i.falhas), dueDate: hoje })),
    },
  });

  return { criou: true, total: pauta.length, escalados: escalados.length, motivo: null, itens: pauta, escaladosItens: escalados };
}

module.exports = { montarPautaDaUnidade, TETO_FILHAS };
```

- [ ] **Step 4: Rodar e ver passar**

```bash
ssh tom "cd /opt/LA-Organizer && node --env-file=.env --test src/rituals/anamnese-pauta.test.js"
```
Esperado: `# pass 6` / `# fail 0`.

- [ ] **Step 5: Rodar a suíte inteira**

```bash
ssh tom "cd /opt/LA-Organizer && node --env-file=.env --test src/ 2>&1 | grep -E '^# (tests|pass|fail)|^not ok'"
```
Esperado: `# fail 3` — só as três de `system-loadout`.

- [ ] **Step 6: Commit**

```bash
git add src/rituals/anamnese-pauta.js src/rituals/anamnese-pauta.test.js
git commit -m "feat(pauta): ritual que monta a pauta do dia, com teto e falha-fechada"
```

---

### Task 6: A passada da noite

**Files:**
- Modify: `src/rituals/anamnese-pauta.js`
- Test: `src/rituals/anamnese-pauta.test.js` (adicionar ao fim)

**Interfaces:**
- Consumes: `repo.gravarResultado` (Task 1).
- Produces: `fecharPautaDaUnidade({ supabase, laReport, unidadeId, hoje, deps })` → `Promise<{fechou:boolean, preencheu:number, naoPreencheu:number, semVerificacao:number, motivo:string|null}>`.

- [ ] **Step 1: Escrever o teste que falha**

Adicionar ao fim de `src/rituals/anamnese-pauta.test.js`:

```js
const { fecharPautaDaUnidade } = require('./anamnese-pauta');

function depsNoite({ rpcErro = null, alunos = [], daPauta = [] } = {}) {
  const gravados = [];
  return {
    gravados,
    laReport: { rpc: async () => ({ data: rpcErro ? null : alunos, error: rpcErro }) },
    repo: {
      pessoasDoDia: async () => daPauta,
      gravarResultado: async (_sb, arg) => { gravados.push(arg); return true; },
    },
  };
}

test('à noite grava preencheu/nao_preencheu lendo a fonte', async () => {
  const d = depsNoite({
    alunos: [aluno('Ana', '09:00', true), aluno('Bia', '08:00', false)],
    daPauta: ['pk-Ana', 'pk-Bia'],
  });
  const r = await fecharPautaDaUnidade({
    supabase: {}, laReport: d.laReport, unidadeId: 'u1', hoje: SEGUNDA, deps: d,
  });
  assert.strictEqual(r.preencheu, 1);
  assert.strictEqual(r.naoPreencheu, 1);
  assert.deepStrictEqual(
    d.gravados.map((g) => [g.pessoaChave, g.resultado]).sort(),
    [['pk-Ana', 'preencheu'], ['pk-Bia', 'nao_preencheu']],
  );
});

// Dia que a nossa infra derrubou NÃO pode contar contra o aluno: senão a 3ª vez chega por
// culpa nossa e a equipe cobra quem já tinha preenchido.
test('RPC falha à noite → grava sem_verificacao, nunca nao_preencheu', async () => {
  const d = depsNoite({ rpcErro: { message: 'timeout' }, daPauta: ['pk-Ana', 'pk-Bia'] });
  const r = await fecharPautaDaUnidade({
    supabase: {}, laReport: d.laReport, unidadeId: 'u1', hoje: SEGUNDA, deps: d,
  });
  assert.strictEqual(r.semVerificacao, 2);
  assert.strictEqual(r.naoPreencheu, 0);
  assert.ok(d.gravados.every((g) => g.resultado === 'sem_verificacao'));
});

test('aluno que sumiu da base entra como sem_verificacao, não como falha', async () => {
  const d = depsNoite({ alunos: [aluno('Ana', '09:00', true)], daPauta: ['pk-Ana', 'pk-Sumiu'] });
  const r = await fecharPautaDaUnidade({
    supabase: {}, laReport: d.laReport, unidadeId: 'u1', hoje: SEGUNDA, deps: d,
  });
  const sumiu = d.gravados.find((g) => g.pessoaChave === 'pk-Sumiu');
  assert.strictEqual(sumiu.resultado, 'sem_verificacao', 'não está mais na base — não dá pra afirmar que falhou');
});

test('pauta vazia à noite não grava nada', async () => {
  const d = depsNoite({ alunos: [], daPauta: [] });
  const r = await fecharPautaDaUnidade({
    supabase: {}, laReport: d.laReport, unidadeId: 'u1', hoje: SEGUNDA, deps: d,
  });
  assert.strictEqual(r.fechou, false);
  assert.strictEqual(d.gravados.length, 0);
});
```

- [ ] **Step 2: Rodar e ver falhar**

```bash
ssh tom "cd /opt/LA-Organizer && node --env-file=.env --test src/rituals/anamnese-pauta.test.js"
```
Esperado: FALHA com `fecharPautaDaUnidade is not a function`.

- [ ] **Step 3: Adicionar `pessoasDoDia` ao repositório**

Em `src/services/anamnese-pauta-repo.js`, antes do `module.exports`:

```js
// Quem entrou na pauta de um dia — é a lista que a passada da noite fecha.
async function pessoasDoDia(sb, { unidadeId, dia } = {}) {
  const { data, error } = await sb.from('anamnese_pauta')
    .select('pessoa_chave').eq('unidade_id', unidadeId).eq('dia', dia);
  if (error) {
    console.error(`[Pauta] pessoasDoDia falhou unidade=${unidadeId} dia=${dia}: ${error.message}`);
    return null;
  }
  return (data || []).map((r) => r.pessoa_chave);
}
```

E incluir `pessoasDoDia` no `module.exports`.

- [ ] **Step 4: Implementar o fechamento**

Em `src/rituals/anamnese-pauta.js`, antes do `module.exports`:

```js
// Passada da NOITE: lê a fonte e carimba o resultado de cada aluno que entrou na pauta de hoje.
// Não posta mensagem (decisão do Alf, 03/09 — o placar da noite ficou fora da fatia 1).
async function fecharPautaDaUnidade({ supabase, laReport, unidadeId, hoje, deps = {} }) {
  const repo = deps.repo || repoPadrao;
  const pessoas = await repo.pessoasDoDia(supabase, { unidadeId, dia: hoje });
  if (!pessoas || !pessoas.length) {
    return { fechou: false, preencheu: 0, naoPreencheu: 0, semVerificacao: 0, motivo: null };
  }

  const { data, error } = await laReport.rpc('get_situacao_alunos_v1',
    { p_unidade_id: unidadeId, p_apenas_pendentes: false });

  // Dia que a NOSSA infra derrubou não conta contra o aluno.
  if (error) {
    for (const pk of pessoas) {
      await repo.gravarResultado(supabase, { unidadeId, dia: hoje, pessoaChave: pk, resultado: 'sem_verificacao' });
    }
    return { fechou: true, preencheu: 0, naoPreencheu: 0, semVerificacao: pessoas.length,
      motivo: `consulta do LA Report falhou: ${error.message}` };
  }

  const porChave = new Map((data || []).map((p) => [p.pessoa_chave, p]));
  let preencheu = 0; let naoPreencheu = 0; let semVerificacao = 0;
  for (const pk of pessoas) {
    const p = porChave.get(pk);
    let resultado;
    if (!p) { resultado = 'sem_verificacao'; semVerificacao++; }          // saiu da base ativa
    else if (!situ.filtrarPorRecorte([p], 'anamnese').length) { resultado = 'preencheu'; preencheu++; }
    else { resultado = 'nao_preencheu'; naoPreencheu++; }
    await repo.gravarResultado(supabase, { unidadeId, dia: hoje, pessoaChave: pk, resultado });
  }
  return { fechou: true, preencheu, naoPreencheu, semVerificacao, motivo: null };
}
```

E trocar o `module.exports` por:

```js
module.exports = { montarPautaDaUnidade, fecharPautaDaUnidade, TETO_FILHAS };
```

- [ ] **Step 5: Rodar e ver passar**

```bash
ssh tom "cd /opt/LA-Organizer && node --env-file=.env --test src/rituals/anamnese-pauta.test.js src/services/anamnese-pauta-repo.test.js"
```
Esperado: `# fail 0`.

- [ ] **Step 6: Commit**

```bash
git add src/rituals/anamnese-pauta.js src/rituals/anamnese-pauta.test.js src/services/anamnese-pauta-repo.js
git commit -m "feat(pauta): passada da noite fecha lendo a fonte; dia sem medicao nao conta"
```

---

### Task 7: Fiação no dispatcher e prova em grupo sombra

**Files:**
- Modify: `src/rituals/dispatcher.js`
- Create: `/tmp/e2e-pauta.js` na VPS (harness, NÃO versionado)

**Interfaces:**
- Consumes: `montarPautaDaUnidade`, `fecharPautaDaUnidade` (Tasks 5–6).
- Produces: três slots no dispatcher — 06:00 monta, 07:30 fala, 23:00 fecha.

- [ ] **Step 1: Adicionar as constantes de horário**

Em `src/rituals/dispatcher.js`, junto das outras (perto de `const DAILY_DREAM_TIME`):

```js
const PAUTA_ANAMNESE_MONTA_TIME = '06:00';   // antes da primeira aula (08:00), depois do health check
const PAUTA_ANAMNESE_FALA_TIME = '07:30';    // mesmo slot do ops_digest — zap às 6h é invasivo
const PAUTA_ANAMNESE_FECHA_TIME = '23:00';   // depois da última aula (20:00)
```

- [ ] **Step 2: Adicionar o bloco de montagem**

No corpo do dispatcher, junto dos outros rituais:

```js
  // PAUTA DE ANAMNESE (spec 2026-09-03) — monta a pauta do dia nas três unidades.
  if (opts.force === 'pauta_anamnese' || timeToSlot(PAUTA_ANAMNESE_MONTA_TIME) === slotNow) {
    try {
      const { montarPautaDaUnidade } = require('./anamnese-pauta');
      const situAl = require('../services/situacao-aluno');
      const { laReportClient } = require('../services/la-report-client');
      for (const unidadeId of situAl.UNIDADES_IDS) {
        const chaveDia = `pauta_anamnese:${unidadeId}:${now.ymd}`;
        const { data: jaTem } = await supabase.from('marker_logs')
          .select('id').eq('marker_type', 'PAUTA_ANAMNESE').like('reason', `${chaveDia}%`).limit(1);
        if (jaTem && jaTem.length) continue;  // idempotência: o cron bate o slot 3x

        const { data: grupo } = await supabase.from('work_groups')
          .select('id, leader_id').eq('la_report_unidade_id', unidadeId).not('wa_group_jid', 'is', null).maybeSingle();
        if (!grupo) continue;

        const r = await montarPautaDaUnidade({
          supabase, laReport: laReportClient, unidadeId, groupId: grupo.id,
          criadoPor: grupo.leader_id, hoje: now.ymd,
        });
        await supabase.from('marker_logs').insert({
          marker_type: 'PAUTA_ANAMNESE',
          result: r.criou ? 'executed' : (r.motivo ? 'fallback' : 'skipped'),
          reason: `${chaveDia} total=${r.total} escalados=${r.escalados}${r.motivo ? ' erro=' + r.motivo : ''}`.slice(0, 120),
        });
        if (r.motivo) console.error(`[Pauta] ${situAl.nomeDaUnidade(unidadeId)}: ${r.motivo}`);
      }
    } catch (e) { console.error('[Pauta] montagem erro:', e.message); }
  }
```

`result` só usa `executed`/`fallback`/`skipped` — `pending` viola o CHECK de `marker_logs.result`.

- [ ] **Step 3: Adicionar o bloco da fala (07:30)**

```js
  // A mensagem é separada da montagem de propósito: zap às 6h da manhã é invasivo.
  if (opts.force === 'pauta_anamnese_fala' || timeToSlot(PAUTA_ANAMNESE_FALA_TIME) === slotNow) {
    try {
      const pura = require('../services/anamnese-pauta');
      const situAl = require('../services/situacao-aluno');
      for (const unidadeId of situAl.UNIDADES_IDS) {
        const chaveFala = `pauta_fala:${unidadeId}:${now.ymd}`;
        const { data: jaFalou } = await supabase.from('marker_logs')
          .select('id').eq('marker_type', 'PAUTA_ANAMNESE').like('reason', `${chaveFala}%`).limit(1);
        if (jaFalou && jaFalou.length) continue;

        const { data: grupo } = await supabase.from('work_groups')
          .select('id').eq('la_report_unidade_id', unidadeId).not('wa_group_jid', 'is', null).maybeSingle();
        if (!grupo) continue;

        const { data: filhas } = await supabase.from('tasks')
          .select('title, parent_task_id, parent:tasks!tasks_parent_task_id_fkey(title)')
          .eq('assigned_group_id', grupo.id).eq('due_date', now.ymd)
          .like('title', '%Anamnese —%').order('title');
        if (!filhas || !filhas.length) continue;

        const itens = filhas.map((f) => ({
          hora: String(f.title).slice(0, 5),
          pessoa: { nome: String(f.title).replace(/^\d{2}:\d{2} Anamnese — /, '').replace(/ \(.*$/, '') },
        }));
        const [, m, d2] = now.ymd.split('-');
        const texto = pura.mensagemDoGrupo({ itens, unidadeNome: situAl.nomeDaUnidade(unidadeId), dataBr: `${d2}/${m}` });
        if (!texto) continue;

        await supabase.from('group_chat_messages').insert({
          group_id: grupo.id, sender_id: null, role: 'tom', kind: 'text', content: texto, channel: 'app',
        });
        await supabase.from('marker_logs').insert({
          marker_type: 'PAUTA_ANAMNESE', result: 'executed', reason: `${chaveFala} itens=${itens.length}`,
        });
      }
    } catch (e) { console.error('[Pauta] fala erro:', e.message); }
  }
```

- [ ] **Step 4: Adicionar o bloco do fechamento (23:00)**

```js
  if (opts.force === 'pauta_anamnese_fecha' || timeToSlot(PAUTA_ANAMNESE_FECHA_TIME) === slotNow) {
    try {
      const { fecharPautaDaUnidade } = require('./anamnese-pauta');
      const situAl = require('../services/situacao-aluno');
      const { laReportClient } = require('../services/la-report-client');
      for (const unidadeId of situAl.UNIDADES_IDS) {
        const chaveFecha = `pauta_fecha:${unidadeId}:${now.ymd}`;
        const { data: jaFechou } = await supabase.from('marker_logs')
          .select('id').eq('marker_type', 'PAUTA_ANAMNESE').like('reason', `${chaveFecha}%`).limit(1);
        if (jaFechou && jaFechou.length) continue;

        const r = await fecharPautaDaUnidade({
          supabase, laReport: laReportClient, unidadeId, hoje: now.ymd,
        });
        await supabase.from('marker_logs').insert({
          marker_type: 'PAUTA_ANAMNESE',
          result: r.motivo ? 'fallback' : 'executed',
          reason: `${chaveFecha} ok=${r.preencheu} falta=${r.naoPreencheu} semver=${r.semVerificacao}`.slice(0, 120),
        });
      }
    } catch (e) { console.error('[Pauta] fechamento erro:', e.message); }
  }
```

- [ ] **Step 5: Conferir sintaxe e rodar a suíte**

```bash
ssh tom "cd /opt/LA-Organizer && node --check src/rituals/dispatcher.js && node --env-file=.env --test src/ 2>&1 | grep -E '^# (tests|pass|fail)|^not ok'"
```
Esperado: sem erro de sintaxe; `# fail 3` (só `system-loadout`).

- [ ] **Step 6: E2E em grupo sombra**

Criar `/tmp/e2e-pauta.js` na VPS (não versionar) que: clona `Administração Recreio` num grupo com `wa_group_jid: null` e **aborta se o clone tiver jid**; chama `montarPautaDaUnidade` com o grupo sombra; confere que o container e as filhas existem em `tasks` e que `anamnese_pauta` tem uma linha por aluno; chama `fecharPautaDaUnidade` e confere que os `resultado` foram gravados; apaga tudo (tarefas, mensagens, linhas de `anamnese_pauta` do grupo sombra, o grupo) no `finally`.

```bash
ssh tom "cd /opt/LA-Organizer && node --env-file=.env /tmp/e2e-pauta.js"
```
Esperado: pacote criado com N filhas ordenadas por horário, N linhas em `anamnese_pauta`, resultados gravados no fechamento, e limpeza confirmada.

- [ ] **Step 7: Commit e deploy**

```bash
git add src/rituals/dispatcher.js
git commit -m "feat(pauta): fiacao dos tres slots no dispatcher (06:00 monta, 07:30 fala, 23:00 fecha)"
git push origin main
ssh tom "cd /opt/LA-Organizer && pm2 restart tom --update-env && pm2 describe tom | grep -E '^│ status'"
```

- [ ] **Step 8: Primeira rodada observada**

Forçar a montagem uma vez, olhando o resultado antes de deixar no automático:

```bash
ssh tom "cd /opt/LA-Organizer && node src/rituals/dispatcher.js --force=pauta_anamnese"
```
Conferir no banco: um container por unidade, filhas ordenadas por horário, `anamnese_pauta` com as linhas do dia. **Se algo estiver torto, apagar os containers criados antes das 07:30** — senão a mensagem sai com a lista errada.

---

## Self-Review

**Cobertura da spec:**

| Requisito da spec | Task |
|---|---|
| Ritual 06:00, três unidades, RPC + filtro + ordem por horário | 2, 5, 7 |
| `filtrarPorRecorte` como fonte única | 5 (usado), constraint global |
| Mensagem 07:30 separada da montagem | 4, 7 |
| Passada da noite fecha lendo a fonte | 6, 7 |
| Container + uma filha por aluno, no pool do grupo | 5 (via `createTaskGroup`) |
| Escada por aparições em `anamnese_pauta` | 1, 3 |
| 3ª vira tarefa de link | 3 (`separarPorDegrau` + `tituloDaEscalada`) |
| RPC falha → não cria pacote parcial e diz | 5 |
| Dia sem verificação não conta na escada | 6 |
| Aluno fora da base → não conta como falha | 6 |
| Teto de sanidade 120 | 5 |
| Idempotência `(unidade, dia)` | 1 (UNIQUE) + 7 (marker por chave do dia) |
| E2E em grupo sombra sem envio real | 7 |

**Lacuna conhecida e assumida:** a spec diz que a tarefa escalada é *criada* no pool e *fecha sozinha* quando a fonte disser preenchida. A Task 3 produz o título e a separação, e a Task 5 devolve `escaladosItens`, mas **a criação da tarefa de link e o fechamento dela não têm task própria neste plano** — porque na primeira semana ninguém tem histórico e nenhuma escalada vai existir (spec, §6.3). Fica como **fatia 2**, a ser planejada depois de a fatia 1 rodar uma semana com dado real. O plano não deixa isso implícito: `escaladosItens` sai da função e é ignorado pelo dispatcher, de propósito.

**Placeholders:** nenhum — todos os steps têm o código real.

**Consistência de tipos:** `pessoa_chave` é string em todas as tasks; `hoje`/`dia` é `YYYY-MM-DD` em todas; `mapaFalhas` é `Map<string,number>|null` em 1, 3 e 5; `itens` tem sempre `{pessoa, hora, curso, falhas?}`.
