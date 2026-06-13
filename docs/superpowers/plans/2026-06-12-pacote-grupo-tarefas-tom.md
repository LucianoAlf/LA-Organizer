# C — Pacote / grupo de tarefas no chat de grupo do TOM — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dar ao TOM no chat de grupo a capacidade de criar/editar **pacotes** (tarefa-pai + subtarefas, simples ou mensal recorrente) via marker `<<TASK_GROUP>>`, corrigir a duplicação de recorrentes (A) e o cancelamento das próprias dups (B), e reparar os grupos da Rose no banco.

**Architecture:** Um **motor backend único** `src/services/task-groups.js` (porta fiel do `web/src/lib/taskGroups.ts createGroup`, reusando os helpers que JÁ existem no backend: `task-group-dates.js` e `recurrence-engine.js`). O `group-chat-engine.js` parseia `<<TASK_GROUP>>` e delega ao motor; o `group-chat-tasks.js` ganha dedup-de-recorrente e ação `cancel`; o `group-chat-prompt.js` documenta tudo. Um script one-off reusa o motor pra reparar os dados da Rose.

**Tech Stack:** Node CJS (`src/`), Supabase Postgres (`cesnbnrynvxvgdhfmaua`), `node --test`. Fuso SP fixo `-03:00`.

---

## Helpers que JÁ existem (reusar, não reimplementar)

- `src/services/task-group-dates.js` → `dayOfMonthToYmd(day, refYmd)` ('YYYY-MM-DD' do mês de `refYmd`), `childDueDateForCycle(childTplDueYmd, motherInstDueYmd)`.
- `src/services/recurrence-engine.js` → `materializeSeries(table, templateRow)` (cria instâncias FUTURAS + clona filhas de grupo), `buildGroupChildRow`.
- `src/services/group-chat-tasks.js` → `titleSimilarity(a,b)` (Jaccard, já exportado), `_titleTokens`.
- Padrão de data BRT: `today` = `new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo'}).format(new Date())`.

## File Structure

| Arquivo | Responsabilidade | Ação |
|---|---|---|
| `src/services/task-groups.js` | motor `createTaskGroup` + `addSubtasksToGroup` + `weekendAdjustRrule` | Criar |
| `src/services/task-groups.test.js` | testes do motor | Criar |
| `src/services/group-chat-tasks.js` | applier: dedup-recorrente (A) + ação `cancel` (B) | Modificar |
| `src/services/group-chat-tasks.test.js` | testes A + B | Criar |
| `src/services/group-chat-engine.js` | parse `<<TASK_GROUP>>` + dispatch + render | Modificar |
| `src/services/group-chat-prompt.js` | bloco do marker + heurística + cancel | Modificar |
| `scripts/repair-rose-groups.js` | reparo de dados via motor | Criar |

---

## Task 1: Motor — `createTaskGroup` (simples + mensal)

**Files:**
- Create: `src/services/task-groups.js`
- Test: `src/services/task-groups.test.js`

- [ ] **Step 1: Escrever os testes que falham**

