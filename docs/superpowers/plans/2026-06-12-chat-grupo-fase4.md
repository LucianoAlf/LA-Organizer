# Chat de Grupo — Fase 4 (Espelho WhatsApp ↔ App, v1 texto) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Espelhar bidirecionalmente o chat de grupo do app (`group_chat_messages`) com um grupo real de WhatsApp, mantendo UM TOM com UMA memória (mesma tabela/contexto).

**Architecture:** Entrada via o `webhook.js` que já existe (estendido p/ aceitar só o grupo linkado), saída via um poller que posta no WhatsApp o que nasceu no app. O watcher da Fase 3 não muda — ele continua acionando o TOM em `role='member'`, agora enxergando também as mensagens vindas do WhatsApp. Anti-loop por `wasSentByApi` (UAZAPI) + `wa_message_id` (dedup/marca de espelhada).

**Tech Stack:** Node CJS (`_remote/src`), axios → UAZAPI (`config.uazapi.url`+`token`), Supabase (service_role no engine), `node:test` (testes), deploy por SCP + `pm2 restart tom`.

**Convenções deste repositório (LER ANTES):**
- `_remote` **não é git**; **não** rodar `git commit`/`git add`. Backend (`src/`) é deployado por `scp <arq> tom:/opt/LA-Organizer/<arq>` + `ssh tom "pm2 restart tom"`. O auto-deploy (Stop hook) commita tudo no fim do turno.
- `src/` **não passa por tsc**. Validar com `node --check <arq>`.
- Testes de função pura: `node --test <arq.test.js>` (roda em qualquer lugar). Testes que usam supabase/UAZAPI: rodar **na VPS** com `ssh tom "cd /opt/LA-Organizer && node --env-file=.env --test <arq.test.js>"`.
- Supabase via MCP (`apply_migration`, `execute_sql`) — pré-aprovado.
- Grupo de teste: work_group **Financeiro** `id=d95f63af-5032-4120-89f2-ca4c49684cbc`.

---

## Estrutura de arquivos

| Arquivo | Responsabilidade |
|---|---|
| `src/services/uazapi-groups.js` (criar) | Falar com a UAZAPI sobre grupos: `listGroups()` (achar JID) e `sendGroupText(jid, text)`. |
| `src/services/group-chat-bridge-out.js` (criar) | App → WhatsApp: `buildWhatsappText(msg, senderName)` (pura) + `runOutboundOnce(supabase, deps)`. |
| `src/services/group-chat-bridge-in.js` (criar) | WhatsApp → App: `maybeHandleGroupMessage(supabase, body, helpers)`. |
| `src/services/group-chat-bridge-out.test.js` (criar) | Testes puros de `buildWhatsappText`. |
| `src/services/group-chat-bridge-in.test.js` (criar) | Testes puros dos helpers de extração de grupo. |
| `src/webhook.js` (modificar ~L116-131) | Rotear mensagem de grupo linkado pro bridge-in antes do `isIgnorable`. |
| `src/realtime/group-chat-watcher.js` (modificar) | Chamar `runOutboundOnce` a cada tick (mesmo poll que já roda). |
| `scripts/link-wa-group.js` (criar, descartável) | Listar grupos UAZAPI e ajudar a gravar o `wa_group_jid` do Financeiro. |

---

## Task 1: Migration — colunas `wa_group_jid` e `wa_sender_name`

**Files:**
- Aplicar via MCP `apply_migration` (sem arquivo local obrigatório).

- [ ] **Step 1: Aplicar a migration**

Use a ferramenta MCP `apply_migration` no projeto `cesnbnrynvxvgdhfmaua`, name `fase4_wa_mirror_columns`, query:

```sql
alter table public.work_groups
  add column if not exists wa_group_jid text;
create unique index if not exists work_groups_wa_group_jid_uq
  on public.work_groups (wa_group_jid) where wa_group_jid is not null;

alter table public.group_chat_messages
  add column if not exists wa_sender_name text;
```

- [ ] **Step 2: Verificar**

Use MCP `execute_sql`:
```sql
select column_name from information_schema.columns
where table_schema='public' and table_name='work_groups' and column_name='wa_group_jid';
select column_name from information_schema.columns
where table_schema='public' and table_name='group_chat_messages' and column_name='wa_sender_name';
```
Esperado: 1 linha em cada.

