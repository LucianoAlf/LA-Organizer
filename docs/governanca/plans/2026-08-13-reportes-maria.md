# Reportes Operacionais da Maria — Plano de Implementação

> **Para quem executa:** SUB-SKILL OBRIGATÓRIA — use `superpowers:subagent-driven-development`
> (recomendado) ou `superpowers:executing-plans` para implementar tarefa a tarefa. Os passos usam
> caixinha (`- [ ]`) para acompanhamento.

**Objetivo:** entregar à Rose três relatórios automáticos no grupo Financeiro (diário, sexta e último
dia do mês, todos às 20h30) mostrando o que foi lançado, o que falta, o que espera resposta dela e o
que a Maria não conseguiu ler.

**Arquitetura:** três peças com uma responsabilidade cada. O **caderno** registra na entrada, pelo
bridge e sem LLM, toda mensagem do grupo com cara de movimento financeiro. O **gerador** (Edge
Function) cruza caderno × conferências × Super Folha e devolve a mensagem pronta. O **agendamento**
reusa a fila e o dispatcher que já entregam o relatório das 08h. Nenhum número deste relatório passa
por modelo de linguagem.

**Stack:** Node 24 (bridge, CommonJS, arquivo único), Deno (Edge Functions Supabase), PostgreSQL
(Super Folha `ubdvtjbitozhkuvvqkxj`), pg_cron, `node:assert` para testes.

**Spec:** `docs/governanca/specs/2026-08-13-reportes-maria-design.md` — leia antes de começar.

## Restrições globais

Valem em toda tarefa, sem exceção:

- **Nenhum número do relatório pode vir de LLM.** Tudo é `count()`/`sum()` sobre tabela.
- **Grupo alvo:** `120363231958653729@g.us` (Financeiro Grupo LA Music). Nenhuma outra.
- **Horário:** `20:30` nos três relatórios.
- **Dia civil sempre em `America/Sao_Paulo`.** Nunca `toISOString().slice(0,10)` — depois das 21h isso
  vira o dia seguinte.
- **Escrita no banco só por RPC** (`callSuperfolhaRpc`), nunca `INSERT` direto pelo bridge. É o padrão
  do projeto e mantém validação e idempotência no banco.
- **Nunca imprimir valor de variável de ambiente** em log, teste ou mensagem. Só nomes; comparação por
  hash.
- **Nunca despejar dado financeiro real no chat** durante o desenvolvimento. Fixtures são inventadas.
- **Deletar dado de produção exige OK explícito do Alf.** No financeiro a barra é ainda mais alta.
- **Zona de comportamento:** este plano não altera `SOUL.md` nem o tom da Maria. O texto do relatório é
  gerado por código, e o formato está congelado na spec §6.
- **Ambiente:** VPS alias `maria`; o agente roda como usuário `maria`. Todo comando de arquivo/teste
  usa `sudo -n -u maria`. Editar arquivo grande via script Python com `assert` de âncora — nunca `sed`
  cego.
- **"Commit" na VPS** significa `sudo -n -u maria bash -c 'cd /home/maria/.openclaw/workspace &&
  ./scripts/backup-to-github-safe.sh --push'`. O repositório versionado é o do painel/spec, em
  `D:\la-organizer\_remote`, e lá sim é `git commit`.
- **Restart do bridge** é `sudo -n systemctl restart maria-uazapi-bridge.service`, **provado** com
  `sudo -n ps -eo pid,lstart,cmd | grep maria-uazapi/bridge.js` (PID novo e horário). Nunca afirmar
  restart sem essa prova.
- **A suíte inteira tem de ficar verde** ao fim de cada tarefa: `for f in $(sudo -n -u maria ls
  /home/maria/.openclaw/workspace/tools/ | grep test_maria_); do ...; done`. Hoje ela está 8/8.

---

## Estrutura de arquivos

| arquivo | responsabilidade |
|---|---|
| **Banco** (via MCP `apply_migration`) | |
| `maria_grupo_movimento_dia` (tabela) | o caderno: uma linha por mensagem com cara de movimento |
| `maria_grupo_movimento_registrar()` (RPC) | única porta de escrita do caderno; idempotente |
| `maria_grupo_movimento_marcar()` (RPC) | avança o estado de uma linha existente |
| `maria_rel_ctl_periodo()` (RPC) | números do período direto da fonte, para a trava de conferência |
| **Bridge** `/home/maria/.openclaw/workspace/bridges/maria-uazapi/bridge.js` | |
| bloco "caderno do grupo" | detecção + chamada da RPC, no caminho de entrada |
| **Edge Function** `maria-relatorio-periodo` | monta a mensagem pronta; sem LLM |
| **Testes** `/home/maria/.openclaw/workspace/tools/` | |
| `test_maria_caderno_grupo.js` | detecção e idempotência |
| `test_maria_relatorio_formato.js` | formatador, com fixtures |

---

# FATIA 1 — O caderno

**Por que primeiro:** sem captura não há o que relatar. Hoje entram ~31 mensagens/dia no grupo e
**zero** viram registro. Esta fatia precisa rodar pelo menos um dia antes de a Fatia 2 ter dado real.

---

### Tarefa 1: Tabela e RPCs do caderno

**Arquivos:**
- Criar (migração via MCP `apply_migration`, projeto `ubdvtjbitozhkuvvqkxj`)

**Interfaces:**
- Produz: `maria_grupo_movimento_registrar(p_chat_id text, p_message_id text, p_recebido_em timestamptz, p_autor_nome text, p_tipo_detectado text, p_valor_centavos int, p_descricao_curta text, p_status text, p_motivo_status text) returns uuid` e `maria_grupo_movimento_marcar(p_chat_id text, p_message_id text, p_status text, p_motivo_status text, p_conferencia_item_id uuid, p_conta_pagar_id uuid, p_fluxo_evento_id uuid) returns boolean`