`src/services/task-groups.test.js`:
```js
const { test } = require('node:test');
const assert = require('node:assert');
const { createTaskGroup, weekendAdjustRrule } = require('./task-groups');

// supabase fake: captura inserts em 'tasks', gera ids sequenciais, e finge materializeSeries no-op.
function fakeSupabase(captured) {
  let n = 0;
  return {
    from(tbl) {
      return {
        insert(row) {
          return { select() { return { single() {
            const id = `id-${++n}`;
            captured.push({ ...row, id });
            return Promise.resolve({ data: { id }, error: null });
          }, maybeSingle() {
            const id = `id-${++n}`;
            captured.push({ ...row, id });
            return Promise.resolve({ data: { id }, error: null });
          } }; } };
        },
        select() { return { eq() { return { single() { return Promise.resolve({ data: captured[0] || null }); }, maybeSingle() { return Promise.resolve({ data: captured[0] || null }); } }; } }; },
      };
    },
  };
}

test('weekendAdjustRrule monta BYSETPOS até o group_day', () => {
  assert.strictEqual(
    weekendAdjustRrule(4),
    'FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYMONTHDAY=1,2,3,4;BYSETPOS=-1'
  );
});

test('createTaskGroup simples: mãe is_group + filhas com parent_task_id', async () => {
  const captured = [];
  const deps = { materializeSeries: async () => {} };
  const res = await createTaskGroup({
    supabase: fakeSupabase(captured), groupId: 'g1', createdBy: 'u1', deps,
    input: { title: 'Preparar reunião', recurrence: null, subtasks: [
      { title: 'Reservar sala', dueDate: '2026-06-20' },
      { title: 'Enviar pauta', dueDate: '2026-06-19' },
    ] },
  });
  const mother = captured.find((t) => t.is_group);
  assert.ok(mother);
  assert.strictEqual(mother.assigned_group_id, 'g1');
  const kids = captured.filter((t) => t.parent_task_id === mother.id);
  assert.strictEqual(kids.length, 2);
  assert.strictEqual(res.groupId, mother.id);
});

test('createTaskGroup mensal: template (recurrence_rule) + instância (recurrence_parent_id) + filhas dos dois', async () => {
  const captured = [];
  let materialized = null;
  const deps = { materializeSeries: async (_t, tpl) => { materialized = tpl; } };
  const res = await createTaskGroup({
    supabase: fakeSupabase(captured), groupId: 'g1', createdBy: 'u1', deps,
    input: { title: 'Conciliação de Cartões', recurrence: 'monthly', groupDay: 1, subtasks: [
      { title: 'Cartão 8516 (Barra)', day: 12 },
      { title: 'Cartão 2270 (EMLA)', day: 12 },
    ] },
  });
  const tpl = captured.find((t) => t.is_group && t.recurrence_rule);
  const inst = captured.find((t) => t.is_group && t.recurrence_parent_id === tpl.id);
  assert.ok(tpl && inst);
  assert.strictEqual(tpl.recurrence_rule, 'FREQ=MONTHLY;BYMONTHDAY=1');
  assert.strictEqual(inst.recurrence_rule, undefined); // instância visível não tem rrule
  const tplKids = captured.filter((t) => t.parent_task_id === tpl.id);
  const instKids = captured.filter((t) => t.parent_task_id === inst.id);
  assert.strictEqual(tplKids.length, 2);
  assert.strictEqual(instKids.length, 2);
  // filha-instância referencia a filha-template
  assert.ok(instKids.every((k) => tplKids.some((tk) => tk.id === k.recurrence_parent_id)));
  assert.strictEqual(materialized.id, tpl.id); // materializeSeries chamado com o template
  assert.strictEqual(res.groupId, inst.id);    // retorna a instância visível
});

test('createTaskGroup mensal weekend_adjust usa a rrule de dia-útil', async () => {
  const captured = [];
  await createTaskGroup({
    supabase: fakeSupabase(captured), groupId: 'g1', createdBy: 'u1',
    deps: { materializeSeries: async () => {} },
    input: { title: 'Aplicar cashbacks', recurrence: 'monthly', groupDay: 4, weekendAdjust: 'previous_friday',
      subtasks: [{ title: 'Recreio', day: 4 }] },
  });
  const tpl = captured.find((t) => t.is_group && t.recurrence_rule);
  assert.strictEqual(tpl.recurrence_rule, 'FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYMONTHDAY=1,2,3,4;BYSETPOS=-1');
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd D:/la-organizer/_remote && node --test src/services/task-groups.test.js`
Expected: FAIL — `Cannot find module './task-groups'`.

- [ ] **Step 3: Implementar o motor**

`src/services/task-groups.js`:
```js
// src/services/task-groups.js
// Motor ÚNICO de pacote/grupo de tarefas no backend. Porta fiel do
// web/src/lib/taskGroups.ts createGroup, reusando os helpers de data e o
// materializeSeries que já existem no backend. Usado pelo chat de grupo (TOM)
// e pelo script de reparo. supabase + deps injetados (testável sem DB).
'use strict';

const { dayOfMonthToYmd } = require('./task-group-dates');

function todaySP() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
}

// Dia-útil até o group_day (caso "dia N ou sexta anterior").
function weekendAdjustRrule(groupDay) {
  const days = [];
  for (let d = 1; d <= groupDay; d++) days.push(d);
  return `FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYMONTHDAY=${days.join(',')};BYSETPOS=-1`;
}

async function _insert(supabase, row) {
  const { data, error } = await supabase.from('tasks').insert(row).select('id').single();
  if (error) throw new Error('insert task: ' + error.message);
  return data.id;
}

// input: { title, recurrence:'monthly'|null, groupDay, weekendAdjust, subtasks:[{title,day|dueDate,remindAt}] }
async function createTaskGroup({ supabase, groupId, createdBy, input, deps }) {
  const materializeSeries = (deps && deps.materializeSeries)
    || require('./recurrence-engine').materializeSeries;
  const today = todaySP();
  const base = {
    assigned_group_id: groupId, assigned_to: null, created_by: createdBy,
    context: 'work', status: 'pending', source: 'manual', priority: 'medium',
    data_classification: 'real',
  };
  const title = String(input.title || '').trim().slice(0, 200);

  // ── grupo simples (sem recorrência) ──
  if (input.recurrence !== 'monthly') {
    const motherId = await _insert(supabase, { ...base, title, is_group: true, due_date: input.groupDueDate || null });
    const childIds = [];
    let pos = 1;
    for (const c of input.subtasks || []) {
      const cid = await _insert(supabase, {
        ...base, title: String(c.title).trim().slice(0, 200), parent_task_id: motherId,
        due_date: c.dueDate || null, remind_at: c.remindAt || null, sort_position: pos++,
      });
      childIds.push(cid);
    }
    return { groupId: motherId, motherTemplateId: null, childIds };
  }

  // ── grupo MENSAL: template + ciclo corrente + materializa futuros ──
  const anchorDay = input.groupDay || 1;
  const rrule = input.weekendAdjust === 'previous_friday'
    ? weekendAdjustRrule(anchorDay)
    : `FREQ=MONTHLY;BYMONTHDAY=${anchorDay}`;
  const tplDue = dayOfMonthToYmd(anchorDay, today);

  const tplId = await _insert(supabase, { ...base, title, is_group: true, due_date: tplDue, recurrence_rule: rrule });

  const childTpls = [];
  let pos = 1;
  for (const c of input.subtasks || []) {
    const due = dayOfMonthToYmd(c.day || anchorDay, today);
    const cid = await _insert(supabase, {
      ...base, title: String(c.title).trim().slice(0, 200), parent_task_id: tplId,
      due_date: due, sort_position: pos++,
    });
    childTpls.push({ id: cid, due, c });
  }

  const instId = await _insert(supabase, { ...base, title, is_group: true, due_date: tplDue, recurrence_parent_id: tplId });
  const { childDueDateForCycle } = require('./task-group-dates');
  let pos2 = 1;
  const childIds = [];
  for (const ct of childTpls) {
    const cid = await _insert(supabase, {
      ...base, title: String(ct.c.title).trim().slice(0, 200), parent_task_id: instId,
      due_date: childDueDateForCycle(ct.due, tplDue), remind_at: ct.c.remindAt || null,
      recurrence_parent_id: ct.id, sort_position: pos2++,
    });
    childIds.push(cid);
  }

  // Próximos ciclos (idempotente — dedupe por dia pula o ciclo corrente já criado).
  try {
    const { data: tplFull } = await supabase.from('tasks').select('*').eq('id', tplId).single();
    if (tplFull) await materializeSeries('tasks', tplFull);
  } catch (e) { console.warn('[task-groups] materialize:', e.message); }

  return { groupId: instId, motherTemplateId: tplId, childIds };
}

module.exports = { createTaskGroup, weekendAdjustRrule, todaySP };
```