- [ ] **Step 3: Confirmar default de `channel`** (load-bearing pra saída)

```sql
select column_default from information_schema.columns
where table_schema='public' and table_name='group_chat_messages' and column_name='channel';
```
Esperado: default `'app'`. Se NÃO for `'app'`, **pare e avise** — o front precisa passar a setar `channel:'app'` no insert (`web/src/hooks/useGroupChat.ts`).

---

## Task 2: `uazapi-groups.js` — listGroups + sendGroupText

**Files:**
- Create: `src/services/uazapi-groups.js`

- [ ] **Step 1: Criar o módulo**

```js
// src/services/uazapi-groups.js
// Conversa com a UAZAPI sobre GRUPOS (Fase 4): listar grupos (achar JID) e enviar texto
// pra um grupo. Reusa a config da instância (mesma do whatsapp.js).
const axios = require('axios');
const config = require('../config');

const api = axios.create({
  baseURL: config.uazapi.url,
  headers: { 'Content-Type': 'application/json', token: config.uazapi.token },
  timeout: 15000,
});

// Lista os grupos da instância. Doc UAZAPI: GET /group/list → { groups: [Group] };
// Group tem JID ("...@g.us") + Name. Retorna [{ jid, name }].
async function listGroups() {
  const resp = await api.get('/group/list');
  const raw = resp.data?.groups || [];
  return raw.map((g) => ({ jid: g.JID, name: g.Name || '' })).filter((g) => g.jid);
}

// Resolve o JID pelo código de convite (a parte depois de chat.whatsapp.com/).
// Doc UAZAPI: POST /group/inviteInfo { invitecode } → Group { JID: "...@g.us" }.
async function getGroupJidByInvite(invitecode) {
  const resp = await api.post('/group/inviteInfo', { invitecode });
  return resp.data?.JID || null;
}

// Posta texto num grupo. `jid` = "xxxxxxxx@g.us" — o campo `number` do /send/text aceita
// @g.us (confirmado na doc). Resposta = schema Message → campo `messageid`.
async function sendGroupText(jid, text) {
  const resp = await api.post('/send/text', { number: jid, text, readchat: true });
  const d = resp.data || {};
  return d.messageid || d.id || (d.key && d.key.id) || null;
}

module.exports = { listGroups, getGroupJidByInvite, sendGroupText };
```

- [ ] **Step 2: Syntax check + deploy**

```bash
node --check src/services/uazapi-groups.js
scp src/services/uazapi-groups.js tom:/opt/LA-Organizer/src/services/uazapi-groups.js
```
(Sem restart ainda — ninguém usa esse módulo até a Task 5/6.)

---

## Task 3: Achar o JID do Financeiro e linkar

**Files:**
- Create (descartável): `scripts/link-wa-group.js`

- [ ] **Step 1: Script de descoberta**

```js
// scripts/link-wa-group.js — roda na VPS: node --env-file=.env scripts/link-wa-group.js
// Resolve o JID direto pelo código de convite; lista todos como conferência.
const { getGroupJidByInvite, listGroups } = require('../src/services/uazapi-groups');
const INVITE = 'KDjz7skJhjzAwzzI1eXB1b'; // a parte depois de chat.whatsapp.com/
(async () => {
  try {
    const jid = await getGroupJidByInvite(INVITE);
    console.log('>>> JID do Financeiro (pelo convite):', jid);
  } catch (e) { console.error('inviteInfo falhou:', e.response?.status, e.message); }
  console.log('--- todos os grupos (conferência) ---');
  try { for (const g of await listGroups()) console.log(`  ${g.jid}  ::  ${g.name}`); }
  catch (e) { console.error('listGroups falhou:', e.response?.status, e.message); }
})().catch((e) => { console.error('ERRO:', e.response?.status, e.message); process.exit(1); });
```

- [ ] **Step 2: Rodar na VPS e capturar o JID**

