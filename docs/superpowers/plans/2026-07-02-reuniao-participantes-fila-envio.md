# Reunião: participantes por chat + fila de envio durável — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Editar participantes de uma reunião por chat (add/remove confirm-first) + reagendar avisar todos os convidados, tudo via uma fila de envio durável com espaçamento+jitter anti-ban.

**Architecture:** Fila durável `outbound_queue` (tabela + dreno no dispatcher, espelha o broadcaster de announcements) como fundação; reschedule-notify e convites de add enfileiram nela; add/remove usa marker novo no `EVENT_UPDATE` gated por intent `confirmation` + executor determinístico.

**Tech Stack:** Node.js CommonJS (engine/dispatcher), Supabase (service_role), `node --test`, UAZAPI via `whatsapp.sendMessage`.

## Global Constraints

- 1 migration só (`outbound_queue`); resto zero-migration (kind `confirmation` reusado).
- Voz do TOM sagrada — não tocar SOUL/tom.
- `.deploy-hold` na raiz antes de editar `engine.js`/`dispatcher.js` (já setado).
- Catraca/TDD; toda falha reportada honestamente (sem "✅" sem persistir).
- Deploy em produção só com OK do Alf no checkpoint final.
- Funções puras recebem `rng`/`now` injetáveis pra teste determinístico.

---

## FASE 0 — Fila de envio durável

### Task 0.1: Migration `outbound_queue`

**Files:**
- Create: `migrations/2026-07-02-outbound-queue.sql`
- Apply: via Supabase MCP `apply_migration` (project `cesnbnrynvxvgdhfmaua`)

- [ ] **Step 1:** SQL:
```sql
create table if not exists outbound_queue (
  id uuid primary key default gen_random_uuid(),
  phone text not null,
  body text not null,
  meta jsonb not null default '{}',
  scheduled_at timestamptz not null default now(),
  status text not null default 'pending' check (status in ('pending','sent','failed','canceled')),
  attempts int not null default 0,
  max_attempts int not null default 3,
  last_error text,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
create index if not exists outbound_queue_drain_idx on outbound_queue (status, scheduled_at);
alter table outbound_queue enable row level security;
```
- [ ] **Step 2:** Aplicar via `apply_migration`. Verificar com `select` na tabela vazia.

### Task 0.2: `planSchedule` (puro, TDD)

**Files:**
- Create: `src/lib/outbound-queue.js`
- Test: `src/lib/outbound-queue.test.js`

**Interfaces:**
- Produces: `planSchedule(count, {baseGapMs=30000, jitterMs=8000, rng=Math.random}) → number[]` (offsets ms, monotônicos, ≥0).

- [ ] **Step 1: teste que falha**
```js
const { test } = require('node:test');
const assert = require('node:assert');
const { planSchedule } = require('./outbound-queue');
// rng determinístico: sempre 0.5 → jitter = 0
const rngHalf = () => 0.5;
test('planSchedule: espaçamento base, jitter zero em 0.5', () => {
  const off = planSchedule(4, { baseGapMs: 30000, jitterMs: 8000, rng: rngHalf });
  assert.deepStrictEqual(off, [0, 30000, 60000, 90000]);
});
test('planSchedule: monotônico mesmo com jitter negativo', () => {
  const off = planSchedule(5, { baseGapMs: 30000, jitterMs: 8000, rng: () => 0 }); // jitter = -8000
  for (let i = 1; i < off.length; i++) assert.ok(off[i] >= off[i - 1], `mono @${i}`);
  assert.ok(off.every(o => o >= 0), 'todos ≥ 0');
});
test('planSchedule: count 0/1', () => {
  assert.deepStrictEqual(planSchedule(0, {}), []);
  assert.deepStrictEqual(planSchedule(1, { rng: rngHalf }), [0]);
});
```
- [ ] **Step 2:** rodar `node --test src/lib/outbound-queue.test.js` → FAIL (planSchedule undefined).
- [ ] **Step 3: implementar**
```js
'use strict';
// Fila de envio durável — anti-ban. planSchedule é PURO (rng injetável).
// jitter mapeia rng∈[0,1) → [-jitterMs, +jitterMs]; resultado clampado ≥0 e monotônico
// (nunca deixa a msg i+1 sair antes da i mesmo com jitter negativo).
function planSchedule(count, { baseGapMs = 30000, jitterMs = 8000, rng = Math.random } = {}) {
  const out = [];
  let prev = 0;
  for (let i = 0; i < count; i++) {
    const jitter = Math.round((rng() * 2 - 1) * jitterMs);
    let t = i * baseGapMs + jitter;
    if (t < 0) t = 0;
    if (t < prev) t = prev; // monotônico
    out.push(t);
    prev = t;
  }
  return out;
}
module.exports = { planSchedule };
```
- [ ] **Step 4:** rodar → PASS (3/3).

### Task 0.3: `enqueueOutbound` (I/O)

**Files:**
- Modify: `src/lib/outbound-queue.js`

**Interfaces:**
- Produces: `async enqueueOutbound(supabase, rows, { baseGapMs, jitterMs, startAt=Date.now(), rng } = {}) → { inserted }`. `rows = [{phone, body, meta}]`.

