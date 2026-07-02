# Devolutiva da delegação — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans (inline, em lote). Steps usam checkbox (`- [ ]`).

**Goal:** Quando o executor conclui uma tarefa delegada (ou executor/em-cópia mandam um retorno), avisar automaticamente o delegador + quem está em cópia, com uma devolutiva opcional gravada no histórico.

**Architecture:** Um chokepoint único no backend (`src/services/task-return.js`) resolve o "círculo" da tarefa (delegador + executor + watchers) e faz o broadcast. É chamado por 4 gatilhos: conclusão via zap (engine), conclusão via app (endpoint `/internal/task-complete-return`), devolutiva avulsa via zap (marker), devolutiva avulsa via app (endpoint `/internal/task-return`). Devolutiva persiste em `task_comments` (comment_type='return').

**Tech Stack:** Node ES modules (engine/services/internal-api), React+TS+vitest (web), Supabase (service_role no backend, RLS no app).

## Global Constraints (verbatim da spec)

- **Círculo** = delegador (`governance_owner_id` → fallback `created_by`) + executor (`assigned_to`) + watchers (`task_watchers`). Toda devolutiva → círculo **menos o autor**, dedup por `collaborator_id`. Delegador **sempre** recebe.
- **Anti-confab:** conclusão só notifica se o banco confirma `status='done'`.
- **Em cópia dá devolutiva mas NÃO conclui** (regra do em-cópia intacta — só o executor fecha).
- **Voz do TOM sagrada:** reusar o texto do `notifyTaskCreatorOfAction`, só acrescentar a linha de devolutiva + o destinatário.
- **Transacional:** envia na hora (sem gate de quiet-hours), classe `task-delegated`.
- **Zero tabela nova.** Devolutiva em `task_comments` (comment_type='return').
- **2-chat coord:** `.deploy-hold` na raiz antes de editar `src/`; hash local==VPS antes do scp; engine via scp+pm2.
- **DS obrigatório** no app (Field/Button/BottomSheet, tokens `tom`), guardrail mobile/desktop.

---

## SLICE 1 — Aviso de conclusão + nota (delegador + watchers)

### Task 1: Helper central `task-return.js` (funções puras + IO)

**Files:**
- Create: `src/services/task-return.js`
- Test: `src/services/task-return.test.js`

**Interfaces:**
- Produces:
  - `resolveCircleRecipients({ delegatorId, executorId, watcherIds, authorId }) → string[]` (dedup, remove author, remove null)
  - `buildReturnMessage({ kind, recipientRole, recipientName, actorName, title, note }) → string` (`kind:'completion'|'return'`, `recipientRole:'delegator'|'watcher'|'executor'`)
  - `async notifyTaskReturn({ supabase, whatsapp, taskId, actorId, kind, note }) → { sent: number }`

- [ ] **Step 1: Failing test** (`src/services/task-return.test.js`) — recipients dedup/remove-author + message shape:
```js
import { test } from 'node:test';
import assert from 'node:assert';
import { resolveCircleRecipients, buildReturnMessage } from './task-return.js';

test('circle: dedup + remove author + drop null', () => {
  const r = resolveCircleRecipients({ delegatorId: 'D', executorId: 'E', watcherIds: ['W1','W2','D'], authorId: 'E' });
  assert.deepEqual([...r].sort(), ['D','W1','W2']);
});
test('completion message to delegator with note', () => {
  const m = buildReturnMessage({ kind:'completion', recipientRole:'delegator', recipientName:'Fabi', actorName:'Gabi', title:'Aluno novo faltoso', note:'falei com a mãe' });
  assert.ok(m.includes('Gabi concluiu') && m.includes('Aluno novo faltoso') && m.includes('falei com a mãe'));
});
test('completion message without note has no devolutiva line', () => {
  const m = buildReturnMessage({ kind:'completion', recipientRole:'watcher', recipientName:'Jereh', actorName:'Gabi', title:'X', note:null });
  assert.ok(!m.includes('Devolutiva'));
});
```