```bash
scp scripts/link-wa-group.js tom:/opt/LA-Organizer/scripts/link-wa-group.js
ssh tom "cd /opt/LA-Organizer && node --env-file=.env scripts/link-wa-group.js"
```
Esperado: linha `>>> JID do Financeiro (pelo convite): 1203...@g.us`. Se o convite tiver expirado/trocado, pegar o JID do grupo "Financeiro Grupo LA Music" na lista de conferência.
**Se der 503/timeout:** a instância UAZAPI pode estar hibernando (known issue `project_uazapi_hibernation`) — checar `instance.status` no painel e re-tentar.

- [ ] **Step 3: Gravar o JID no work_group Financeiro**

Use MCP `execute_sql` (troque `<JID>` pelo JID achado):
```sql
update public.work_groups set wa_group_jid = '<JID>'
where id = 'd95f63af-5032-4120-89f2-ca4c49684cbc';
select id, name, wa_group_jid from public.work_groups where wa_group_jid is not null;
```
Esperado: 1 linha, Financeiro com o JID.

---

## Task 4: `buildWhatsappText` (saída, função PURA) + testes

**Files:**
- Create: `src/services/group-chat-bridge-out.js` (só a função pura nesta task)
- Test: `src/services/group-chat-bridge-out.test.js`

- [ ] **Step 1: Escrever os testes que falham**

```js
// src/services/group-chat-bridge-out.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const { buildWhatsappText } = require('./group-chat-bridge-out');

test('membro vira "💬 *Nome*: texto"', () => {
  assert.equal(
    buildWhatsappText({ role: 'member', kind: 'text', content: 'bom dia' }, 'Rose Silva'),
    '💬 *Rose*: bom dia'
  );
});
test('membro sem nome cai no fallback sem asterisco', () => {
  assert.equal(buildWhatsappText({ role: 'member', kind: 'text', content: 'oi' }, ''), '💬 oi');
});
test('TOM manda só a prosa, sem o bloco de ACTIONS', () => {
  const msg = { role: 'tom', kind: 'text', content: 'Pode deixar, Rose!\n‹‹ACTIONS››[{"kind":"task"}]' };
  assert.equal(buildWhatsappText(msg, ''), 'Pode deixar, Rose!');
});
test('TOM sem prosa (só ACTIONS) → null (não espelha)', () => {
  assert.equal(buildWhatsappText({ role: 'tom', kind: 'text', content: '‹‹ACTIONS››[{"x":1}]' }, ''), null);
});
test('report (card HTML) → null', () => {
  assert.equal(buildWhatsappText({ role: 'tom', kind: 'report', content: '<div>x</div>' }, ''), null);
});
test('mídia (kind != text) → null no v1', () => {
  assert.equal(buildWhatsappText({ role: 'member', kind: 'image', content: '' }, 'Ana'), null);
});
test('membro com texto vazio → null', () => {
  assert.equal(buildWhatsappText({ role: 'member', kind: 'text', content: '   ' }, 'Ana'), null);
});
```

- [ ] **Step 2: Rodar e ver falhar**

```bash
node --test src/services/group-chat-bridge-out.test.js
```
Esperado: FAIL (`Cannot find module './group-chat-bridge-out'`).

- [ ] **Step 3: Implementar o módulo (só a função pura)**

```js
// src/services/group-chat-bridge-out.js
// App → WhatsApp. Esta task entrega só a função PURA buildWhatsappText.
// O runner runOutboundOnce é adicionado na Task 5.
const ACTIONS_DELIM = '‹‹ACTIONS››';

function firstName(name) {
  return String(name || '').trim().split(/\s+/)[0] || '';
}

// Converte uma row de group_chat_messages (channel='app') no texto a postar no WhatsApp.
// Retorna string, ou null quando NÃO deve espelhar (mídia, report, ou TOM sem prosa).
function buildWhatsappText(msg, senderName) {
  if (!msg || (msg.kind && msg.kind !== 'text')) return null; // v1: só texto
  if (msg.role === 'tom') {
    const prose = String(msg.content || '').split(ACTIONS_DELIM)[0].trim();
    return prose || null;
  }
  const body = String(msg.content || '').trim();
  if (!body) return null;
  const nm = firstName(senderName);
  return nm ? `💬 *${nm}*: ${body}` : `💬 ${body}`;
}

module.exports = { buildWhatsappText, firstName };
```

