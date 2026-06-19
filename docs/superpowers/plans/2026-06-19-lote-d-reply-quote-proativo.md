# Lote D — Reply-quote a proativo (vínculo mensagem→tarefa) — Plano de Implementação

> **Para workers agênticos:** SUB-SKILL OBRIGATÓRIA: use `superpowers:subagent-driven-development` (recomendado) ou `superpowers:executing-plans` para implementar task-a-task. Os passos usam checkbox (`- [ ]`).

> ✅ **HOLD LIBERADO pelo Alf (19/06).** Em implementação; Balde A destravado.
>
> **AJUSTE pós-aprovação (verificado no banco):** a coluna `whatsapp_message_id` JÁ
> existe em `conversation_history` (documentada como "ID externo UAZAPI", nunca escrita
> pelo código) — **reusá-la** em vez de criar `wa_message_id`. A migration passa a
> adicionar só `ref_type`+`ref_id`. Onde o plano disser `wa_message_id`, ler
> `whatsapp_message_id`. Protocolo de bugs consultado: sem regressão (interceptor roda
> após short-circuits, não abre intent → evita GUARD-CONFIRM-LOOP; reusa reschedule por
> marker → TASK-RESCHED-ONESHOT; restringe ao id concreto → evita RECUR-TEMPLATE-DUP).

**Goal:** Quando o usuário responde (reply-quote) a um lembrete proativo do TOM pedindo
"muda pra amanhã / me lembra amanhã", resolver a tarefa-alvo por id exato (sem o LLM
adivinhar) e deixar o LLM emitir o update no id certo.

**Architecture:** No envio do proativo grava-se `wa_message_id` (stanzaID do WhatsApp) +
`ref_type`/`ref_id` em `conversation_history`. No inbound, o engine re-extrai o stanzaID
da mensagem citada (`whatsapp.extractQuotedMessage(raw).id`), casa a linha outbound por
esse id, valida que o objeto está vivo e injeta um hint **ancorado** para o LLM emitir
`<<TASK_UPDATE>>` naquele id. Não escreve datas (recorrência intocada). Sem id casado →
fallback textual atual.

**Tech Stack:** Node.js CommonJS, `node:test`, Supabase JS, UAZAPI. Spec:
`docs/superpowers/specs/2026-06-19-lote-d-reply-quote-proativo-design.md`.

> **Política de commit do projeto (CLAUDE.md):** NÃO commitar entre tasks. Trabalhar
> tudo local em `_remote`; validar cada task com `node --test` / `node --check`. O
> versionamento/deploy é um passo único no fim, **sob desbloqueio** (auto-deploy hook
> p/ docs; `scp + pm2 restart tom` p/ engine; migration aplicada no Supabase). Por isso
> os passos abaixo terminam em **validação**, não em `git commit`.

---

## File Structure

| Arquivo | Responsabilidade | Ação |
|---|---|---|
| `migrations/20260619120000_conversation_history_proactive_ref.sql` | +colunas de vínculo | Criar |
| `src/services/sent-message-id.js` | extrair id da msg ENVIADA (puro) | Criar |
| `src/services/sent-message-id.test.js` | teste do acima | Criar |
| `src/services/proactive-link.js` | montar/gravar a linha de vínculo + `sendAndLink` | Criar |
| `src/services/proactive-link.test.js` | teste do `buildProactiveLogRow` | Criar |
| `src/services/reply-ref.js` | resolver alvo + montar hint (puro) | Criar |
| `src/services/reply-ref.test.js` | teste do acima | Criar |
| `src/services/whatsapp.js` | re-exportar `extractSentMessageId` | Modificar |
| `src/engine.js` | interceptor REPLY-REF pré-LLM | Modificar |
| `src/rituals/dispatcher.js` | instrumentar 9 envios de lembrete | Modificar |

---

## Task 1: Migration — vínculo em `conversation_history`

**Files:**
- Create: `migrations/20260619120000_conversation_history_proactive_ref.sql`

- [ ] **Step 1: Escrever a migration (idempotente, não-destrutiva)**