- [ ] **Step 2: Run** `node --test src/services/task-return.test.js` → FAIL (module missing).

- [ ] **Step 3: Implement** `src/services/task-return.js`:
```js
// src/services/task-return.js
// Chokepoint único da "volta" da delegação: conclusão + devolutiva → círculo da tarefa.
// Círculo = delegador (governance_owner_id→created_by) + executor (assigned_to) + watchers.

function resolveCircleRecipients({ delegatorId, executorId, watcherIds = [], authorId }) {
  const set = new Set();
  if (delegatorId) set.add(delegatorId);
  if (executorId) set.add(executorId);
  for (const w of watcherIds) if (w) set.add(w);
  if (authorId) set.delete(authorId);
  return [...set];
}

function firstName(c) { return (c?.preferred_name || (c?.full_name || '').split(' ')[0] || '').trim(); }

function buildReturnMessage({ kind, recipientRole, recipientName, actorName, title, note }) {
  const t = String(title || '').slice(0, 80);
  const noteLine = note ? `\n💬 Devolutiva: _"${String(note).slice(0, 400)}"_` : '';
  if (kind === 'completion') {
    const frame = recipientRole === 'delegator' ? 'que você pediu' : 'que você acompanha';
    return `✅ ${recipientName}, o ${actorName} concluiu a tarefa ${frame}:\n_"${t}"_${noteLine}`;
  }
  // kind === 'return' (devolutiva avulsa) — sempre tem nota
  return `💬 ${recipientName}, o ${actorName} deixou um retorno em _"${t}"_:\n_"${String(note || '').slice(0, 400)}"_`;
}

async function notifyTaskReturn({ supabase, whatsapp, taskId, actorId, kind, note = null }) {
  // 1) tarefa + anti-confab
  const { data: task } = await supabase.from('tasks')
    .select('id, title, status, created_by, assigned_to, governance_owner_id')
    .eq('id', taskId).maybeSingle();
  if (!task) return { sent: 0 };
  if (kind === 'completion' && task.status !== 'done') return { sent: 0 }; // anti-confab
  const delegatorId = task.governance_owner_id || task.created_by;
  const executorId = task.assigned_to;
  if (!delegatorId || !executorId || delegatorId === executorId) return { sent: 0 }; // não delegada
  // 2) watchers
  const { data: ws } = await supabase.from('task_watchers').select('collaborator_id').eq('task_id', taskId);
  const watcherIds = (ws || []).map(w => w.collaborator_id);
  const recipients = resolveCircleRecipients({ delegatorId, executorId, watcherIds, authorId: actorId });
  if (!recipients.length) return { sent: 0 };
  // 3) nomes (autor + destinatários)
  const ids = [...new Set([actorId, ...recipients])].filter(Boolean);
  const { data: people } = await supabase.from('collaborators')
    .select('id, full_name, preferred_name, phone, is_active').in('id', ids);
  const byId = new Map((people || []).map(p => [p.id, p]));
  const actor = byId.get(actorId);
  const actorName = firstName(actor) || 'alguém';
  let sent = 0;
  for (const rid of recipients) {
    const c = byId.get(rid);
    if (!c || !c.is_active || !c.phone) continue;
    const recipientRole = rid === delegatorId ? 'delegator' : (rid === executorId ? 'executor' : 'watcher');
    const msg = buildReturnMessage({ kind, recipientRole, recipientName: firstName(c), actorName, title: task.title, note });
    try {
      await whatsapp.sendMessage(c.phone, msg);
      await supabase.from('conversation_history').insert({ collaborator_id: c.id, direction: 'outbound', message_type: 'text', content: msg });
      sent++;
    } catch (e) { console.warn('[task-return] send err (non-fatal):', e.message); }
  }
  console.log(`[task-return] ${kind} task=${String(taskId).slice(0,8)} author=${String(actorId||'').slice(0,8)} sent=${sent}`);
  return { sent };
}

module.exports = { resolveCircleRecipients, buildReturnMessage, notifyTaskReturn };
```