- [ ] **Step 4: Rodar e ver passar**

```bash
node --test src/services/group-chat-bridge-out.test.js
```
Esperado: PASS (7/7).

---

## Task 5: `runOutboundOnce` (poller de saída) + wire no watcher

**Files:**
- Modify: `src/services/group-chat-bridge-out.js` (adicionar o runner)
- Modify: `src/realtime/group-chat-watcher.js` (chamar no tick)

- [ ] **Step 1: Adicionar o runner ao bridge-out**

No fim de `src/services/group-chat-bridge-out.js`, ANTES do `module.exports`, adicionar:

```js
// Espelha pro WhatsApp as mensagens nascidas no app (channel='app') ainda não enviadas.
// deps.sendGroupText(jid, text) injetado (uazapi-groups). Degrada gracioso: 503 → re-tenta
// no próximo ciclo (deixa wa_message_id null). Marca 'skipped' o que não se espelha (mídia/report).
async function runOutboundOnce(supabase, deps, limit = 10) {
  const { data: groups } = await supabase.from('work_groups')
    .select('id, wa_group_jid').not('wa_group_jid', 'is', null);
  const byId = new Map((groups || []).map((g) => [g.id, g.wa_group_jid]));
  if (!byId.size) return 0;

  const { data: rows } = await supabase.from('group_chat_messages')
    .select('id, group_id, role, kind, content, sender_id, wa_sender_name, ' +
            'sender:collaborators!group_chat_messages_sender_id_fkey(full_name, preferred_name)')
    .in('group_id', [...byId.keys()])
    .eq('channel', 'app').is('wa_message_id', null)
    .order('created_at', { ascending: true }).limit(limit);

  let sent = 0;
  for (const m of rows || []) {
    const jid = byId.get(m.group_id);
    const senderName = m.sender?.preferred_name || m.sender?.full_name || m.wa_sender_name || '';
    const text = buildWhatsappText(m, senderName);
    if (!text) {
      // nada a espelhar → marca pra não reprocessar todo ciclo
      await supabase.from('group_chat_messages').update({ wa_message_id: 'skipped' }).eq('id', m.id);
      continue;
    }
    try {
      const waId = await deps.sendGroupText(jid, text);
      await supabase.from('group_chat_messages').update({ wa_message_id: waId || 'sent' }).eq('id', m.id);
      sent++;
    } catch (e) {
      console.error(`[Bridge-out] falha msg=${m.id} (re-tenta): ${e.response?.status || ''} ${e.message}`);
      // NÃO marca wa_message_id → re-tenta no próximo tick (resiliente à hibernação 503)
    }
  }
  return sent;
}
```

E trocar o export para:
```js
module.exports = { buildWhatsappText, firstName, runOutboundOnce };
```

- [ ] **Step 2: Syntax check + re-rodar os testes da Task 4 (não podem quebrar)**

```bash
node --check src/services/group-chat-bridge-out.js
node --test src/services/group-chat-bridge-out.test.js
```
Esperado: syntax OK + 7/7 PASS.

- [ ] **Step 3: Chamar no tick do watcher**

Em `src/realtime/group-chat-watcher.js`:

(a) no topo, junto dos outros require:
```js
const { runOutboundOnce } = require('../services/group-chat-bridge-out');
const { sendGroupText } = require('../services/uazapi-groups');
```

(b) dentro de `async function tick(supabaseMain)`, logo após `await sweepEngaged(supabaseMain);`, adicionar:
```js
    try { await runOutboundOnce(supabaseMain, { sendGroupText }); }
    catch (e) { console.error('[Bridge-out] tick err:', e.message); }
```

- [ ] **Step 4: Syntax check + deploy**

```bash
node --check src/realtime/group-chat-watcher.js
scp src/services/group-chat-bridge-out.js tom:/opt/LA-Organizer/src/services/group-chat-bridge-out.js
scp src/realtime/group-chat-watcher.js tom:/opt/LA-Organizer/src/realtime/group-chat-watcher.js
ssh tom "pm2 restart tom >/dev/null 2>&1 && echo RESTARTED"
```

- [ ] **Step 5: Smoke da saída (App → WhatsApp)**