```sql
-- LOTE D (REPLY-QUOTE-PROATIVO, spec 2026-06-19)
-- Vincula uma mensagem proativa de saída (lembrete) ao objeto que a originou, para que
-- um reply-quote a esse lembrete resolva o alvo por id EXATO (stanzaID do WhatsApp).
-- Não-destrutivo: 3 colunas nullable + índice parcial. Sem CHECK (evita drift código↔DB,
-- lição FIN-INVOICE-INTENT-KIND-CONSTRAINT). Linhas antigas seguem válidas.
ALTER TABLE public.conversation_history
  ADD COLUMN IF NOT EXISTS wa_message_id text,
  ADD COLUMN IF NOT EXISTS ref_type      text,   -- 'task' | 'event'
  ADD COLUMN IF NOT EXISTS ref_id        uuid;

CREATE INDEX IF NOT EXISTS conversation_history_wa_message_id_idx
  ON public.conversation_history (wa_message_id)
  WHERE wa_message_id IS NOT NULL;
```

- [ ] **Step 2: Validar a sintaxe SQL (sem aplicar — HOLD)**

Revisar manualmente: `ADD COLUMN IF NOT EXISTS` × 3, índice parcial, sem `CHECK`.
**NÃO aplicar no Supabase agora.** A aplicação é parte do deploy sob desbloqueio
(`mcp ... apply_migration` ou painel) — registrar no checklist de deploy da Task 8.

---

## Task 2: `sent-message-id.js` — ler o id da mensagem ENVIADA (função pura)

**Files:**
- Create: `src/services/sent-message-id.js`
- Test: `src/services/sent-message-id.test.js`

- [ ] **Step 1: Escrever o teste falho**

```js
// src/services/sent-message-id.test.js
// Rodar: node --test src/services/sent-message-id.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const { extractSentMessageId } = require('./sent-message-id');

test('campo id', () => assert.strictEqual(extractSentMessageId({ id: 'ABC123' }), 'ABC123'));
test('campo messageid', () => assert.strictEqual(extractSentMessageId({ messageid: 'XYZ789' }), 'XYZ789'));
test('campo message_id', () => assert.strictEqual(extractSentMessageId({ message_id: 'M42abc' }), 'M42abc'));
test('key.id aninhado', () => assert.strictEqual(extractSentMessageId({ key: { id: 'K9authz' } }), 'K9authz'));
test('message.id aninhado', () => assert.strictEqual(extractSentMessageId({ message: { id: 'NEST01' } }), 'NEST01'));
test('id curto (<4 chars) é ignorado', () => assert.strictEqual(extractSentMessageId({ id: 'ab' }), null));
test('nulo/vazio/string → null', () => {
  assert.strictEqual(extractSentMessageId(null), null);
  assert.strictEqual(extractSentMessageId({}), null);
  assert.strictEqual(extractSentMessageId('x'), null);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test src/services/sent-message-id.test.js`
Expected: FAIL — `Cannot find module './sent-message-id'`.

- [ ] **Step 3: Implementar a função pura**

```js
// src/services/sent-message-id.js
// Lê o id da mensagem ENVIADA a partir do retorno do whatsapp.sendMessage (response.data
// da UAZAPI). Espelha extractMessageId (que lê o id da msg RECEBIDA) — a UAZAPI varia o
// formato. Função PURA → testável sem axios/env.
'use strict';

function extractSentMessageId(responseData) {
  const m = responseData;
  if (!m || typeof m !== 'object') return null;
  const candidates = [
    m.id, m.messageid, m.message_id,
    m.key && m.key.id,
    m.message && m.message.id,
    m.data && m.data.id,
  ];
  for (const c of candidates) {
    if (typeof c === 'string' && c.length >= 4) return c;
  }
  return null;
}

module.exports = { extractSentMessageId };
```

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test src/services/sent-message-id.test.js`
Expected: PASS — `# pass 7  # fail 0`.

> ⚠️ **Confirmar o shape real na Task 8:** a função é defensiva (vários candidatos), mas
> o formato exato do `response.data` do `POST /send/text` da UAZAPI deve ser confirmado
> logando-o uma vez em staging. Se vier num campo não coberto, adicionar à lista.

---

## Task 3: `whatsapp.js` — re-exportar `extractSentMessageId`

**Files:**
- Modify: `src/services/whatsapp.js` (topo dos requires + `module.exports:393`)