- [ ] **Step 1:** implementar (sem teste unitário de I/O — coberto no e2e; planSchedule já testado):
```js
async function enqueueOutbound(supabase, rows, opts = {}) {
  const list = (rows || []).filter(r => r && r.phone && r.body);
  if (!list.length) return { inserted: 0 };
  const offsets = planSchedule(list.length, opts);
  const start = opts.startAt || Date.now();
  const payload = list.map((r, i) => ({
    phone: r.phone,
    body: r.body,
    meta: r.meta || {},
    scheduled_at: new Date(start + offsets[i]).toISOString(),
  }));
  const { error } = await supabase.from('outbound_queue').insert(payload);
  if (error) { console.error('[OutboundQueue] enqueue err:', error.message); return { inserted: 0, error }; }
  return { inserted: payload.length };
}
module.exports = { planSchedule, enqueueOutbound };
```
- [ ] **Step 2:** `node --check src/lib/outbound-queue.js` → OK.

### Task 0.4: dreno `drainOutboundQueue` no dispatcher

**Files:**
- Modify: `src/rituals/dispatcher.js` (novo tick, espelha broadcaster ~1758; reusa quiet-gate e `sleep`)

**Interfaces:**
- Consumes: `whatsapp.sendMessage`, quiet-hours helper existente.
- Produces: `async drainOutboundQueue()` chamado no loop de ticks.

- [ ] **Step 1:** ler `dispatcher.js:1758-1870` (broadcaster) + achar o quiet-gate helper e onde os ticks são chamados.
- [ ] **Step 2:** implementar `drainOutboundQueue` (MAX_PER_TICK=8; quiet-defer sem consumir tentativa; retry backoff; guarda intra-tick 3–6s). Registrar em `ritual_logs`.
- [ ] **Step 3:** registrar a chamada no loop de ticks (junto dos outros).
- [ ] **Step 4:** `node --check src/rituals/dispatcher.js` → OK.

### Task 0.5: retrofit F1 (convites da criação usam a fila)

**Files:**
- Modify: `src/engine.js:~2561-2586` (loop `attendees`)

- [ ] **Step 1:** trocar o `whatsapp.sendMessage(...).catch()` fire-and-forget por acumular `{phone, body, meta:{collaborator_id: part.id, kind:'event_invite', event_id: data.id, sender_name: senderName}}` e chamar `enqueueOutbound` uma vez após o loop. Manter o insert de `event_participants` e o `logConversation` como estão.
- [ ] **Step 2:** `node --check src/engine.js` → OK.

---

## FASE 1 — Reschedule avisa todos

### Task 1.1: fan-out no sucesso do reschedule

**Files:**
- Modify: `src/engine.js` (`applyEventUpdates`, ramo `reschedule` bem-sucedido)

**Interfaces:**
- Consumes: `enqueueOutbound`.

- [ ] **Step 1:** ler o handler de `reschedule` em `applyEventUpdates` (achar via grep `action === 'reschedule'`).
- [ ] **Step 2:** após persistir o novo horário: buscar `event_participants` do evento com `status in ('invited','confirmed','tentative')`, join no colaborador (phone), excluir o organizador. Render `📅 A reunião *{title}* foi remarcada: agora *{novoHorário}*.` (usar o formatador de data já existente no engine). `enqueueOutbound(...)` com `meta.kind='event_reschedule'`.
- [ ] **Step 3:** `node --check src/engine.js` → OK. Registrar log `[Event] reschedule fan-out N`.

---

## FASE 2 — Add/remove participante por chat

### Task 2.1: `planParticipantEdit` (puro, TDD)

**Files:**
- Create: `src/lib/participant-edit.js`
- Test: `src/lib/participant-edit.test.js`

**Interfaces:**
- Produces: `planParticipantEdit({ op, resolvedIds, existingIds, organizerId }) → { toAdd, toRemove, noops, rejected }`.