- [ ] **Step 4: Run** `node --test src/services/task-return.test.js` → PASS. Also `node --check src/services/task-return.js`.

---

### Task 2: Gravar devolutiva em `task_comments` (helper reusável)

**Files:**
- Modify: `src/services/task-return.js` (add `saveReturnComment`)
- Test: extend `src/services/task-return.test.js` (skip — IO; cobre no E2E)

**Interfaces:**
- Produces: `async saveReturnComment({ supabase, taskId, authorId, note }) → void` (insert `task_comments` `{task_id, content, comment_type:'return', created_by}`; no-op se `!note`).

- [ ] **Step 1: Implement** (append to task-return.js, add to exports):
```js
async function saveReturnComment({ supabase, taskId, authorId, note }) {
  if (!note || !String(note).trim()) return;
  try {
    await supabase.from('task_comments').insert({
      task_id: taskId, content: String(note).trim().slice(0, 2000),
      comment_type: 'return', created_by: authorId || null,
    });
  } catch (e) { console.warn('[task-return] saveComment err (non-fatal):', e.message); }
}
```
- [ ] **Step 2:** `node --check src/services/task-return.js`.

---

### Task 3: Wire conclusão via ZAP (engine)

**Files:**
- Modify: `src/engine.js` (require no topo; parseTaskUpdateMarker ~430 → carregar `note` no complete; complete branch ~4428)

- [ ] **Step 1:** No topo do engine.js (junto dos outros require de services): `const taskReturn = require('./services/task-return');`
- [ ] **Step 2:** Em `parseTaskUpdateMarker` (engine.js:430): no objeto da ação `complete`, propagar `note: parsed.note ?? null` (ler o arquivo, achar onde monta a ação complete, adicionar o campo). Idem pra ação nova `return` (Task 6).
- [ ] **Step 3:** engine.js:4428 — trocar:
```js
await notifyTaskCreatorOfAction(fullTask, collaborator, 'complete');
```
por:
```js
await taskReturn.saveReturnComment({ supabase, taskId: t.id, authorId: collaborator.id, note: a.note });
await taskReturn.notifyTaskReturn({ supabase, whatsapp, taskId: t.id, actorId: collaborator.id, kind: 'completion', note: a.note ?? null });
```
(mantém cancel/reschedule com `notifyTaskCreatorOfAction` — fora de escopo.)
- [ ] **Step 4:** `node --check src/engine.js`.

---

### Task 4: Conclusão via APP — endpoint + client + wiring

**Files:**
- Modify: `src/internal-api.js` (novo endpoint `/internal/task-complete-return`)
- Modify: `web/src/lib/tomEngine.ts` (helper `notifyTaskCompleteReturn`)
- Modify: superfícies de conclusão de tarefa DELEGADA no app (agenda) — chamar o helper após concluir + campo de nota opcional

**Interfaces:**
- Consumes: helper `notifyTaskReturn`, `saveReturnComment` (Task 1/2)
- Produces: `POST /internal/task-complete-return { task_id, actor_id, note? }`; TS `notifyTaskCompleteReturn(taskId, actorId, note?) → NotifyResult`

- [ ] **Step 1: Endpoint** (`src/internal-api.js`, espelho do `subtask-parent-complete`):
```js
router.post('/internal/task-complete-return', requireInternalSecret, async (req, res) => {
  const taskId = String(req.body?.task_id || '').trim();
  const actorId = req.body?.actor_id ? String(req.body.actor_id).trim() : null;
  const note = req.body?.note ? String(req.body.note) : null;
  if (!taskId) return res.status(400).json({ error: 'missing_task_id' });
  try {
    const taskReturn = require('./services/task-return');
    const whatsapp = require('./services/whatsapp');
    await taskReturn.saveReturnComment({ supabase, taskId, authorId: actorId, note });
    const { sent } = await taskReturn.notifyTaskReturn({ supabase, whatsapp, taskId, actorId, kind: 'completion', note });
    return res.json({ status: 'ok', sent });
  } catch (err) {
    console.error('[InternalAPI] task-complete-return err:', err.message);
    return res.status(500).json({ error: 'internal_error', message: err.message });
  }
});
```
(`notifyTaskReturn` já faz anti-confab: se o banco não estiver `done`, sent=0.)