Inserir uma mensagem de membro como Alf no Financeiro via MCP `execute_sql`:
```sql
insert into group_chat_messages (group_id, sender_id, role, kind, content, channel)
values ('d95f63af-5032-4120-89f2-ca4c49684cbc','0576f4b6-183d-4cf1-980e-5c8d5da0177f','member','text','teste fase 4 saída','app');
```
Aguardar ~8s. Conferir no **grupo do WhatsApp** que apareceu "💬 *Alf*: teste fase 4 saída". E no banco que `wa_message_id` foi preenchido:
```sql
select content, wa_message_id from group_chat_messages
where group_id='d95f63af-5032-4120-89f2-ca4c49684cbc' and content='teste fase 4 saída';
```
Esperado: `wa_message_id` não-nulo. **Limpar** depois (delete dessa row).

---

## Task 6: `maybeHandleGroupMessage` (entrada) + testes dos helpers

**Files:**
- Create: `src/services/group-chat-bridge-in.js`
- Test: `src/services/group-chat-bridge-in.test.js`

- [ ] **Step 1: Testes puros (extração de campos do payload de grupo)**

```js
// src/services/group-chat-bridge-in.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const { extractGroupJid, extractSenderPhone, isGroupMessage } = require('./group-chat-bridge-in');

test('isGroupMessage true só quando data.isGroup === true', () => {
  assert.equal(isGroupMessage({ data: { isGroup: true } }), true);
  assert.equal(isGroupMessage({ data: { isGroup: false } }), false);
  assert.equal(isGroupMessage({ data: {} }), false);
  assert.equal(isGroupMessage({}), false);
});
test('extractGroupJid pega data.chatid', () => {
  assert.equal(extractGroupJid({ data: { chatid: '12345@g.us' } }), '12345@g.us');
  assert.equal(extractGroupJid({ data: {} }), null);
});
test('extractSenderPhone tira só dígitos do participante', () => {
  assert.equal(extractSenderPhone({ data: { sender: '5521999998888@s.whatsapp.net' } }), '5521999998888');
  assert.equal(extractSenderPhone({ data: { sender: '' } }), null);
});
```

- [ ] **Step 2: Rodar e ver falhar**

```bash
node --test src/services/group-chat-bridge-in.test.js
```
Esperado: FAIL (módulo não existe).

- [ ] **Step 3: Implementar o bridge-in**

```js
// src/services/group-chat-bridge-in.js
// WhatsApp → App. Chamado pelo webhook ANTES do isIgnorable. Trata só mensagens de
// GRUPO LINKADO (work_groups.wa_group_jid). Insere em group_chat_messages como role='member',
// channel='whatsapp' — o watcher (Fase 3) aciona o TOM normalmente.

function isGroupMessage(body) {
  return body?.data?.isGroup === true;
}
function extractGroupJid(body) {
  return body?.data?.chatid || null;
}
// Número do PARTICIPANTE que mandou (no grupo, o remetente é data.sender, não o chatid).
function extractSenderPhone(body) {
  const raw = String(body?.data?.sender || '').replace(/\D/g, '');
  return raw || null;
}

// Retorna { handled: boolean }. handled=true => o webhook deve PARAR (não seguir pro 1:1).
async function maybeHandleGroupMessage(supabase, body, helpers) {
  try {
    if (!isGroupMessage(body)) return { handled: false };
    if (body?.data?.fromMe === true) return { handled: true }; // eco do bot — ignora
    const jid = extractGroupJid(body);
    if (!jid) return { handled: false };

    const { data: group } = await supabase.from('work_groups')
      .select('id').eq('wa_group_jid', jid).maybeSingle();
    if (!group) return { handled: false }; // grupo não linkado → deixa o fluxo normal descartar

    const waId = helpers.extractMessageId(body) || null;
    if (waId) {
      const { data: dup } = await supabase.from('group_chat_messages')
        .select('id').eq('wa_message_id', waId).maybeSingle();
      if (dup) return { handled: true }; // já espelhada
    }

    const text = helpers.extractText(body);
    if (!text || !String(text).trim()) return { handled: true }; // v1: só texto

    const phone = extractSenderPhone(body);
    let sender_id = null;
    if (phone) {
      const { data: collab } = await supabase.from('collaborators')
        .select('id').or(`phone.eq.${phone},phone.eq.${phone.replace(/^55/, '')}`).maybeSingle();
      sender_id = collab?.id || null;
    }
    const waName = body?.data?.senderName || body?.data?.pushName || null;

    await supabase.from('group_chat_messages').insert({
      group_id: group.id,
      sender_id,
      role: 'member',
      kind: 'text',
      content: String(text).trim(),
      channel: 'whatsapp',
      wa_message_id: waId,
      wa_sender_name: sender_id ? null : waName,
    });
    console.log(`[Bridge-in] WA→app grupo=${group.id} sender=${sender_id ? 'collab' : (waName || '?')}`);
    return { handled: true };
  } catch (e) {
    console.error('[Bridge-in] erro:', e.message);
    return { handled: true }; // erro nosso: não cair no fluxo 1:1 com payload de grupo
  }
}

module.exports = { maybeHandleGroupMessage, isGroupMessage, extractGroupJid, extractSenderPhone };
```