- [ ] **Step 1: teste que falha**
```js
const { test } = require('node:test');
const assert = require('node:assert');
const { planParticipantEdit } = require('./participant-edit');
test('add: só quem ainda não está', () => {
  const r = planParticipantEdit({ op: 'add', resolvedIds: ['a', 'b'], existingIds: ['a'], organizerId: 'o' });
  assert.deepStrictEqual(r.toAdd, ['b']);
  assert.deepStrictEqual(r.noops, ['a']);
  assert.deepStrictEqual(r.toRemove, []);
});
test('remove: só quem está', () => {
  const r = planParticipantEdit({ op: 'remove', resolvedIds: ['a', 'x'], existingIds: ['a', 'b'], organizerId: 'o' });
  assert.deepStrictEqual(r.toRemove, ['a']);
  assert.deepStrictEqual(r.noops, ['x']);
});
test('remover o organizador é rejeitado', () => {
  const r = planParticipantEdit({ op: 'remove', resolvedIds: ['o'], existingIds: ['o'], organizerId: 'o' });
  assert.deepStrictEqual(r.toRemove, []);
  assert.deepStrictEqual(r.rejected, ['o']);
});
test('add do organizador é rejeitado (já é dono)', () => {
  const r = planParticipantEdit({ op: 'add', resolvedIds: ['o'], existingIds: [], organizerId: 'o' });
  assert.deepStrictEqual(r.toAdd, []);
  assert.deepStrictEqual(r.rejected, ['o']);
});
```
- [ ] **Step 2:** rodar → FAIL.
- [ ] **Step 3: implementar**
```js
'use strict';
// Plano PURO de edição de participantes. Idempotente: add de quem já está = noop;
// remove de quem não está = noop; qualquer op sobre o organizador = rejeitado (ele é dono
// do evento, não é event_participant).
function planParticipantEdit({ op, resolvedIds = [], existingIds = [], organizerId = null }) {
  const existing = new Set(existingIds);
  const toAdd = [], toRemove = [], noops = [], rejected = [];
  const ids = [...new Set(resolvedIds)];
  for (const id of ids) {
    if (id === organizerId) { rejected.push(id); continue; }
    if (op === 'add') {
      if (existing.has(id)) noops.push(id); else toAdd.push(id);
    } else if (op === 'remove') {
      if (existing.has(id)) toRemove.push(id); else noops.push(id);
    }
  }
  return { toAdd, toRemove, noops, rejected };
}
module.exports = { planParticipantEdit };
```
- [ ] **Step 4:** rodar → PASS (4/4).

### Task 2.2: marker `add_participants`/`remove_participants` → abre confirmation

**Files:**
- Modify: `src/engine.js` (`VALID_EVENT_UPDATE_ACTIONS`, `validateEventUpdateAction`, `applyEventUpdates`)

- [ ] **Step 1:** adicionar `add_participants`/`remove_participants` ao `VALID_EVENT_UPDATE_ACTIONS` (:184). Validar schema: `id` short/latest + `names` array não-vazia de strings.
- [ ] **Step 2:** em `applyEventUpdates`, rotear essas duas ações para NÃO aplicar: resolver evento → `event_participants` existentes → `resolveAttendees(names)` → `planParticipantEdit` → se sobra `toAdd|toRemove`, `openIntent(collab,'confirmation',{participant_edit:{event_id, op, ids, names, summary}})`. Se só noops/rejected/unresolved → reportar sem abrir intent. **Não** emitir "✅".
- [ ] **Step 3:** `node --check src/engine.js` → OK.

### Task 2.3: executor no "sim" (espelha closing-interceptor)

**Files:**
- Modify: `src/engine.js` (perto de `engine.js:~8429`, onde o closing-interceptor lê intents `confirmation`)

- [ ] **Step 1:** ler o bloco do closing-interceptor (como detecta "sim" e resolve a intent).
- [ ] **Step 2:** adicionar branch: intent `confirmation` aberta com `payload.participant_edit` + resposta afirmativa → executor determinístico:
  - add: insert `event_participants` (status=invited) + `enqueueOutbound` do convite (kind `event_invite`).
  - remove: delete rows.
  - fecha a intent; monta resposta honesta com contagem real.
- [ ] **Step 3:** `node --check src/engine.js` → OK.

### Task 2.4: skill — ensinar o TOM a emitir os markers

**Files:**
- Modify: `skills/criar-compromisso.md` (ou a skill de edição de evento)

- [ ] **Step 1:** achar a skill que documenta `EVENT_UPDATE`; adicionar seção "Editar participantes" com os dois markers, exemplos ("põe a X na reunião", "tira o Y"), e a regra: **nunca dizer que fez antes do "sim"** (confirm-first).

---

## CHECKPOINT DE PRODUÇÃO (OK do Alf)

- [ ] Rodar toda a suite: `node --test src/lib/outbound-queue.test.js src/lib/participant-edit.test.js src/prompts/intent-map.test.js` → tudo verde.
- [ ] Pedir OK do Alf. Com OK: aplicar migration + SCP `engine.js`/`dispatcher.js`/`src/lib/*`/skill + `pm2 restart tom` + boot check.
- [ ] E2E live: reunião descartável → add → remove → reschedule → conferir `event_participants` + `outbound_queue` (linhas escalonadas) + recibos.
- [ ] Registrar em `tom_known_issues` (feature nova) + atualizar memória `project_reuniao_grupo` + remover `.deploy-hold`.

---

## Self-Review

- **Spec coverage:** Fase 0 (fila) = Task 0.1-0.5; retrofit F1 = 0.5; Fase 1 (reschedule) = 1.1; Fase 2 (add/remove) = 2.1-2.4. Casos de borda cobertos em planParticipantEdit (2.1) + roteamento (2.2). Quiet-defer no dreno (0.4). ✅
- **Placeholders:** código completo nas funções puras; wiring do engine referencia locais exatos a ler durante execução (inline, não handoff cego). ✅
- **Type consistency:** `planSchedule`/`enqueueOutbound`/`planParticipantEdit` com assinaturas fixas usadas consistentemente. `meta.kind` ∈ {event_invite, event_reschedule}. ✅