- [ ] **Passo 1: Aplicar a migração**

```sql
create table if not exists maria_grupo_movimento_dia (
  id                    uuid primary key default gen_random_uuid(),
  chat_id               text not null,
  message_id            text not null,
  data_referencia       date not null,
  recebido_em           timestamptz not null,
  autor_nome            text,
  tipo_detectado        text not null,
  valor_centavos        integer,
  descricao_curta       text,
  conferencia_item_id   uuid,
  conta_pagar_id        uuid,
  fluxo_evento_id       uuid,
  status                text not null default 'detectado',
  motivo_status         text,
  criado_em             timestamptz not null default now(),
  atualizado_em         timestamptz not null default now(),
  constraint maria_grupo_movimento_dia_uk unique (chat_id, message_id),
  constraint maria_grupo_movimento_status_ck check (status in
    ('detectado','em_conferencia','aguardando_validacao','lancado','descartado','ilegivel')),
  constraint maria_grupo_movimento_tipo_ck check (tipo_detectado in
    ('comprovante','boleto','pix','valor_em_texto','indefinido'))
);

create index if not exists maria_grupo_movimento_dia_chat_data_idx
  on maria_grupo_movimento_dia (chat_id, data_referencia);
create index if not exists maria_grupo_movimento_dia_aberto_idx
  on maria_grupo_movimento_dia (chat_id, status) where status <> 'lancado';
```

> **Armadilha das duas portas:** o `check` de `status` e a lista de estados no bridge são **duas**
> portas. Adicionar estado novo só no banco faz a gravação falhar em silêncio; só no bridge faz o
> banco recusar. Mexeu em uma, mexa na outra.

- [ ] **Passo 2: Criar a RPC de registro (idempotente)**

```sql
create or replace function maria_grupo_movimento_registrar(
  p_chat_id text, p_message_id text, p_recebido_em timestamptz,
  p_autor_nome text, p_tipo_detectado text, p_valor_centavos int,
  p_descricao_curta text, p_status text default 'detectado',
  p_motivo_status text default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  -- data civil em BRT: gravar em UTC joga a mensagem das 21h30 para o dia seguinte
  insert into maria_grupo_movimento_dia
    (chat_id, message_id, data_referencia, recebido_em, autor_nome,
     tipo_detectado, valor_centavos, descricao_curta, status, motivo_status)
  values
    (p_chat_id, p_message_id,
     (p_recebido_em at time zone 'America/Sao_Paulo')::date,
     p_recebido_em, p_autor_nome, p_tipo_detectado, p_valor_centavos,
     p_descricao_curta, p_status, p_motivo_status)
  on conflict on constraint maria_grupo_movimento_dia_uk do nothing
  returning id into v_id;

  if v_id is null then
    select id into v_id from maria_grupo_movimento_dia
     where chat_id = p_chat_id and message_id = p_message_id;
  end if;
  return v_id;
end $$;
```

- [ ] **Passo 3: Criar a RPC que avança o estado**

```sql
create or replace function maria_grupo_movimento_marcar(
  p_chat_id text, p_message_id text, p_status text,
  p_motivo_status text default null,
  p_conferencia_item_id uuid default null,
  p_conta_pagar_id uuid default null,
  p_fluxo_evento_id uuid default null
) returns boolean
language plpgsql security definer set search_path = public as $$
declare v_afetadas int;
begin
  update maria_grupo_movimento_dia
     set status = p_status,
         motivo_status = coalesce(p_motivo_status, motivo_status),
         conferencia_item_id = coalesce(p_conferencia_item_id, conferencia_item_id),
         conta_pagar_id = coalesce(p_conta_pagar_id, conta_pagar_id),
         fluxo_evento_id = coalesce(p_fluxo_evento_id, fluxo_evento_id),
         atualizado_em = now()
   where chat_id = p_chat_id and message_id = p_message_id;
  get diagnostics v_afetadas = row_count;
  return v_afetadas > 0;
end $$;
```

- [ ] **Passo 4: Provar a idempotência no banco**

Rodar via MCP `execute_sql`:

```sql
select maria_grupo_movimento_registrar(
  'TESTE@g.us','MSG-TESTE-1','2026-08-13T23:40:00Z','Fulano','comprovante',55500,'teste') as id1,
       maria_grupo_movimento_registrar(
  'TESTE@g.us','MSG-TESTE-1','2026-08-13T23:40:00Z','Fulano','comprovante',55500,'teste') as id2;
select count(*) as linhas, min(data_referencia) as data_brt
  from maria_grupo_movimento_dia where chat_id='TESTE@g.us';
```

Esperado: `id1 = id2`, `linhas = 1`, e **`data_brt = 2026-08-13`** (não 14) — a mensagem das 23h40 UTC
é 20h40 em Brasília, ainda dia 13. Se vier 14, a conversão de fuso está errada e **todo relatório
noturno sairá no dia errado**.

- [ ] **Passo 5: Limpar a linha de teste**

```sql
delete from maria_grupo_movimento_dia where chat_id = 'TESTE@g.us';
```

(É dado de teste criado neste passo, não dado de produção — não precisa do OK do Alf, mas confirme
com `select count(*)` que a tabela ficou em 0 antes de seguir.)

- [ ] **Passo 6: Registrar no painel**

Adicionar em `docs/governanca/PAINEL-MARIA.md` uma linha na seção de reportes com a data e o resultado
do Passo 4, e commitar no repo `_remote`.

---

### Tarefa 2: Detector — o que é movimento financeiro

**Arquivos:**
- Criar: `/home/maria/.openclaw/workspace/tools/test_maria_caderno_grupo.js`
- Modificar: `bridge.js` (bloco novo antes de `function shouldSendPostAgentGreenCheckNotice`)