- [ ] **Step 4: Rodar e ver passar**

Run: `cd D:/la-organizer/_remote && node --test src/services/task-groups.test.js`
Expected: PASS (4 testes).

- [ ] **Step 5: Validar sintaxe + deploy parcial**

Run: `node --check src/services/task-groups.js`
Expected: exit 0. (Deploy junto no fim — não precisa restart só por este arquivo ainda.)

---

## Task 2: Motor — `addSubtasksToGroup`

**Files:**
- Modify: `src/services/task-groups.js`
- Test: `src/services/task-groups.test.js`

- [ ] **Step 1: Escrever o teste que falha**

Adicionar a `src/services/task-groups.test.js`:
```js
const { addSubtasksToGroup } = require('./task-groups');

test('addSubtasksToGroup mensal: insere filha no template e na instância', async () => {
  // fake que resolve a instância + o template, e captura inserts
  const captured = [];
  let n = 0;
  const instance = { id: 'inst-1', title: 'Conciliação de Cartões', due_date: '2026-06-01', recurrence_parent_id: 'tpl-1', recurrence_rule: null, assigned_group_id: 'g1', created_by: 'u1' };
  const template = { id: 'tpl-1', due_date: '2026-06-01' };
  const supabase = {
    from() {
      return {
        select() { return {
          eq(col, val) { return {
            single() { return Promise.resolve({ data: val === 'inst-1' ? instance : template }); },
            maybeSingle() { return Promise.resolve({ data: val === 'inst-1' ? instance : template }); },
          }; },
        }; },
        insert(row) { return { select() { return { single() { const id = `new-${++n}`; captured.push({ ...row, id }); return Promise.resolve({ data: { id }, error: null }); } }; } }; },
      };
    },
  };
  const res = await addSubtasksToGroup({
    supabase, groupId: 'inst-1', deps: { materializeSeries: async () => {} },
    subtasks: [{ title: 'Cartão Novo (CG)', day: 15 }],
  });
  // 1 filha-template (parent=tpl-1) + 1 filha-instância (parent=inst-1, recurrence_parent_id=filha-template)
  const tplKid = captured.find((t) => t.parent_task_id === 'tpl-1');
  const instKid = captured.find((t) => t.parent_task_id === 'inst-1');
  assert.ok(tplKid && instKid);
  assert.strictEqual(instKid.recurrence_parent_id, tplKid.id);
  assert.strictEqual(res.added.length, 1);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd D:/la-organizer/_remote && node --test src/services/task-groups.test.js`
Expected: FAIL — `addSubtasksToGroup is not a function`.

- [ ] **Step 3: Implementar**