- [ ] **Step 1: Importar o módulo puro no topo**

Após a linha `const whatsapp = require('./whatsapp');` não existe aqui — adicionar logo
após os requires do topo do arquivo (`const axios = require('axios');`, etc.):

```js
const { extractSentMessageId } = require('./sent-message-id');
```

- [ ] **Step 2: Adicionar ao `module.exports`**

No `module.exports = { sendMessage, ..., extractQuotedMessage, isIgnorable, getData };`
(linha ~393), inserir `extractSentMessageId`:

```js
module.exports = { sendMessage, sendButtons, sendList, sendMedia, setTyping, sendReaction, sendVoice, isAudioMessage, isImageMessage, isDocumentMessage, isVideoMessage, extractText, extractPhone, extractName, extractFileName, extractMessageId, extractQuotedMessage, extractSentMessageId, isIgnorable, getData };
```

- [ ] **Step 3: Validar syntax**

Run: `node --check src/services/whatsapp.js`
Expected: sem saída (exit 0).

---

## Task 4: `proactive-link.js` — montar e gravar o vínculo

**Files:**
- Create: `src/services/proactive-link.js`
- Test: `src/services/proactive-link.test.js`

- [ ] **Step 1: Escrever o teste falho (só a parte pura)**

```js
// src/services/proactive-link.test.js
// Rodar: node --test src/services/proactive-link.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const { buildProactiveLogRow } = require('./proactive-link');

test('row completa com vínculo', () => {
  assert.deepStrictEqual(
    buildProactiveLogRow({ collaboratorId: 'c1', waMessageId: 'WA1', refType: 'task', refId: 't1', content: 'oi' }),
    { collaborator_id: 'c1', direction: 'outbound', message_type: 'text', content: 'oi', wa_message_id: 'WA1', ref_type: 'task', ref_id: 't1' }
  );
});

test('sem waMessageId → grava sem vínculo (não quebra)', () => {
  assert.deepStrictEqual(
    buildProactiveLogRow({ collaboratorId: 'c1', content: 'oi' }),
    { collaborator_id: 'c1', direction: 'outbound', message_type: 'text', content: 'oi' }
  );
});

test('waMessageId sem ref → grava só o id', () => {
  assert.deepStrictEqual(
    buildProactiveLogRow({ collaboratorId: 'c1', waMessageId: 'WA1', content: 'oi' }),
    { collaborator_id: 'c1', direction: 'outbound', message_type: 'text', content: 'oi', wa_message_id: 'WA1' }
  );
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test src/services/proactive-link.test.js`
Expected: FAIL — `Cannot find module './proactive-link'`.

- [ ] **Step 3: Implementar (puro + glue com supabase injetado)**

```js
// src/services/proactive-link.js
// LOTE D (spec 2026-06-19): grava o VÍNCULO de um proativo de saída (lembrete) com o
// objeto que o originou (task/event), pra que um reply-quote resolva o alvo por id exato.
// buildProactiveLogRow é PURA; record/sendAndLink recebem supabase injetado (padrão da casa).
'use strict';

function buildProactiveLogRow({ collaboratorId, waMessageId = null, refType = null, refId = null, content }) {
  const row = {
    collaborator_id: collaboratorId,
    direction: 'outbound',
    message_type: 'text',
    content,
  };
  if (waMessageId) row.wa_message_id = waMessageId;
  if (refType && refId) { row.ref_type = refType; row.ref_id = refId; }
  return row;
}

// Grava a linha de vínculo. Nunca derruba o caller (o proativo já foi enviado).
async function record(supabase, args) {
  try {
    await supabase.from('conversation_history').insert(buildProactiveLogRow(args));
  } catch (e) {
    console.warn('[proactiveLink] record falhou (proativo já enviado):', e.message);
  }
}

// Envia o proativo E grava o vínculo num passo só. Substitui o par
// "sendMessage + insert(conversation_history)" nos emissores de lembrete.
// O quiet-gate continua sendo responsabilidade do caller (já checado antes).
async function sendAndLink(supabase, { phone, content, collaboratorId, refType = null, refId = null }) {
  const whatsapp = require('./whatsapp');
  const res = await whatsapp.sendMessage(phone, content);
  await record(supabase, { collaboratorId, waMessageId: whatsapp.extractSentMessageId(res), refType, refId, content });
  return res;
}

module.exports = { buildProactiveLogRow, record, sendAndLink };
```

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test src/services/proactive-link.test.js`
Expected: PASS — `# pass 3  # fail 0`.
Run: `node --check src/services/proactive-link.js` → exit 0.