**Interfaces:**
- Consome: `messageLooksLikeMedia(m)` (bridge.js:299), `hojeSaoPauloDate()` (bridge.js:865)
- Produz: `classificarMovimentoGrupo(text, temMidia)` → `{ ehMovimento: boolean, tipo: 'comprovante'|'boleto'|'pix'|'valor_em_texto'|'indefinido', valorCentavos: number|null, descricao: string }`

- [ ] **Passo 1: Escrever o teste que falha**

```javascript
#!/usr/bin/env node
/* O caderno do grupo: registrar na ENTRADA, sem LLM.
 * Medido em 13/08: 31 mensagens no grupo, 4 com comprovante, 0 registros.
 * O que ninguem pede, ninguem ve — e por isso a Rose perde o fio. */
const assert = require('assert');
process.env.MARIA_BRIDGE_TEST_EXPORTS = '1';
const b = require('/home/maria/.openclaw/workspace/bridges/maria-uazapi/bridge.js');

let ok = 0;
function checa(desc, cond) { assert.ok(cond, 'FALHOU: ' + desc); ok++; }

// --- é movimento ---
checa('imagem no grupo é comprovante',
  b.classificarMovimentoGrupo('', true).ehMovimento === true);
checa('texto com valor é movimento',
  b.classificarMovimentoGrupo('paguei o buffet R$ 555,00', false).ehMovimento === true);
checa('valor com milhar é lido certo',
  b.classificarMovimentoGrupo('transferi R$ 1.240,50 pro FGTS', false).valorCentavos === 124050);
checa('pix é reconhecido',
  b.classificarMovimentoGrupo('fiz o pix de R$ 87,40', false).tipo === 'pix');
checa('boleto é reconhecido',
  b.classificarMovimentoGrupo('boleto da Light R$ 300,00', false).tipo === 'boleto');

// --- NÃO é movimento: senão o caderno vira log de conversa ---
checa('bom dia não é movimento',
  b.classificarMovimentoGrupo('bom dia meninas', false).ehMovimento === false);
checa('pergunta não é movimento',
  b.classificarMovimentoGrupo('Maria, como está o mês?', false).ehMovimento === false);
checa('agradecimento não é movimento',
  b.classificarMovimentoGrupo('obrigada!', false).ehMovimento === false);

// --- bordas de valor ---
checa('valor sem R$ ainda conta se tiver centavos',
  b.classificarMovimentoGrupo('foram 1.500,00 no total', false).ehMovimento === true);
checa('número solto NÃO vira valor',
  b.classificarMovimentoGrupo('somos 3 unidades', false).ehMovimento === false);
checa('data não vira valor',
  b.classificarMovimentoGrupo('vence 10/08', false).valorCentavos === null);
checa('imagem sem texto tem valor nulo, não zero',
  b.classificarMovimentoGrupo('', true).valorCentavos === null);

console.log(`RESULTADO: ${ok} ok, 0 falha(s)`);
```

> **Por que "valor nulo, não zero":** zero afirma que a mensagem vale R$ 0,00. Nulo diz "não consegui
> ler". A diferença aparece no relatório: zero entra na soma e a corrompe; nulo manda o item para a
> seção ⚠️.

- [ ] **Passo 2: Rodar e ver falhar**

```bash
ssh maria "sudo -n -u maria node /home/maria/.openclaw/workspace/tools/test_maria_caderno_grupo.js"
```

Esperado: `TypeError: b.classificarMovimentoGrupo is not a function`.

- [ ] **Passo 3: Implementar o detector**

Aplicar por script Python com âncora, inserindo antes de
`function shouldSendPostAgentGreenCheckNotice(stats) {`:

```javascript
// --- caderno do grupo (13/08): registrar na ENTRADA, sem LLM ----------------
// Medido: 31 mensagens/dia no grupo, 4 com comprovante, 0 registros. A conferencia
// so nasce quando alguem pede; o que ninguem pede, ninguem ve.
const RE_VALOR_BRL = /(?:r\$\s*)?(\d{1,3}(?:\.\d{3})*|\d+),(\d{2})\b/i;

function classificarMovimentoGrupo(text, temMidia) {
  const t = String(text || '');
  const norm = t.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  // Data primeiro: "vence 10/08" nao pode virar valor.
  const semData = norm.replace(/\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/g, ' ');
  const m = RE_VALOR_BRL.exec(semData);
  const valorCentavos = m
    ? (parseInt(m[1].replace(/\./g, ''), 10) * 100 + parseInt(m[2], 10))
    : null;

  let tipo = 'indefinido';
  if (/\bpix\b/.test(norm)) tipo = 'pix';
  else if (/\bboleto|codigo de barras|linha digitavel\b/.test(norm)) tipo = 'boleto';
  else if (temMidia) tipo = 'comprovante';
  else if (valorCentavos !== null) tipo = 'valor_em_texto';

  const ehMovimento = Boolean(temMidia) || valorCentavos !== null;
  return {
    ehMovimento,
    tipo: ehMovimento ? tipo : 'indefinido',
    valorCentavos,
    descricao: t.trim().slice(0, 120),
  };
}
```

E adicionar `classificarMovimentoGrupo,` ao bloco de exports de teste (junto de
`assuntoTocaGreenCheck,`).

- [ ] **Passo 4: Rodar até passar**

```bash
ssh maria "sudo -n -u maria node --check /home/maria/.openclaw/workspace/bridges/maria-uazapi/bridge.js && sudo -n -u maria node /home/maria/.openclaw/workspace/tools/test_maria_caderno_grupo.js"
```

Esperado: `RESULTADO: 12 ok, 0 falha(s)`.

- [ ] **Passo 5: Suíte inteira verde**

```bash
ssh maria 'W=/home/maria/.openclaw/workspace; for f in $(sudo -n -u maria ls $W/tools/ | grep test_maria_); do printf "%-46s %s\n" "$f" "$(sudo -n -u maria node $W/tools/$f 2>&1 | tail -1 | cut -c1-40)"; done'
```