- [ ] **Step 4: Rodar e ver passar + syntax**

```bash
node --test src/services/group-chat-bridge-in.test.js
node --check src/services/group-chat-bridge-in.js
```
Esperado: PASS (3/3) + syntax OK.

---

## Task 7: Wire no `webhook.js` (rotear grupo linkado)

**Files:**
- Modify: `src/webhook.js` (dentro de `processWebhookBody`, após o dedupe ~L125, ANTES do `isIgnorable` ~L128)

- [ ] **Step 1: Require no topo do arquivo**

Junto dos outros require do topo de `src/webhook.js`:
```js
const groupBridgeIn = require('./services/group-chat-bridge-in');
```

- [ ] **Step 2: Interceptar grupo linkado antes do isIgnorable**

Em `processWebhookBody`, logo APÓS o bloco de dedupe (o `if (dedupe.isDuplicate(body)) { ... return; }`) e ANTES de `if (whatsapp.isIgnorable(body))`, inserir:

```js
    // Fase 4 — espelho de grupo: se a mensagem é de um grupo LINKADO, trata aqui e para.
    // (Grupos não-linkados continuam caindo no isIgnorable abaixo e sendo descartados.)
    const grp = await groupBridgeIn.maybeHandleGroupMessage(supabase, body, {
      extractText: whatsapp.extractText,
      extractMessageId: audio.extractMessageId,
    });
    if (grp.handled) return;
```

**Confirmar no topo do webhook.js** que `supabase`, `whatsapp` e `audio` já estão importados (estão — são usados no resto do arquivo). Se `supabase` não estiver no escopo do módulo, usar o mesmo client que o resto do handler usa.

- [ ] **Step 3: Syntax check + deploy**

```bash
node --check src/webhook.js
scp src/webhook.js tom:/opt/LA-Organizer/src/webhook.js
scp src/services/group-chat-bridge-in.js tom:/opt/LA-Organizer/src/services/group-chat-bridge-in.js
ssh tom "pm2 restart tom >/dev/null 2>&1 && echo RESTARTED"
```

---

## Task 8: Config do webhook UAZAPI (liberar grupos) — AÇÃO COM OK DO ALF

**Files:** nenhum (config no painel UAZAPI ou via API UAZAPI).

- [ ] **Step 1: Confirmar com o Alf antes de mexer** (afeta produção do TOM 1:1)

O webhook da instância de produção precisa entregar mensagens de grupo. No painel UAZAPI (ou via API), na config do webhook:
- **Escutar eventos:** `messages`
- **Excluir dos escutados:** manter `wasSentByApi`; **REMOVER** `isGroupYes` (se estiver lá).
- **URL:** a mesma que já recebe o 1:1 (não mudar).

- [ ] **Step 2: Verificar que grupos chegam**

Após ajustar, mandar UMA mensagem no grupo do WhatsApp e checar o log:
```bash
ssh tom "pm2 logs tom --lines 60 --nostream | grep -iE 'Bridge-in|isGroup|SKIP'"
```
Esperado: ver `[Bridge-in] WA→app` (mensagem do grupo linkado entrou). Se aparecer só `SKIP isIgnorable`, o `isGroupYes` ainda está excluindo (ou a interceptação da Task 7 está depois do isIgnorable — conferir ordem).