---

## Task 5: `reply-ref.js` — resolver o alvo e montar o hint (puro)

**Files:**
- Create: `src/services/reply-ref.js`
- Test: `src/services/reply-ref.test.js`

- [ ] **Step 1: Escrever o teste falho**

```js
// src/services/reply-ref.test.js
// Rodar: node --test src/services/reply-ref.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const { resolveReplyTarget, buildReplyRefCtxHint } = require('./reply-ref');

const ROW = { ref_type: 'task', ref_id: 'aaaaaaaa-0000-0000-0000-000000000001' };
const OBJ = { id: 'aaaaaaaa-0000-0000-0000-000000000001', status: 'pending', title: 'Lançar BG' };

test('casa: quotedId + linha com ref + objeto vivo → ancora', () => {
  assert.deepStrictEqual(
    resolveReplyTarget({ quotedId: 'WA1', row: ROW, object: OBJ }),
    { refType: 'task', refId: OBJ.id, title: 'Lançar BG' }
  );
});
test('sem quotedId (não é reply-quote) → null', () => {
  assert.strictEqual(resolveReplyTarget({ quotedId: null, row: ROW, object: OBJ }), null);
});
test('linha sem ref (proativo sem vínculo) → null', () => {
  assert.strictEqual(resolveReplyTarget({ quotedId: 'WA1', row: { ref_type: null, ref_id: null }, object: OBJ }), null);
});
test('objeto concluído → não ancora (não reagenda tarefa morta)', () => {
  assert.strictEqual(resolveReplyTarget({ quotedId: 'WA1', row: ROW, object: { ...OBJ, status: 'done' } }), null);
});
test('objeto cancelado → não ancora', () => {
  assert.strictEqual(resolveReplyTarget({ quotedId: 'WA1', row: ROW, object: { ...OBJ, status: 'cancelled' } }), null);
});
test('objeto sumiu (null) → null', () => {
  assert.strictEqual(resolveReplyTarget({ quotedId: 'WA1', row: ROW, object: null }), null);
});
test('id da linha ≠ id do objeto → null (proteção)', () => {
  assert.strictEqual(resolveReplyTarget({ quotedId: 'WA1', row: ROW, object: { ...OBJ, id: 'outro' } }), null);
});
test('hint cita id + manda usar TASK_UPDATE; null → string vazia', () => {
  const h = buildReplyRefCtxHint(resolveReplyTarget({ quotedId: 'WA1', row: ROW, object: OBJ }));
  assert.match(h, /TASK_UPDATE/);
  assert.ok(h.includes(OBJ.id));
  assert.strictEqual(buildReplyRefCtxHint(null), '');
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test src/services/reply-ref.test.js`
Expected: FAIL — `Cannot find module './reply-ref'`.

- [ ] **Step 3: Implementar (puro)**