Esperado: 9 arquivos, todos verdes (8 anteriores + o novo).

- [ ] **Passo 6: Backup**

```bash
ssh maria "sudo -n -u maria bash -c 'cd /home/maria/.openclaw/workspace && ./scripts/backup-to-github-safe.sh --push'"
```

---

### Tarefa 3: Ligar a captura no caminho da mensagem

**Arquivos:**
- Modificar: `bridge.js`, no handler de entrada, logo após o `log({ event: 'received' ... })`

**Interfaces:**
- Consome: `classificarMovimentoGrupo` (Tarefa 2), `callSuperfolhaRpc(name, payload)` (bridge.js:1854),
  `maria_grupo_movimento_registrar` (Tarefa 1)

- [ ] **Passo 1: Escrever o teste da função de gravação**

Acrescentar ao final de `test_maria_caderno_grupo.js`, antes do `console.log`:

```javascript
// --- gravação: monta o payload certo e não grava conversa comum ---
const chamadas = [];
const rpcFalso = async (nome, payload) => { chamadas.push({ nome, payload }); return 'uuid-fake'; };

(async () => {
  const r1 = await b.registrarMovimentoGrupo({
    chatId: '120363231958653729@g.us', messageId: 'ABC123',
    text: 'paguei o buffet R$ 555,00', temMidia: false,
    autorNome: 'Ana', recebidoEmIso: '2026-08-13T23:40:00.000Z',
  }, rpcFalso);
  checa('grava movimento', r1.gravado === true);
  checa('chama a RPC certa', chamadas[0].nome === 'maria_grupo_movimento_registrar');
  checa('manda o valor em centavos', chamadas[0].payload.p_valor_centavos === 55500);
  checa('manda o autor', chamadas[0].payload.p_autor_nome === 'Ana');
  checa('nasce como detectado', chamadas[0].payload.p_status === 'detectado');

  const r2 = await b.registrarMovimentoGrupo({
    chatId: '120363231958653729@g.us', messageId: 'ABC124',
    text: 'bom dia meninas', temMidia: false,
    autorNome: 'Ana', recebidoEmIso: '2026-08-13T23:41:00.000Z',
  }, rpcFalso);
  checa('conversa comum NÃO grava', r2.gravado === false);
  checa('e não chamou a RPC de novo', chamadas.length === 1);

  // Falha de banco não pode derrubar o atendimento da mensagem.
  const rpcQuebrado = async () => { throw new Error('banco fora'); };
  const r3 = await b.registrarMovimentoGrupo({
    chatId: '120363231958653729@g.us', messageId: 'ABC125',
    text: 'pix de R$ 10,00', temMidia: false,
    autorNome: 'Ana', recebidoEmIso: '2026-08-13T23:42:00.000Z',
  }, rpcQuebrado);
  checa('banco fora não explode, devolve gravado=false', r3.gravado === false);
  checa('e diz o motivo', /banco fora/.test(String(r3.erro || '')));

  console.log(`RESULTADO: ${ok} ok, 0 falha(s)`);
})();
```

E **remover** o `console.log` antigo do fim do arquivo (agora ele vive dentro do bloco assíncrono).

- [ ] **Passo 2: Rodar e ver falhar**

Esperado: `TypeError: b.registrarMovimentoGrupo is not a function`.

- [ ] **Passo 3: Implementar**

```javascript
// Grupo unico por enquanto: ligar isto em todo chat encheria o caderno de conversa
// que nao vira lancamento. Ampliar so com medicao.
const CADERNO_CHATS = new Set(
  (process.env.MARIA_CADERNO_CHATS || '120363231958653729@g.us')
    .split(',').map(s => s.trim()).filter(Boolean)
);

async function registrarMovimentoGrupo(
  { chatId, messageId, text, temMidia, autorNome, recebidoEmIso }, rpc = callSuperfolhaRpc
) {
  if (!CADERNO_CHATS.has(String(chatId || ''))) return { gravado: false, motivo: 'chat fora do caderno' };
  if (!messageId) return { gravado: false, motivo: 'sem message_id' };
  const c = classificarMovimentoGrupo(text, temMidia);
  if (!c.ehMovimento) return { gravado: false, motivo: 'nao parece movimento financeiro' };
  try {
    const id = await rpc('maria_grupo_movimento_registrar', {
      p_chat_id: chatId,
      p_message_id: messageId,
      p_recebido_em: recebidoEmIso,
      p_autor_nome: autorNome || null,
      p_tipo_detectado: c.tipo,
      p_valor_centavos: c.valorCentavos,
      p_descricao_curta: c.descricao,
      p_status: 'detectado',
      p_motivo_status: null,
    });
    log({ level: 'info', event: 'caderno_movimento_registrado', chatId, messageId, tipo: c.tipo });
    return { gravado: true, id };
  } catch (e) {
    // Caderno e observacao: nao pode derrubar o atendimento da mensagem.
    log({ level: 'warn', event: 'caderno_movimento_falhou', chatId, messageId, error: e.message });
    return { gravado: false, erro: e.message };
  }
}
```

Exportar `classificarMovimentoGrupo` e `registrarMovimentoGrupo`.

- [ ] **Passo 4: Chamar no caminho de entrada**

Inserir logo após o `log({ level: 'info', event: 'received', ... })`, **sem `await` bloqueante**:

```javascript
      if (group) {
        registrarMovimentoGrupo({
          chatId, messageId: msgId, text,
          temMidia: Boolean(inboundMedia) || messageLooksLikeMedia(m),
          autorNome: person.nome || sender,
          recebidoEmIso: new Date().toISOString(),
        }).catch(e => log({ level: 'warn', event: 'caderno_erro_inesperado', error: e.message }));
      }
```