- [ ] **Step 2: Client** (`web/src/lib/tomEngine.ts`, espelho do notifyTaskDelegated):
```ts
export async function notifyTaskCompleteReturn(taskId: string, actorId: string, note?: string | null): Promise<NotifyResult> {
  if (!INTERNAL_SECRET) return { ok: false, reason: 'no_secret' };
  try {
    const r = await fetch(`${TOM_BASE}/internal/task-complete-return`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-internal-secret': INTERNAL_SECRET },
      body: JSON.stringify({ task_id: taskId, actor_id: actorId, note: note ?? null }),
    });
    if (!r.ok) return { ok: false, reason: `http_${r.status}` };
    const json = await r.json().catch(() => ({}));
    return { ok: true, status: r.status, sent: typeof json.sent === 'number' ? json.sent : undefined };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(`[tomEngine] task-complete-return falhou: ${msg}`);
    return { ok: false, reason: msg };
  }
}
```

- [ ] **Step 3: Wiring + nota (app).** Ao concluir uma tarefa **delegada** (executor = usuário atual, `created_by`/`governance_owner` ≠ usuário) nas superfícies de agenda (Hoje/DayBoard/Semana/Mês via o handler comum de complete): após o `update({status:'done'})` bem-sucedido, `void notifyTaskCompleteReturn(task.id, meId, note)`. O campo de nota: um mini `BottomSheet` opcional "Deixar um recado pra quem delegou? (opcional)" com `Field`+textarea+`Button` Concluir — aparece **só** quando a tarefa é delegada; tarefa própria conclui em 1 toque (inalterado). Localizar o(s) handler(s) de complete de tarefa delegada e envolver.
- [ ] **Step 4:** `node --check src/internal-api.js` + `cd web && npx tsc --noEmit`.

**Checkpoint SLICE 1** — E2E na VPS (ficha descartável): concluir tarefa delegada c/ watcher → delegador + watcher recebem (soft-cancel). Deploy engine (scp+pm2). Valida o caso Fabi/Gabi/Jereh.

---

## SLICE 2 — Devolutiva avulsa (executor + em cópia, a qualquer momento)

### Task 5: Endpoint devolutiva avulsa (app)

**Files:**
- Modify: `src/internal-api.js` (`/internal/task-return`)
- Modify: `web/src/lib/tomEngine.ts` (`sendTaskReturn`)

- [ ] **Step 1: Endpoint:**
```js
router.post('/internal/task-return', requireInternalSecret, async (req, res) => {
  const taskId = String(req.body?.task_id || '').trim();
  const authorId = req.body?.author_id ? String(req.body.author_id).trim() : null;
  const note = req.body?.note ? String(req.body.note) : null;
  if (!taskId || !note || !note.trim()) return res.status(400).json({ error: 'missing_fields' });
  try {
    const taskReturn = require('./services/task-return');
    const whatsapp = require('./services/whatsapp');
    await taskReturn.saveReturnComment({ supabase, taskId, authorId, note });
    const { sent } = await taskReturn.notifyTaskReturn({ supabase, whatsapp, taskId, actorId: authorId, kind: 'return', note });
    return res.json({ status: 'ok', sent });
  } catch (err) {
    console.error('[InternalAPI] task-return err:', err.message);
    return res.status(500).json({ error: 'internal_error', message: err.message });
  }
});
```
- [ ] **Step 2: Client** `sendTaskReturn(taskId, authorId, note)` em tomEngine.ts (mesmo molde do Step 2 da Task 4, endpoint `/internal/task-return`, body `{task_id, author_id, note}`).
- [ ] **Step 3:** `node --check` + `tsc --noEmit`.