---

## Task 9: Validação E2E + memória única + limpeza + known issue

**Files:** nenhum (validação).

- [ ] **Step 1: E2E ida-e-volta**

1. Mandar no **grupo do WhatsApp**: "fala tom, me lembra sexta de conferir o caixa".
   - Conferir no app (chat do Financeiro) que a mensagem apareceu (`channel='whatsapp'`).
   - Conferir que o TOM respondeu **no app E no WhatsApp** (resposta natural + tarefa com `remind_at`).
2. Digitar no **app** (chat do Financeiro) como membro: "testando do app".
   - Conferir no **WhatsApp** que apareceu "💬 *Nome*: testando do app".

```sql
select role, channel, left(content,50) as content, wa_message_id is not null as espelhada
from group_chat_messages where group_id='d95f63af-5032-4120-89f2-ca4c49684cbc'
order by created_at desc limit 8;
```
Esperado: sem duplicatas; toda row tem `wa_message_id` preenchido (espelhada=true).

- [ ] **Step 2: Prova de MEMÓRIA ÚNICA (requisito de 1ª classe)**

No **WhatsApp**: "fala tom, anota que o fornecedor X mudou o vencimento pro dia 20".
Depois, no **app**: "fala tom, qual foi a mudança do fornecedor X que falei?".
Esperado: o TOM lembra (mesma `group_chat_messages` + `tom_chat_memory`). Prova que é UM TOM com UMA memória nos dois canais.

- [ ] **Step 3: Anti-loop**

Verificar que NENHUMA mensagem foi espelhada duas vezes nem gerou eco (cada `wa_message_id` único; nenhuma mensagem `channel='whatsapp'` reenviada pro WhatsApp). Conferir log sem repique:
```bash
ssh tom "pm2 logs tom --lines 80 --nostream | grep -iE 'Bridge-out|Bridge-in'"
```

- [ ] **Step 4: Limpar mensagens de teste**

Apagar via MCP `execute_sql` as mensagens de teste criadas nesta validação (manter o chat limpo pras meninas). Filtrar pelos conteúdos de teste usados.

- [ ] **Step 5: Registrar na `tom_known_issues`** (protocolo do repo)

`execute_sql` INSERT com `codigo='GROUPCHAT-FASE4-WA-MIRROR'`, area `'realtime'`, status `'corrigido'`, descrevendo causa (não existia ponte) e fix (bridge-in/out + config webhook). Padrão de sinal: "mensagem de grupo WhatsApp não aparece no app ou vice-versa; TOM com memória diferente entre canais".

---

## Self-Review (preenchido pelo autor do plano)

- **Cobertura da spec:** schema (T1) ✓; uazapi-groups (T2) ✓; JID/link (T3) ✓; saída pura+runner (T4/T5) ✓; entrada (T6) + webhook (T7) ✓; config webhook (T8) ✓; anti-loop (T6 dedup + T5 marca wa_message_id + T8 wasSentByApi) ✓; identidade (T6 phone→collab + wa_sender_name) ✓; erro 503 (T5 re-tenta) ✓; memória única (T9 Step 2) ✓; validação (T9) ✓.
- **Sem placeholders:** endpoints e campos da UAZAPI **confirmados na doc oficial** (OpenAPI): `GET /group/list` → `{groups:[{JID,Name}]}`; `POST /group/inviteInfo {invitecode}` → `{JID}`; `/send/text` aceita `number=@g.us` e responde com `messageid`; payload de webhook tem `chatid/sender/senderName/isGroup/fromMe/messageid/text`. Nada "a confirmar"; sem "TODO/depois".
- **Consistência de nomes:** `buildWhatsappText`, `runOutboundOnce(supabase, deps, limit)`, `sendGroupText(jid,text)`, `maybeHandleGroupMessage(supabase, body, helpers)` usados de forma idêntica entre tasks. `channel='app'|'whatsapp'`, `wa_message_id`, `wa_sender_name`, `wa_group_jid` consistentes.