> **Por que sem `await`:** o caderno é observação. Se o banco estiver lento, a Rose não pode ficar
> esperando resposta da Maria por causa disso. Mas o `.catch` é obrigatório — promise rejeitada sem
> tratamento derruba o processo no Node moderno.

- [ ] **Passo 5: Rodar teste + suíte + sintaxe**

Esperado: `RESULTADO: 19 ok, 0 falha(s)` e a suíte 9/9.

- [ ] **Passo 6: Reiniciar e provar**

```bash
ssh maria 'sudo -n systemctl restart maria-uazapi-bridge.service; sleep 5; sudo -n ps -eo pid,lstart,cmd | grep "maria-uazapi/bridge.js" | grep -v grep'
```

Esperado: PID novo, horário de agora.

- [ ] **Passo 7: Provar com mensagem real**

Injetar pelo webhook sintético (padrão de `sonda/prova-reacao.py`) uma mensagem com valor no grupo de
teste e conferir:

```sql
select chat_id, tipo_detectado, valor_centavos, status, data_referencia
  from maria_grupo_movimento_dia order by criado_em desc limit 3;
```

Esperado: a linha existe, com `status='detectado'` e `data_referencia` no dia civil de Brasília.

- [ ] **Passo 8: Backup + painel**

Backup na VPS e uma seção nova no `PAINEL-MARIA.md` com o número real capturado no primeiro dia.

---

### Tarefa 4: Marcar o que foi lançado, reusando a reação ✅

**Arquivos:**
- Modificar: `bridge.js`, dentro de `markRecentlyLaunchedReceiptsWithGreenCheck` e das duas irmãs
  (`markRecentlyPaidAccountsWithGreenCheck`, `markRecentlyCreatedEventualAccountsWithGreenCheck`)

**Interfaces:**
- Consome: `maria_grupo_movimento_marcar` (Tarefa 1); o `messageId` já resolvido por
  `resolveLaunchedReceiptMessageId(item, chatId)`

- [ ] **Passo 1: Escrever o teste**

Acrescentar em `test_maria_caderno_grupo.js`:

```javascript
  const marcadas = [];
  const rpcMarcar = async (nome, payload) => { marcadas.push({ nome, payload }); return true; };
  const rm = await b.marcarMovimentoLancado(
    '120363231958653729@g.us', 'ABC123', { conferenciaItemId: null, contaPagarId: 'uuid-conta' }, rpcMarcar);
  checa('marca como lancado', rm === true);
  checa('usa a RPC de marcar', marcadas[0].nome === 'maria_grupo_movimento_marcar');
  checa('status vai como lancado', marcadas[0].payload.p_status === 'lancado');
  checa('leva o vínculo junto', marcadas[0].payload.p_conta_pagar_id === 'uuid-conta');
```

- [ ] **Passo 2: Rodar e ver falhar**

Esperado: `TypeError: b.marcarMovimentoLancado is not a function`.

- [ ] **Passo 3: Implementar**

```javascript
async function marcarMovimentoLancado(chatId, messageId, vinculos = {}, rpc = callSuperfolhaRpc) {
  if (!chatId || !messageId) return false;
  try {
    return await rpc('maria_grupo_movimento_marcar', {
      p_chat_id: chatId,
      p_message_id: messageId,
      p_status: 'lancado',
      p_motivo_status: null,
      p_conferencia_item_id: vinculos.conferenciaItemId || null,
      p_conta_pagar_id: vinculos.contaPagarId || null,
      p_fluxo_evento_id: vinculos.fluxoEventoId || null,
    });
  } catch (e) {
    log({ level: 'warn', event: 'caderno_marcar_falhou', chatId, messageId, error: e.message });
    return false;
  }
}
```

- [ ] **Passo 4: Chamar junto da reação**

Nas três funções de marcação, logo após `await reactWhatsapp(target, messageId, '✅');`:

```javascript
        marcarMovimentoLancado(chatId, messageId, { conferenciaItemId: item.id, fluxoEventoId: item.fluxo_evento_id })
          .catch(() => {});
```

> **Por que aqui:** este ponto **já resolveu** a ligação item ↔ mensagem do grupo — é o que a reação
> usa. Reimplementar essa resolução no caderno seria criar uma segunda verdade que vai divergir da
> primeira.

- [ ] **Passo 5: Teste + suíte + restart provado + backup**

Esperado: `RESULTADO: 23 ok, 0 falha(s)`; suíte 9/9; PID novo.

---

# FATIA 2 — O gerador

**Pré-requisito:** a Fatia 1 rodando há pelo menos um dia, com linhas reais no caderno.

---

### Tarefa 5: Função de controle do período

**Arquivos:** migração via MCP

**Interfaces:**
- Produz: `maria_rel_ctl_periodo(p_chat_id text, p_inicio date, p_fim date)` → `mensagens, lancados, faltando, aguardando, ilegiveis, descartados, total_lancado_centavos`

- [ ] **Passo 1: Aplicar**

```sql
create or replace function maria_rel_ctl_periodo(
  p_chat_id text, p_inicio date, p_fim date
) returns table (
  mensagens int, lancados int, faltando int, aguardando int,
  ilegiveis int, descartados int, total_lancado_centavos bigint
)
language sql stable security definer set search_path = public as $$
  select
    count(*)::int,
    count(*) filter (where status = 'lancado')::int,
    count(*) filter (where status in ('detectado','em_conferencia'))::int,
    count(*) filter (where status = 'aguardando_validacao')::int,
    count(*) filter (where status = 'ilegivel')::int,
    count(*) filter (where status = 'descartado')::int,
    coalesce(sum(valor_centavos) filter (where status = 'lancado'), 0)::bigint
  from maria_grupo_movimento_dia
  where chat_id = p_chat_id
    and data_referencia between p_inicio and p_fim;
$$;
```

- [ ] **Passo 2: Conferir contra o dado real**

```sql
select * from maria_rel_ctl_periodo('120363231958653729@g.us', current_date, current_date);
```