### Task 6: Devolutiva avulsa via ZAP (TOM marker/ação)

**Files:**
- Modify: `src/engine.js` (parseTaskUpdateMarker: ação `return`; applyTaskActions: handler `return`)
- Modify: `skills/checklist-tarefas.md` (ou a skill de delegação) + system prompt — expor "manda devolutiva / avisa quem delegou / deixa um retorno"

- [ ] **Step 1:** parseTaskUpdateMarker: aceitar `action:'return'` com `{ id?|title?, note }`.
- [ ] **Step 2:** applyTaskActions: novo `else if (a.action === 'return')` — resolve a tarefa (short_id/title-lookup **onde o colaborador é executor OU watcher OU delegador**, reusando o padrão de resolveTaskByShortId + title-lookup; ambíguo → falha graciosa/pergunta), grava `saveReturnComment`, chama `notifyTaskReturn({kind:'return', note})`. **NÃO** muda status (em cópia não conclui).
- [ ] **Step 3:** Skill + prompt: adicionar ao mapa a capacidade de devolutiva (voz intacta). Frases: "manda uma devolutiva pra Fabi na tarefa X", "avisa quem delegou que já resolvi", "deixa um retorno".
- [ ] **Step 4:** `node --check src/engine.js`.

### Task 7: Devolutiva no app (UI — ação + leitura)

**Files:**
- Modify: `web/src/components/TaskDetailSheet.tsx` (ação "Deixar devolutiva" + lista de devolutivas)
- Modify: hook/query que carrega `task_comments` type='return' da tarefa (novo `useTaskReturns(taskId)` em `web/src/hooks/`)

- [ ] **Step 1:** `useTaskReturns(taskId)` — SELECT `task_comments` where task_id + comment_type='return', join autor (full_name), order created_at. (RLS: Task 8.)
- [ ] **Step 2:** TaskDetailSheet: seção "Devolutivas" (lista: autor + quando + texto) + botão "Deixar devolutiva" (Field+textarea+Button) → `sendTaskReturn(taskId, meId, note)` → invalida a query. Disponível nas visões Delegadas (executor/delegador) e Em cópia (watcher).
- [ ] **Step 3:** `cd web && npx tsc --noEmit` + preview (localhost:4173).

### Task 8: RLS `task_comments` + validação + registro

- [ ] **Step 1:** Conferir RLS de `task_comments` (SELECT pro círculo; INSERT pelo executor/watcher). Se faltar, migration aditiva (padrão `current_collab_id()`, nunca auth.uid()). Provar no banco (select como executor, watcher, delegador).
- [ ] **Step 2:** E2E VPS ficha descartável: (a) executor conclui c/ nota → delegador+watcher; (b) watcher manda devolutiva → delegador+executor; (c) task_comments gravado. Soft-cancel (sem WhatsApp real).
- [ ] **Step 3:** Deploy (engine scp+pm2; PWA auto-deploy). Registrar `tom_known_issues` (codigo `DELEG-DEVOLUTIVA-VOLTA`).

---

## Self-review
- **Spec coverage:** §2.1 conclusão→T1-4; §2.2 nota→T1,T4,T7; §2.3 devolutiva 2 lados→T5-7; §2.4 destinatário→T1 resolveCircleRecipients; §3.1 chokepoint→T1; §3.2 task_comments→T2,T8; §3.3 gatilhos A/B/C/D→T3,T4,T6,T5/T7; §3.4 UI→T4,T7. ✅
- **Anti-confab:** T1 notifyTaskReturn (status!=='done'→sent 0). ✅
- **Type consistency:** `notifyTaskReturn({kind})`, `saveReturnComment`, `resolveCircleRecipients`, `buildReturnMessage` usados igual em todas as tasks. ✅
- **YAGNI:** sem thread/reabrir, sem grupo/eventos. ✅