Adicionar a `src/services/task-groups.js` (antes do `module.exports`):
```js
// groupId = id da mãe-INSTÂNCIA visível (ou mãe simples). Insere subtarefas novas.
async function addSubtasksToGroup({ supabase, groupId, subtasks, deps }) {
  const { childDueDateForCycle, dayOfMonthToYmd } = require('./task-group-dates');
  const today = todaySP();
  const { data: mother } = await supabase.from('tasks').select('*').eq('id', groupId).single();
  if (!mother) throw new Error('grupo não encontrado');
  const base = {
    assigned_group_id: mother.assigned_group_id, assigned_to: null, created_by: mother.created_by,
    context: 'work', status: 'pending', source: 'manual', priority: 'medium', data_classification: 'real',
  };
  const added = [];
  const isMonthly = Boolean(mother.recurrence_parent_id); // instância de série
  let tplId = mother.recurrence_parent_id;
  let tplDue = null;
  if (isMonthly) {
    const { data: tpl } = await supabase.from('tasks').select('*').eq('id', tplId).single();
    tplDue = tpl ? tpl.due_date : mother.due_date;
  }
  for (const c of subtasks || []) {
    const title = String(c.title).trim().slice(0, 200);
    if (!isMonthly) {
      const cid = await _insert(supabase, { ...base, title, parent_task_id: groupId, due_date: c.dueDate || null, remind_at: c.remindAt || null });
      added.push(cid);
      continue;
    }
    const tplChildDue = dayOfMonthToYmd(c.day || 1, tplDue);
    const tplChildId = await _insert(supabase, { ...base, title, parent_task_id: tplId, due_date: tplChildDue });
    const instChildId = await _insert(supabase, {
      ...base, title, parent_task_id: groupId, due_date: childDueDateForCycle(tplChildDue, mother.due_date),
      remind_at: c.remindAt || null, recurrence_parent_id: tplChildId,
    });
    added.push(instChildId);
  }
  return { added };
}
```
E no `module.exports`: adicionar `addSubtasksToGroup`.

- [ ] **Step 4: Rodar e ver passar**

Run: `cd D:/la-organizer/_remote && node --test src/services/task-groups.test.js`
Expected: PASS (5 testes).

---

## Task 3: Applier — A (dedup recorrente) + B (cancel)

**Files:**
- Modify: `src/services/group-chat-tasks.js`
- Test: `src/services/group-chat-tasks.test.js`

- [ ] **Step 1: Escrever os testes que falham**

`src/services/group-chat-tasks.test.js`:
```js
const { test } = require('node:test');
const assert = require('node:assert');
const { applyGroupChatTaskActions } = require('./group-chat-tasks');

// supabase fake mínimo: pool com 1 tarefa recorrente recente + captura updates/cancels.
function fakeDb({ pool = [], onUpdate, onInsert } = {}) {
  return {
    from() {
      const q = {
        _flt: {},
        select() { return q; },
        eq(c, v) { q._flt[c] = v; return q; },
        neq() { return q; },
        ilike(c, v) { q._flt.ilikeTitle = v; return q; },
        gte() { return q; },
        is() { return q; },
        limit() { return Promise.resolve({ data: pool.filter((t) => !q._flt.ilikeTitle || t.title.toLowerCase() === String(q._flt.ilikeTitle).toLowerCase()) }); },
        update(patch) { return { eq(_c, id) { if (onUpdate) onUpdate(id, patch); return { neq() { return { select() { return Promise.resolve({ data: [{ id, title: 'x' }] }); } }; }, select() { return { maybeSingle() { return Promise.resolve({ data: { id, title: 'x' } }); } }; } }; } }; },
        insert(row) { if (onInsert) onInsert(row); return { select() { return { single() { return Promise.resolve({ data: { id: 'new', title: row.title }, error: null }); } }; } }; },
        then(r) { return Promise.resolve({ data: pool }).then(r); },
      };
      return q;
    },
  };
}

test('A: create recorrente de título parecido ATUALIZA a série existente (não duplica)', async () => {
  let inserted = 0; let updatedId = null;
  const pool = [{ id: 'rec-1', title: 'Depósito de cheques Vencto 20', due_date: '2026-06-21', recurrence_rule: 'FREQ=MONTHLY;BYMONTHDAY=21' }];
  const db = fakeDb({ pool, onInsert: () => { inserted++; }, onUpdate: (id) => { updatedId = id; } });
  const res = await applyGroupChatTaskActions({
    supabase: db, groupId: 'g1', senderCollabId: 'u1',
    actions: [{ action: 'create', title: 'Depósito de cheques Vencto 20', due_date: '2026-06-21', recurrence_rule: 'FREQ=MONTHLY;BYMONTHDAY=20' }],
  });
  assert.strictEqual(inserted, 0, 'não deve inserir nova série');
  assert.strictEqual(updatedId, 'rec-1');
  assert.ok(res.updated.length >= 1);
});

test('B: cancel soft remove tarefa recente do grupo por título', async () => {
  let cancelledTo = null;
  const pool = [{ id: 'dup-1', title: 'Tarefa errada', status: 'pending', created_at: new Date().toISOString() }];
  const db = fakeDb({ pool, onUpdate: (id, patch) => { cancelledTo = patch.status; } });
  const res = await applyGroupChatTaskActions({
    supabase: db, groupId: 'g1', senderCollabId: 'u1',
    actions: [{ action: 'cancel', title: 'Tarefa errada' }],
  });
  assert.strictEqual(cancelledTo, 'cancelled');
  assert.ok(res.cancelled && res.cancelled.length === 1);
});
```

> Nota: o fake é simplificado; se a forma real do supabase-js divergir, ajustar o fake (não a lógica). O objetivo é travar o comportamento: recorrente-parecido→update; cancel→status cancelled.

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd D:/la-organizer/_remote && node --test src/services/group-chat-tasks.test.js`
Expected: FAIL — `res.cancelled` undefined / recorrente ainda insere.

- [ ] **Step 3: Implementar A + B**

Em `src/services/group-chat-tasks.js`:

(A) Trocar a linha que pula recorrente. Achar:
```js
        const dup = recur ? null : findDuplicate(title);