Esperado: `mensagens` bate com o número de linhas capturadas hoje. **Se der 0 e houver linhas, a
comparação de datas está errada** — confira o fuso antes de seguir.

---

### Tarefa 6: Formatador (sem banco, sem rede)

**Arquivos:**
- Criar: `/home/maria/.openclaw/workspace/tools/test_maria_relatorio_formato.js`
- Criar: função `formatarRelatorioPeriodo(dados)` — escrita primeiro no bridge para ser testável em
  Node, depois copiada para a Edge Function na Tarefa 7

**Interfaces:**
- Produz: `formatarRelatorioPeriodo({ janela, dataRef, rotuloPeriodo, mensagensConferidas, lancados, faltando, aguardando, ilegiveis, totalLancadoCentavos })` → `{ mensagem: string, ok: boolean, erro?: string }`
- Cada lista é `[{ descricao, valorCentavos, unidade, hora, motivo }]`

- [ ] **Passo 1: Escrever o teste com o formato aprovado**

```javascript
#!/usr/bin/env node
/* Formato congelado pelo Alf em 13/08 ("nao mudo nada, ficou otimo").
 * Fixtures INVENTADAS: nunca usar dado financeiro real em teste. */
const assert = require('assert');
process.env.MARIA_BRIDGE_TEST_EXPORTS = '1';
const b = require('/home/maria/.openclaw/workspace/bridges/maria-uazapi/bridge.js');

let ok = 0;
function checa(desc, cond) { assert.ok(cond, 'FALHOU: ' + desc); ok++; }

const dia = {
  janela: 'dia', dataRef: '2026-08-13', rotuloPeriodo: 'quarta, 13/08',
  mensagensConferidas: 31, totalLancadoCentavos: 432000,
  lancados: [
    { descricao: 'Buffet LA Culture', valorCentavos: 55500, unidade: 'Barra' },
    { descricao: 'FGTS 06/2026', valorCentavos: 124000, unidade: 'Recreio' },
    { descricao: 'Manutenção de instrumentos', valorCentavos: 30000, unidade: 'Barra' },
    { descricao: 'Item 4', valorCentavos: 1000 }, { descricao: 'Item 5', valorCentavos: 1000 },
    { descricao: 'Item 6', valorCentavos: 1000 }, { descricao: 'Item 7', valorCentavos: 1000 },
  ],
  faltando: [
    { descricao: 'Comprovante da Ana', unidade: 'Barra', hora: '14h32' },
    { descricao: 'Boleto da Light', hora: '16h05' },
    { descricao: 'Pix sem descrição', hora: '18h20' },
  ],
  aguardando: [
    { descricao: 'Aluguel Recreio', valorCentavos: 450000, motivo: 'perguntei o plano de contas às 11h20' },
  ],
  ilegiveis: [{ hora: '11h04', motivo: 'imagem ilegível' }],
};

const r = b.formatarRelatorioPeriodo(dia);
checa('gera mensagem', r.ok === true && r.mensagem.length > 0);
checa('título do dia', r.mensagem.includes('📋 *Fechamento do dia — quarta, 13/08*'));
checa('conta os lançados', r.mensagem.includes('✅ *Lancei hoje — 7*'));
checa('corta em 3 e resume o resto', r.mensagem.includes('_+ 4 outros_'));
checa('seção esperando vocês', r.mensagem.includes('💬 *Esperando vocês — 1*'));
checa('seção do que não leu', r.mensagem.includes('⚠️ *Não consegui ler — 1*'));
checa('total formatado em real', r.mensagem.includes('💰 Total lançado: *R$ 4.320,00*'));
checa('linha de cobertura', r.mensagem.includes('🔎 Conferi *31 mensagens*'));
checa('oferece lançar o que falta', /Quer que eu lance os 3 que faltam\?/.test(r.mensagem));

// --- travas ---
const somaErrada = b.formatarRelatorioPeriodo({ ...dia, totalLancadoCentavos: 999999 });
checa('soma que não bate com a lista ABORTA', somaErrada.ok === false);
checa('e diz por quê', /soma|total/i.test(String(somaErrada.erro)));

const vazio = b.formatarRelatorioPeriodo({
  janela: 'dia', dataRef: '2026-08-13', rotuloPeriodo: 'quarta, 13/08',
  mensagensConferidas: 12, totalLancadoCentavos: 0,
  lancados: [], faltando: [], aguardando: [], ilegiveis: [],
});
checa('dia sem movimento ainda gera mensagem', vazio.ok === true);
checa('e mantém a cobertura visível', vazio.mensagem.includes('Conferi *12 mensagens*'));
checa('sem nada a oferecer, não pergunta', !/Quer que eu lance/.test(vazio.mensagem));

const semCobertura = b.formatarRelatorioPeriodo({ ...dia, mensagensConferidas: null });
checa('sem cobertura medida, ABORTA (não inventa número)', semCobertura.ok === false);

console.log(`RESULTADO: ${ok} ok, 0 falha(s)`);
```

- [ ] **Passo 2: Rodar e ver falhar**

Esperado: `TypeError: b.formatarRelatorioPeriodo is not a function`.

- [ ] **Passo 3: Implementar o formatador**