```js
// src/services/reply-ref.js
// LOTE D (spec 2026-06-19): resolução DETERMINÍSTICA do alvo de um reply-quote a um
// proativo. O engine extrai o stanzaID da msg citada, busca a linha outbound com esse
// wa_message_id e carrega o objeto. Estas funções PURAS decidem se há alvo ancorável e
// montam o hint pro LLM — sem I/O, testáveis. Filosofia FECHAMENTO-ITEM-NO-ANCHOR:
// ancorar por id, nunca deixar o LLM chutar.
'use strict';

const ALIVE = new Set(['pending', 'in_progress']);

/**
 * @param {{ quotedId:string|null,
 *           row:{ref_type?:string, ref_id?:string}|null,
 *           object:{id:string, status?:string, title?:string}|null }} a
 * @returns {{ refType:string, refId:string, title:string }|null}
 */
function resolveReplyTarget({ quotedId, row, object }) {
  if (!quotedId) return null;                              // não é reply-quote
  if (!row || !row.ref_id || !row.ref_type) return null;  // proativo sem vínculo
  if (!object || object.id !== row.ref_id) return null;   // objeto sumiu/diverge
  if (object.status && !ALIVE.has(object.status)) return null; // done/cancelled
  return { refType: row.ref_type, refId: row.ref_id, title: object.title || 'item' };
}

function buildReplyRefCtxHint(target) {
  if (!target) return '';
  const kind = target.refType === 'event' ? 'evento' : 'tarefa';
  return `\n\n[CONTEXTO INTERNO — não verbalize ao usuário]\n`
    + `O usuário está respondendo (reply-quote) a um lembrete da ${kind} "${target.title}" `
    + `(id ${target.refId}). Se ele pediu novo prazo, nova data ou novo lembrete, emita o `
    + `marker de atualização (<<TASK_UPDATE>>) para ESTE id — não crie, conclua nem `
    + `reagende nenhum outro item.`;
}

module.exports = { resolveReplyTarget, buildReplyRefCtxHint };
```

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test src/services/reply-ref.test.js`
Expected: PASS — `# pass 8  # fail 0`.

---

## Task 6: `engine.js` — interceptor REPLY-REF (pré-LLM)

**Files:**
- Modify: `src/engine.js` (inserir bloco imediatamente ANTES de `// ---- Sprint 30.3 — Pending Intents` em ~`engine.js:8316`)

> Contexto disponível nesse ponto: `text` (mutável), `raw` (3º arg de `processMessage`,
> `engine.js:7697`), `supabase`, `collab`, `_phoneTail`, e `whatsapp` (já usado em
> `engine.js:7894`). Roda DEPOIS dos interceptores que dão short-circuit (closing/rsvp/
> approval) e ANTES do auto-resolve de `pending_intents`. NÃO dá `return` — só ancora.

- [ ] **Step 1: Inserir o bloco interceptor**

```js
  // ---- LOTE D (REPLY-QUOTE-PROATIVO): reply-quote a um lembrete → ancora o alvo por id ----
  // O proativo gravou wa_message_id + ref em conversation_history (proactive-link). Se a
  // msg cita (reply-quote) um proativo conhecido, resolvemos a tarefa/evento por stanzaID
  // EXATO e injetamos contexto ANCORADO pro LLM emitir o <<TASK_UPDATE>> no id certo (sem
  // chutar alvo). Não escreve datas (recorrência intocada). Fail-safe: erro → fluxo normal.
  try {
    const { resolveReplyTarget, buildReplyRefCtxHint } = require('./services/reply-ref');
    const _q = whatsapp.extractQuotedMessage(raw);
    const _quotedId = _q && _q.id ? _q.id : null;
    if (_quotedId) {
      const { data: _linkRow } = await supabase.from('conversation_history')
        .select('ref_type, ref_id')
        .eq('wa_message_id', _quotedId)
        .not('ref_id', 'is', null)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (_linkRow && _linkRow.ref_id) {
        const _table = _linkRow.ref_type === 'event' ? 'events' : 'tasks';
        const { data: _obj } = await supabase.from(_table)
          .select('id, status, title')
          .eq('id', _linkRow.ref_id)
          .maybeSingle();
        const _target = resolveReplyTarget({ quotedId: _quotedId, row: _linkRow, object: _obj });
        if (_target) {
          text = String(text || '') + buildReplyRefCtxHint(_target);
          console.log(`[ReplyRef] alvo ancorado ${_target.refType}=${String(_target.refId).slice(0, 8)} phone=${_phoneTail}`);
        } else {
          console.log(`[ReplyRef] quote casou linha mas alvo não-ancorável (morto/sumiu) phone=${_phoneTail}`);
        }
      }
    }
  } catch (e) {
    console.warn('[ReplyRef] interceptor err:', e.message);
  }

```

- [ ] **Step 2: Validar syntax**

Run: `node --check src/engine.js`
Expected: sem saída (exit 0).

- [ ] **Step 3: Verificar posição**

Confirmar que o bloco está ENTRE o fim do bloco de Aprovação (`engine.js:~8011`) e o
comentário `// ---- Sprint 30.3 — Pending Intents` (`engine.js:~8316`), e que nenhum
interceptor anterior já deu `return` para o caso de reply-quote a proativo (os retornos
existentes cobrem closing/rsvp/approval, não lembrete de tarefa).