```
Trocar por (dedup vale também p/ recorrente; ao casar, atualiza a série + re-materializa):
```js
        const dup = findDuplicate(title);
        if (dup && recur) {
          // Correção de uma série recorrente recente (ex.: "ajusta o lembrete dos Depósitos").
          // Atualiza a RRULE/due/remind da mãe existente e re-materializa, em vez de criar outra série.
          const patch = { recurrence_rule: recur };
          if (wantsDue) patch.due_date = wantsDue;
          if (remindISO) patch.remind_at = remindISO;
          const { data: upd } = await supabase.from('tasks').update(patch).eq('id', dup.id).select('id, title').maybeSingle();
          if (upd) {
            try {
              await supabase.from('tasks').update({ status: 'cancelled' }).eq('recurrence_parent_id', dup.id).neq('status', 'done').gte('due_date', new Date().toISOString().slice(0, 10));
              const { materializeSeries } = require('./recurrence-engine');
              const { data: full } = await supabase.from('tasks').select('*').eq('id', dup.id).maybeSingle();
              if (full && full.recurrence_rule) await materializeSeries('tasks', full);
            } catch (e) { console.warn('[GroupChat] re-materialize:', e.message); }
            updated.push({ ...upd, changed: patch });
            continue;
          }
        }
```
(mantém o ramo `if (dup) { ... }` existente logo abaixo para o caso NÃO-recorrente — ele já trata correção simples.)

(B) Adicionar o ramo `cancel` na cadeia de actions (depois do `else if (a.action === 'complete')`, antes do `else { failed... }`):
```js
      } else if (a.action === 'cancel') {
        const title = (a.title || '').trim();
        if (!title) { failed.push({ action: a, why: 'title_missing' }); continue; }
        // Escopo seguro: só tarefas/grupos do grupo, criados nas últimas 24h, ainda não-done.
        const sinceISO = new Date(Date.now() - RECENT_WINDOW_MS).toISOString();
        const { data: hit } = await supabase
          .from('tasks')
          .select('id, title, is_group')
          .eq('assigned_group_id', groupId)
          .neq('status', 'done')
          .gte('created_at', sinceISO)
          .ilike('title', title)
          .limit(1);
        const target = (hit || [])[0];
        if (!target) { failed.push({ action: a, why: 'not_found_or_too_old' }); continue; }
        await supabase.from('tasks').update({ status: 'cancelled' }).eq('id', target.id);
        // Cascata: se for mãe de grupo, cancela as filhas também.
        if (target.is_group) {
          await supabase.from('tasks').update({ status: 'cancelled' }).eq('parent_task_id', target.id).neq('status', 'done');
        }
        cancelled.push({ id: target.id, title: target.title });
```
E declarar `const cancelled = [];` no topo da função (junto de `created/updated/completed/failed`) e incluí-lo no `return { created, updated, completed, cancelled, failed };`.

- [ ] **Step 4: Rodar e ver passar**

Run: `cd D:/la-organizer/_remote && node --test src/services/group-chat-tasks.test.js`
Expected: PASS (2 testes). Se o fake do supabase divergir da chain real, ajustar o fake até refletir o comportamento.

- [ ] **Step 5: Sintaxe**

Run: `node --check src/services/group-chat-tasks.js`
Expected: exit 0.

---

## Task 4: Engine — parse `<<TASK_GROUP>>` + dispatch + render

**Files:**
- Modify: `src/services/group-chat-engine.js`

- [ ] **Step 1: Localizar o parser de markers existente**

Run: `grep -nE "GROUP_REPORT|stripBlock|TASK_UPDATE|applyGroupChatTaskActions|require\('./group-chat-tasks'\)" src/services/group-chat-engine.js`
Expected: mostra o bloco onde os markers são parseados e onde `applyGroupChatTaskActions` é chamado. Ler ~40 linhas de contexto ali.

- [ ] **Step 2: Adicionar require do motor**

No topo do `group-chat-engine.js` (junto dos outros require):
```js
const { createTaskGroup, addSubtasksToGroup } = require('./task-groups');
```

- [ ] **Step 3: Parsear e despachar o marker `<<TASK_GROUP>>`**

Logo após o bloco que parseia `<<TASK_UPDATE>>` (mesmo estilo: regex captura o JSON entre `<<TASK_GROUP>>` e `<<END>>`, `stripBlock` remove da fala). Adicionar:
```js
  // ── <<TASK_GROUP>> — pacote/grupo de tarefas (pai + subtarefas) ──
  const tgMatch = reply.match(/<<TASK_GROUP>>([\s\S]*?)<<END>>/);
  if (tgMatch) {
    reply = reply.replace(tgMatch[0], '').trim();
    let payload = null;
    try { payload = JSON.parse(tgMatch[1].trim()); } catch (_) { payload = null; }
    if (payload && (payload.action === 'create' || payload.action === 'add_subtasks')) {
      try {
        if (payload.action === 'create') {
          const subtasks = (payload.subtasks || []).map((s) => ({
            title: s.title, day: s.day, dueDate: s.due_date, remindAt: s.remind_at,
          }));
          const r = await createTaskGroup({
            supabase, groupId: group.id, createdBy: senderCollabId,
            input: { title: payload.title, recurrence: payload.recurrence === 'monthly' ? 'monthly' : null,
              groupDay: payload.group_day, weekendAdjust: payload.weekend_adjust, subtasks },
          });
          actionsApplied.push({ type: 'task_group_create', title: payload.title, count: r.childIds.length });
        } else {
          // resolve a mãe-instância visível do grupo por título
          const { data: mom } = await supabase.from('tasks')
            .select('id').eq('assigned_group_id', group.id).eq('is_group', true)
            .is('recurrence_rule', null).neq('status', 'cancelled')
            .ilike('title', payload.group).limit(1);
          const motherId = (mom || [])[0]?.id;
          if (!motherId) {
            actionsApplied.push({ type: 'task_group_error', why: 'group_not_found', group: payload.group });
          } else {
            const subtasks = (payload.subtasks || []).map((s) => ({ title: s.title, day: s.day, dueDate: s.due_date, remindAt: s.remind_at }));
            const r = await addSubtasksToGroup({ supabase, groupId: motherId, subtasks });
            actionsApplied.push({ type: 'task_group_add', group: payload.group, count: r.added.length });
          }
        }
      } catch (e) {
        console.error('[GroupChat] TASK_GROUP erro:', e.message);
        actionsApplied.push({ type: 'task_group_error', why: e.message });
      }
    }
  }
```
> Ajustar os nomes `reply`, `group`, `senderCollabId`, `supabase`, `actionsApplied` aos reais do arquivo (ver Step 1). Se o engine acumula ações num array com outro nome, usar o nome real.

- [ ] **Step 4: Sintaxe**

Run: `node --check src/services/group-chat-engine.js`
Expected: exit 0.

---

## Task 5: Prompt — documentar o marker + heurística + cancel

**Files:**
- Modify: `src/services/group-chat-prompt.js`

- [ ] **Step 1: Adicionar o bloco do pacote**

Em `buildGroupChatPrompt`, dentro da seção "## Markers disponíveis", **antes** do bloco "### Tarefa do grupo", inserir:
```js
`
### Pacote / grupo de tarefas (tarefa-pai + subtarefas)
Quando o pedido tem um TEMA-PAI e VÁRIOS sub-itens (ex.: "Conciliação de Cartões" com cada cartão; "Planilha do financeiro" com Recreio/Barra/CG; uma rotina com etapas), crie um PACOTE — NUNCA várias tarefas soltas:
<<TASK_GROUP>>
{"action":"create","title":"<nome do pacote>","recurrence":"monthly","group_day":<dia-do-mês do prazo>,"subtasks":[{"title":"<sub 1>","day":<dia>,"remind_at":"<ISO -03:00 opcional>"},{"title":"<sub 2>","day":<dia>}]}
<<END>>
- recurrence:"monthly" + group_day p/ pacote que se repete todo mês; OMITA recurrence p/ pacote de uma vez (aí cada subtask usa "due_date":"YYYY-MM-DD").
- weekend_adjust:"previous_friday" no pacote quando o prazo "cai no fim de semana → joga pra sexta" (ex.: "dia 4, mas se for sábado/domingo, sexta anterior"). NÃO escreva RRULE você mesmo — use esse campo.
- Adicionar item a um pacote que JÁ existe: {"action":"add_subtasks","group":"<nome do pacote>","subtasks":[{"title":"<sub novo>","day":<dia>}]}.
- Se a pessoa pediu "grupo/pacote de tarefas com subtarefas", é SEMPRE <<TASK_GROUP>>, nunca várias <<TASK_UPDATE>> soltas.

### Cancelar tarefa que VOCÊ criou errado
Se você duplicou ou errou uma tarefa/pacote, CANCELE você mesmo — NUNCA peça pro Alf ou pra pessoa "excluir no banco":
<<TASK_UPDATE>>[{"action":"cancel","title":"<título exato da tarefa/pacote a remover>"}]<<END>>
(Só funciona em tarefa/pacote do grupo criado nas últimas 24h e ainda não concluído — exatamente o caso de corrigir a própria duplicata.)
`
```
(Concatenar essa string no template literal do prompt, no ponto indicado.)

- [ ] **Step 2: Sintaxe + teste rápido de presença**

Run: `node --check src/services/group-chat-prompt.js`
Expected: exit 0.

Run: `node -e "const {buildGroupChatPrompt}=require('./src/services/group-chat-prompt'); const p=buildGroupChatPrompt({soulText:'',groupName:'X',members:[],pool:[],history:[],senderName:'Y'}); console.log(p.includes('TASK_GROUP') && p.includes('add_subtasks') && p.includes('cancel') ? 'OK' : 'FALTA');"`
Expected: `OK`.

---

## Task 6: Deploy backend + e2e do marker

**Files:** (deploy)

- [ ] **Step 1: Sintaxe geral + testes**

Run: `cd D:/la-organizer/_remote && node --check src/services/task-groups.js && node --check src/services/group-chat-tasks.js && node --check src/services/group-chat-engine.js && node --check src/services/group-chat-prompt.js && node --test src/services/task-groups.test.js src/services/group-chat-tasks.test.js`
Expected: tudo exit 0 / PASS.

- [ ] **Step 2: Deploy**

```bash
scp D:/la-organizer/_remote/src/services/task-groups.js tom:/opt/LA-Organizer/src/services/task-groups.js
scp D:/la-organizer/_remote/src/services/group-chat-tasks.js tom:/opt/LA-Organizer/src/services/group-chat-tasks.js
scp D:/la-organizer/_remote/src/services/group-chat-engine.js tom:/opt/LA-Organizer/src/services/group-chat-engine.js
scp D:/la-organizer/_remote/src/services/group-chat-prompt.js tom:/opt/LA-Organizer/src/services/group-chat-prompt.js
ssh tom "pm2 restart tom"
```
Expected: pm2 mostra `tom` online.

- [ ] **Step 3: e2e — pedir um pacote pelo chat do grupo**

Via app (preview) ou WhatsApp no grupo Financeiro, mandar: *"Tom, cria um grupo de tarefas 'Teste Pacote' com subtarefas A (dia 10), B (dia 12), todo mês."*
Verificar no banco:
```sql
select id, title, is_group, recurrence_rule, recurrence_parent_id, parent_task_id, due_date
from tasks where assigned_group_id='d95f63af-5032-4120-89f2-ca4c49684cbc' and title ilike '%Teste Pacote%' order by is_group desc, created_at;
```
Expected: 1 template (is_group, recurrence_rule) + 1 instância (is_group, recurrence_parent_id) + filhas nos dois. Confirmar que o app mostra o grupo agrupado (não flat). Depois limpar: `update tasks set status='cancelled' where title ilike '%Teste Pacote%' and assigned_group_id='d95f63af-...';`

---

## Task 7: Reparo dos grupos da Rose

**Files:**
- Create: `scripts/repair-rose-groups.js`

- [ ] **Step 1: Escrever o script**

`scripts/repair-rose-groups.js`:
```js
// VPS: node --env-file=.env scripts/repair-rose-groups.js [--dry]
// Reparo dos grupos da Rose (Financeiro) usando o motor único. Idempotente.
const path = require('path');
process.chdir(path.join(__dirname, '..'));
const supabase = require('../src/supabase/client');
const { createTaskGroup } = require('../src/services/task-groups');

const GID = 'd95f63af-5032-4120-89f2-ca4c49684cbc';
const DRY = process.argv.includes('--dry');

async function cancelIds(ids) {
  if (DRY) { console.log('[dry] cancelaria', ids.length, 'ids'); return; }
  for (const id of ids) await supabase.from('tasks').update({ status: 'cancelled' }).eq('id', id);
}
async function cancelTree(motherId) {
  const { data: kids } = await supabase.from('tasks').select('id').eq('parent_task_id', motherId);
  const ids = [motherId, ...(kids || []).map((k) => k.id)];
  await cancelIds(ids);
}

(async () => {
  // (1) Conciliação de Cartões — cancela árvore emaranhada (template 82ea87e7 + instância julho e1eea34d) e recria.
  console.log('== Conciliação de Cartões ==');
  await cancelTree('82ea87e7-73c7-4694-8b7e-c83d4cdde482');
  await cancelTree('e1eea34d-15a7-4d78-9dfd-be23da1a31eb');
  let conc = null;
  if (!DRY) {
    conc = await createTaskGroup({ supabase, groupId: GID, createdBy: '8bfb18b6-3c2e-4579-b4a9-06409d7e84c4',
      input: { title: 'Conciliação de Cartões', recurrence: 'monthly', groupDay: 1, subtasks: [
        { title: 'Cartão 8516 (Barra)', day: 12 }, { title: 'Cartão 2270 (EMLA)', day: 12 },
        { title: 'Cartão 8641 (Recreio)', day: 17 }, { title: 'Cartão 8434 (Kids CG)', day: 25 },
        { title: 'Cartão 1074 (Kids CG)', day: 25 }, { title: 'Cartão Mercado Pago (Barra)', day: 27 },
      ] } });
    // reaplica done nos 2 cartões já concluídos do ciclo de junho (8516, 2270)
    for (const t of ['Cartão 8516 (Barra)', 'Cartão 2270 (EMLA)']) {
      await supabase.from('tasks').update({ status: 'done', completed_at: new Date().toISOString() })
        .eq('parent_task_id', conc.groupId).ilike('title', t);
    }
    console.log('recriado:', conc.groupId);
  }

  // (2) Planilha do financeiro do mês finalizada (Relatório) — pacote mensal dia 5, subtarefas escolas.
  console.log('== Planilha do financeiro ==');
  await cancelIds(['d5ec6498-73e9-4edf-a848-1bf99fd4a34a','939da81a-5ab4-4fcd-8d02-eec69fb9ace8','f07efbd5-d9e9-4239-90eb-d07abe6bd88a','27243673-6499-4291-b784-d6835159dfe9']);
  if (!DRY) {
    const r2 = await createTaskGroup({ supabase, groupId: GID, createdBy: '8bfb18b6-3c2e-4579-b4a9-06409d7e84c4',
      input: { title: 'Planilha do financeiro do mês finalizada (Relatório)', recurrence: 'monthly', groupDay: 5, subtasks: [
        { title: 'Recreio', day: 5, remindAt: null }, { title: 'Barra', day: 5 }, { title: 'CG', day: 5 },
      ] } });
    console.log('recriado:', r2.groupId);
  }

  // (3) Aplicar cashbacks do mês anterior — pacote mensal weekend_adjust, subtarefas escolas.
  console.log('== Aplicar cashbacks ==');
  await cancelIds(['42f791be-5a6a-4b5a-aa27-23b54daf81ba','1d5c357c-40b8-4e08-99b9-ac6aab4f8a84','55414e45-1c69-4224-be0a-154f3c6d591e']);
  if (!DRY) {
    const r3 = await createTaskGroup({ supabase, groupId: GID, createdBy: '8bfb18b6-3c2e-4579-b4a9-06409d7e84c4',
      input: { title: 'Aplicar cashbacks do mês anterior', recurrence: 'monthly', groupDay: 4, weekendAdjust: 'previous_friday', subtasks: [
        { title: 'Recreio', day: 4 }, { title: 'Barra', day: 4 }, { title: 'CG', day: 4 },
      ] } });
    console.log('recriado:', r3.groupId);
  }
  console.log('DONE', DRY ? '(dry)' : '');
})().catch((e) => { console.error('ERRO:', e.message); process.exit(1); });
```

- [ ] **Step 2: Dry-run na VPS**

```bash
scp D:/la-organizer/_remote/scripts/repair-rose-groups.js tom:/opt/LA-Organizer/scripts/repair-rose-groups.js
ssh tom "cd /opt/LA-Organizer && node --env-file=.env scripts/repair-rose-groups.js --dry"
```
Expected: logs `[dry] cancelaria N ids` pros 3 grupos, sem mutação.

- [ ] **Step 3: Run real**

```bash
ssh tom "cd /opt/LA-Organizer && node --env-file=.env scripts/repair-rose-groups.js"
```
Expected: `recriado: <id>` pros 3 + `DONE`.

- [ ] **Step 4: Validar no banco**

```sql
select m.title as grupo, m.is_group, m.recurrence_rule is null as instancia_visivel, count(c.id) as filhas
from tasks m left join tasks c on c.parent_task_id = m.id and c.status != 'cancelled'
where m.assigned_group_id='d95f63af-5032-4120-89f2-ca4c49684cbc' and m.is_group and m.status!='cancelled'
  and (m.title ilike '%Concilia%' or m.title ilike '%Planilha do financeiro%' or m.title ilike '%cashbacks%')
group by m.id, m.title, m.is_group, m.recurrence_rule order by grupo;
```
Expected: cada grupo aparece como instância visível (recurrence_rule null) com as filhas certas (Conciliação=6, Planilha=3, Cashbacks=3); templates (recurrence_rule não-null) existem mas ocultos.

- [ ] **Step 5: Validar na UI (preview localhost:4173)**

Abrir o grupo Financeiro → confirmar que "Conciliação de Cartões", "Planilha do financeiro…" e "Aplicar cashbacks" aparecem **agrupados** (pai + subtarefas), não flat. Usar `mcp__Claude_Preview__preview_eval` + screenshot (ver [[feedback_preview_validation]]).

- [ ] **Step 6: Registrar known issue + memória**

INSERT em `tom_known_issues` código `GROUPCHAT-TASK-GROUP-PACOTE` (causa: TOM não tinha marker de pacote → criava flat + reparo do chip orfanou o grupo dos cartões; fix: motor task-groups.js + marker TASK_GROUP + A/B + reparo). Atualizar memória do chat de grupo.

---

## Self-Review

**1. Spec coverage:**
- §4 motor (createTaskGroup simples+mensal, addSubtasksToGroup, weekendAdjust) → Tasks 1, 2 ✅
- §5 marker TASK_GROUP (create+add_subtasks, validação) → Task 4 ✅
- §6 A (dedup recorrente) + B (cancel) → Task 3 ✅
- §7 prompt (heurística + cancel) → Task 5 ✅
- §8 reparo Rose (Conciliação rebuild + Planilha + Cashbacks + cancel soltas) → Task 7 ✅
- §9 testes (motor/applier/marker/e2e) → Tasks 1-4, 6, 7 ✅

**2. Placeholder scan:** Sem TBD. As notas `> Ajustar nomes…` (Task 4) e `> Nota: fake…` (Task 3) são instruções de fidelidade ao código real, com como-resolver concreto.

**3. Type consistency:** `createTaskGroup({supabase, groupId, createdBy, input, deps})` e `addSubtasksToGroup({supabase, groupId, subtasks, deps})` idênticos entre motor (Task 1/2), engine (Task 4) e script (Task 7). `input.subtasks[].{title,day,dueDate,remindAt}` consistente; o engine mapeia `due_date→dueDate`, `remind_at→remindAt` do JSON do marker. Retorno `{groupId, motherTemplateId, childIds}` / `{added}` consumido igual. Applier retorna `{created,updated,completed,cancelled,failed}` (cancelled novo).