```javascript
function moedaBR(centavos) {
  return 'R$ ' + (Number(centavos || 0) / 100).toLocaleString('pt-BR',
    { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function linhaItem(it) {
  const partes = [it.descricao || 'sem descrição'];
  if (it.valorCentavos != null) partes.push(moedaBR(it.valorCentavos));
  if (it.unidade) partes.push('_' + it.unidade + '_');
  if (it.hora) partes.push(it.hora);
  if (it.motivo) partes.push('_' + it.motivo + '_');
  return ' • ' + partes.join(' · ');
}

function blocoSecao(emoji, titulo, itens) {
  if (!itens || !itens.length) return '';
  const linhas = itens.slice(0, 3).map(linhaItem);
  const resto = itens.length - 3;
  const cauda = resto > 0 ? `\n _+ ${resto} outros_` : '';
  return `\n${emoji} *${titulo} — ${itens.length}*\n${linhas.join('\n')}${cauda}\n`;
}

const TITULO_JANELA = { dia: 'Fechamento do dia', semana: 'Fechamento da semana', mes: 'Fechamento do mês' };
const ROTULO_LANCEI = { dia: 'Lancei hoje', semana: 'Lancei na semana', mes: 'Lancei no mês' };

function formatarRelatorioPeriodo(d) {
  // Trava: cobertura nao medida nao vira numero inventado.
  if (d.mensagensConferidas == null || !Number.isFinite(Number(d.mensagensConferidas))) {
    return { ok: false, erro: 'cobertura não medida — recuso gerar relatório sem saber quantas mensagens conferi' };
  }
  // Trava: o total tem de ser a soma do que esta listado (o erro "1+9=11").
  const somaLista = (d.lancados || []).reduce((a, i) => a + Number(i.valorCentavos || 0), 0);
  if (Number(d.totalLancadoCentavos || 0) !== somaLista) {
    return { ok: false,
      erro: `total (${d.totalLancadoCentavos}) não bate com a soma da lista (${somaLista})` };
  }

  let msg = `📋 *${TITULO_JANELA[d.janela] || 'Fechamento'} — ${d.rotuloPeriodo}*\n`;
  msg += blocoSecao('✅', ROTULO_LANCEI[d.janela] || 'Lancei', d.lancados);
  msg += blocoSecao('⏳', 'Falta lançar', d.faltando);
  msg += blocoSecao('💬', 'Esperando vocês', d.aguardando);
  msg += blocoSecao('⚠️', 'Não consegui ler', d.ilegiveis);
  msg += `\n━━━━━━━━━━━━━━\n`;
  msg += `💰 Total lançado: *${moedaBR(d.totalLancadoCentavos)}*\n`;
  msg += `🔎 Conferi *${d.mensagensConferidas} mensagens* do grupo\n`;
  const nFalta = (d.faltando || []).length;
  if (nFalta > 0) msg += `\nQuer que eu lance ${nFalta === 1 ? 'o que falta' : `os ${nFalta} que faltam`}?`;
  return { ok: true, mensagem: msg };
}
```

Exportar `formatarRelatorioPeriodo`.

- [ ] **Passo 4: Rodar até passar** — esperado `RESULTADO: 15 ok, 0 falha(s)`.

- [ ] **Passo 5: Suíte 10/10 + backup**

---

### Tarefa 7: Edge Function `maria-relatorio-periodo`

**Arquivos:**
- Criar: Edge Function `maria-relatorio-periodo` (deploy via MCP `deploy_edge_function`)

**Interfaces:**
- Consome: `maria_rel_ctl_periodo` (Tarefa 5), a tabela do caderno, e o formatador da Tarefa 6
  (copiado para TypeScript)
- Produz: `POST { janela, data_ref, chat_id }` → `{ ok, mensagem, contadores }`

- [ ] **Passo 1: Escrever a função**

A função faz três coisas, nesta ordem: (1) resolve a janela em `[inicio, fim]` no fuso de Brasília;
(2) lê os itens e os contadores; (3) chama o formatador. O corpo do formatador é o **mesmo código da
Tarefa 6**, traduzido para TypeScript sem mudança de comportamento — se divergir, o teste do Passo 4
acusa.

Resolução das janelas:

```typescript
function resolverJanela(janela: string, dataRef: string): { inicio: string; fim: string; rotulo: string } {
  const d = new Date(dataRef + 'T12:00:00-03:00'); // meio-dia BRT evita virada de fuso
  if (janela === 'dia') {
    return { inicio: dataRef, fim: dataRef, rotulo: rotuloDia(d) };
  }
  if (janela === 'semana') {
    // 7 dias que TERMINAM na sexta: sabado anterior -> sexta.
    // Nao e "segunda a sexta" porque sabado e domingo cairiam num vao entre semanas.
    const fim = new Date(d);
    const inicio = new Date(d); inicio.setDate(inicio.getDate() - 6);
    return { inicio: iso(inicio), fim: iso(fim), rotulo: `${br(inicio)} a ${br(fim)}` };
  }
  const inicio = new Date(d.getFullYear(), d.getMonth(), 1);
  const fim = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  return { inicio: iso(inicio), fim: iso(fim), rotulo: mesAno(d) };
}
```

- [ ] **Passo 2: Publicar**

Via MCP `deploy_edge_function`, projeto `ubdvtjbitozhkuvvqkxj`.

- [ ] **Passo 3: Chamar para hoje e conferir**

```bash
ssh maria 'E=/home/maria/.openclaw/private/maria.env; K=$(sudo -n -u maria grep -m1 "^FOLHAPAGAMENTO_SUPABASE_SERVICE_ROLE=" $E | cut -d= -f2-); U=$(sudo -n -u maria grep -m1 "^FOLHAPAGAMENTO_SUPABASE_URL=" $E | cut -d= -f2-); curl -s -X POST "$U/functions/v1/maria-relatorio-periodo" -H "authorization: Bearer $K" -H "content-type: application/json" -d "{\"janela\":\"dia\",\"data_ref\":\"$(TZ=America/Sao_Paulo date +%F)\",\"chat_id\":\"120363231958653729@g.us\"}" | python3 -m json.tool | head -40'
```

Esperado: `ok: true` e a mensagem no formato aprovado, **sem enviar nada ao WhatsApp**.

- [ ] **Passo 4: Provar que os dois formatadores concordam**

Rodar o formatador do bridge com os mesmos dados que a função devolveu em `contadores` e comparar
string por string. Divergência aqui é o contrato de três pontas quebrando — corrija antes de seguir.