---

## Task 7: `dispatcher.js` — instrumentar os 9 envios de lembrete

> ⛔ **HOLD reforçado:** edição aditiva (só troca `sendMessage [+ insert]` por
> `sendAndLink`). **NÃO** tocar dedup/recorrência. Cada substituição é local ao bloco
> `try` do envio. Efeito colateral **intencional e necessário:** os 4 lembretes que hoje
> NÃO logam em `conversation_history` passarão a logar — é a linha onde o stanzaID é
> gravado (sem ela não há o que casar). É benéfico (o TOM passa a "ver" que lembrou).

**Files:**
- Modify: `src/rituals/dispatcher.js`

- [ ] **Step 1: Importar o helper no topo**

Após `const supabase = require('../supabase/client');` (`dispatcher.js:19`), adicionar:

```js
const proactiveLink = require('../services/proactive-link');
```

- [ ] **Step 2: `remindEventTasks` (send em ~1141) — só send hoje**

Trocar:
```js
      await whatsapp.sendMessage(phone, msg);
      await supabase.from('tasks').update({ reminded_at: nowIso }).eq('id', task.id);
```
por:
```js
      await proactiveLink.sendAndLink(supabase, { phone, content: msg, collaboratorId: task.assigned_to, refType: 'task', refId: task.id });
      await supabase.from('tasks').update({ reminded_at: nowIso }).eq('id', task.id);
```

- [ ] **Step 3: `remindOperationalTasks` (send em ~1205)**

Trocar `await whatsapp.sendMessage(phone, msg);` por:
```js
      await proactiveLink.sendAndLink(supabase, { phone, content: msg, collaboratorId: task.assigned_to, refType: 'task', refId: task.id });
```

- [ ] **Step 4: `remindPersonalTasks` (send em ~1268)**

Trocar `await whatsapp.sendMessage(phone, msg);` por:
```js
      await proactiveLink.sendAndLink(supabase, { phone, content: msg, collaboratorId: task.assigned_to, refType: 'task', refId: task.id });
```

- [ ] **Step 5: `remindGroupTasks` (send em ~1085) — já faz insert; substituir o par**

Trocar:
```js
        await whatsapp.sendMessage(m.phone, msg);
        await supabase.from('conversation_history').insert({
          collaborator_id: m.collaborator_id, direction: 'outbound', message_type: 'text', content: msg,
        });
        sent++;
```
por:
```js
        await proactiveLink.sendAndLink(supabase, { phone: m.phone, content: msg, collaboratorId: m.collaborator_id, refType: 'task', refId: task.id });
        sent++;
```

- [ ] **Step 6: `checkTaskReminders` — 2 envios**

(a) fan-out de grupo (~4962): trocar o par `sendMessage(m.phone, textG)` + `insert(...)` por:
```js
            await proactiveLink.sendAndLink(supabase, { phone: m.phone, content: textG, collaboratorId: m.collaborator_id, refType: 'task', refId: t.id });
            sentG++;
```
(b) individual (~5019): trocar o par `sendMessage(collab.phone, text)` + `insert(...)` por:
```js
      await proactiveLink.sendAndLink(supabase, { phone: collab.phone, content: text, collaboratorId: collab.id, refType: 'task', refId: t.id });
      await supabase.from('task_reminders').update({ sent_at: new Date().toISOString() }).eq('id', r.id);
```
(remover o `insert(conversation_history)` que vinha logo após esse send individual — o `sendAndLink` já grava).

- [ ] **Step 7: `checkReminders` — 2 envios**

(a) fan-out de grupo (~5082): trocar o par `sendMessage(m.phone, textG)` + `insert(...)` por:
```js
            await proactiveLink.sendAndLink(supabase, { phone: m.phone, content: textG, collaboratorId: m.collaborator_id, refType: 'task', refId: t.id });
            sentG++;
```
(b) individual (~5129): trocar `await whatsapp.sendMessage(collab.phone, text);` por:
```js
      await proactiveLink.sendAndLink(supabase, { phone: collab.phone, content: text, collaboratorId: collab.id, refType: 'task', refId: t.id });
```
(este individual NÃO tinha `insert` — agora passa a logar via `sendAndLink`, intencional.)