- [ ] **Passo 5: Registrar no painel + commit no `_remote`**

---

# FATIA 3 — Agendamento

> ⚠️ **A tarefa mais arriscada do plano.** O dispatcher é compartilhado com agenda, contas, folha e
> férias. Errar aqui não quebra só o relatório novo: **cala os que já funcionam.**

---

### Tarefa 8: Suporte a "último dia do mês"

**Arquivos:**
- Modificar: Edge Function `whatsapp-grupo-dispatcher`

- [ ] **Passo 1: Registrar a linha de base ANTES de tocar**

```sql
select tipo, frequencia, horario, dia_semana, dia_mes, ativo,
       ultima_execucao at time zone 'America/Sao_Paulo' as ultima_brt
from whatsapp_grupo_notificacoes order by tipo;
```

Guarde a saída no painel. É contra ela que você vai provar que nada quebrou.

- [ ] **Passo 2: Implementar a convenção `dia_mes = -1`**

No trecho que decide disparar mensal, trocar a comparação direta por:

```typescript
function ehDiaDoMes(hoje: Date, diaMes: number): boolean {
  if (diaMes === -1) {
    // ultimo dia: varia entre 28 e 31, e fevereiro bissexto e o caso que quebra
    const ultimo = new Date(hoje.getFullYear(), hoje.getMonth() + 1, 0).getDate();
    return hoje.getDate() === ultimo;
  }
  return hoje.getDate() === diaMes;
}
```

- [ ] **Passo 3: Provar as datas de virada, sem publicar ainda**

```javascript
// 31/01, 28/02 (comum), 29/02 (bissexto) disparam; 30/01 nao dispara
[['2026-01-31', true], ['2026-01-30', false], ['2026-02-28', true], ['2028-02-29', true], ['2028-02-28', false]]
```

- [ ] **Passo 4: Publicar e provar que o que já funcionava continua**

Depois do deploy, esperar o próximo ciclo de 5 min e conferir que `contas_a_pagar_dia` continua com
`ultima_execucao` avançando. **Se parar, reverta imediatamente** — a Rose depende do relatório das
08h.

---

### Tarefa 9: Cadastrar os três agendamentos

- [ ] **Passo 1: Inserir INATIVOS**

```sql
insert into whatsapp_grupo_notificacoes (destino_id, tipo, frequencia, horario, dia_semana, dia_mes, ativo, observacao)
values
  (null, 'relatorio_operacional_dia',    'diario',  '20:30', null, null, false, 'Fechamento do dia para a Rose — Financeiro Grupo LA Music'),
  (null, 'relatorio_operacional_semana', 'semanal', '20:30', 5,    null, false, 'Fechamento da semana, sexta'),
  (null, 'relatorio_operacional_mes',    'mensal',  '20:30', null, -1,   false, 'Fechamento do mês, último dia');
```

> Nascem **inativos** de propósito: ligar só depois do disparo manual bem-sucedido da Tarefa 10.
> Confirme antes qual valor de `dia_semana` o dispatcher usa para sexta (0=domingo ou 1=segunda) — ler
> o código, não supor.

- [ ] **Passo 2: Ensinar o dispatcher a gerar o tipo novo**

Adicionar o caso que chama `maria-relatorio-periodo` com a janela correspondente e entrega o
`mensagem` retornado. **Se a função devolver `ok:false`, entregar a mensagem de falha** — nunca pular
em silêncio.

---

# FATIA 4 — Ligar e observar

### Tarefa 10: Disparo manual assistido

- [ ] **Passo 1:** disparar o diário manualmente com a Rose avisada, conferir o texto **antes** de
  entregar no grupo (gerar, ler, e só então mandar).
- [ ] **Passo 2:** conferir com ela se as quatro seções refletem o dia.
- [ ] **Passo 3:** ativar os três agendamentos (`ativo = true`).
- [ ] **Passo 4:** no dia seguinte, provar que saiu às 20h30 — `ultima_execucao` e a mensagem no grupo.

### Tarefa 11: Observação de 30 dias

- [ ] **Passo 1:** anotar no painel, a cada semana: quantas mensagens conferidas, quantos itens em cada
  seção, e se a Rose respondeu.
- [ ] **Passo 2:** se a linha de cobertura cair muito abaixo da média sem explicação, investigar a
  captura — é o alarme desenhado para isso.
- [ ] **Passo 3:** se a Rose parar de responder ao relatório, o formato está errado. Revisar com ela,
  não insistir.

---

## Auto-revisão deste plano

**Cobertura da spec:** §4 (arquitetura) → Tarefas 2-7. §5 (dados) → Tarefas 1 e 5. §6 (gerador e
formato) → Tarefas 6-7. §7 (travas) → embutidas nas Tarefas 6 e 9, não isoladas — trava em tarefa
separada tende a virar "depois". §8 (agendamento) → Tarefas 8-9. §10 (testes) → dentro de cada tarefa.
§11 (fora de escopo) → nada aqui liga o snapshot.

**Consistência de nomes:** `classificarMovimentoGrupo` → `registrarMovimentoGrupo` →
`marcarMovimentoLancado` → `formatarRelatorioPeriodo`; RPCs `maria_grupo_movimento_registrar`,
`maria_grupo_movimento_marcar`, `maria_rel_ctl_periodo`. Conferidos entre tarefas.

**Lacuna assumida e declarada:** a transição para `aguardando_validacao` (a seção 💬) **não tem tarefa
própria** neste plano. Ela depende de identificar o momento em que a Maria faz a pergunta de
confirmação, e esse ponto do bridge ainda não foi medido. **Até que exista, a seção 💬 virá sempre
vazia** — o relatório funciona, mas com três seções de quatro. Medir e implementar isso é a primeira
tarefa da próxima rodada, e está escrito aqui para não passar por pronto.