- [ ] **Step 8: `checkEventReminders` (send em ~5245) — evento; já faz insert**

Trocar:
```js
      await whatsapp.sendMessage(collab.phone, text);
```
por:
```js
      await proactiveLink.sendAndLink(supabase, { phone: collab.phone, content: text, collaboratorId: collab.id, refType: 'event', refId: ev.id });
```
e remover o `insert(conversation_history)` correspondente (~5252-5257) — o `sendAndLink` já grava a linha (agora com `wa_message_id`+`ref`).

- [ ] **Step 9: Validar syntax + suíte pura**

Run: `node --check src/rituals/dispatcher.js` → exit 0.
Run: `node --test src/services/sent-message-id.test.js src/services/proactive-link.test.js src/services/reply-ref.test.js`
Expected: PASS — `# fail 0`.

---

## Task 8: Verificação end-to-end (roteiro de aceitação — sob desbloqueio)

> Não há "expected output" de produção aqui: este roteiro roda **após o Alf liberar** o
> deploy (migration aplicada + `scp` dos arquivos + `pm2 restart tom`).

- [ ] **Step 1: Aplicar a migration** (Supabase `cesnbnrynvxvgdhfmaua`) e confirmar as
  3 colunas + índice em `conversation_history` (`list_tables` ou `\d`).
- [ ] **Step 2: Confirmar shape do `response.data`** do `POST /send/text` (logar uma vez)
  e garantir que `extractSentMessageId` devolve id não-nulo nos lembretes reais.
- [ ] **Step 3: Caso feliz** — disparar um lembrete de tarefa de teste; no WhatsApp,
  **citar** esse lembrete e mandar "muda o prazo pra amanhã". Esperado: log
  `[ReplyRef] alvo ancorado task=…` e o TOM reagenda **aquela** tarefa (não outra).
- [ ] **Step 4: Anti-ambiguidade** — com 2 lembretes de tarefas diferentes no chat, citar
  o segundo. Esperado: ancora o id do segundo (o stanzaID distingue).
- [ ] **Step 5: Objeto morto** — concluir a tarefa e então citar o lembrete antigo.
  Esperado: NÃO ancora (`alvo não-ancorável`); cai no fallback/LLM.
- [ ] **Step 6: Fallback sem id** — responder ao lembrete **sem** reply-quote. Esperado:
  comportamento atual inalterado (nenhum log `[ReplyRef]`).
- [ ] **Step 7: Registrar known issue** `REPLY-QUOTE-PROACTIVE-NOLINK` em
  `tom_known_issues` (área `marker`/`dispatcher`, status `corrigido`) com causa-raiz e
  fix_resumo, conforme protocolo do `CLAUDE.md`.

---

## Self-Review (feito)

- **Cobertura da spec:** §5.1→Task 1; §5.2→Tasks 2–3; §5.3→Task 4; §5.4→Task 7;
  §5.5→Tasks 5–6; §7 edge cases→testes da Task 5 + roteiro da Task 8; §9 testes→Tasks
  2/4/5; §11 protocolo→Task 8 Step 7. Sem lacunas.
- **Placeholders:** nenhum — todo passo tem código/comando completo. (A única incerteza,
  o shape do `response.data`, é tratada por função defensiva + Step de confirmação na
  Task 8, não por placeholder.)
- **Consistência de tipos/nomes:** `extractSentMessageId` (Tasks 2/3/4), `buildProactiveLogRow`/
  `record`/`sendAndLink` (Tasks 4/7), `resolveReplyTarget`/`buildReplyRefCtxHint` (Tasks 5/6),
  colunas `wa_message_id`/`ref_type`/`ref_id` (Tasks 1/4/6) — batem entre tasks.

## Notas de risco / HOLD

- Tasks 1–6 não tocam `dispatcher.js` nem recorrência (baixo risco). Task 7 toca
  `dispatcher.js` (vizinho do Balde A) — só aditiva, mas exige o desbloqueio.
- Nada é aplicado/deployado até o OK do Alf. A consulta a `tom_known_issues` (bloqueada
  na fase de spec por ser produção) deve rodar no início da implementação real.
