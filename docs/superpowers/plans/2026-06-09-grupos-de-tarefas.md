# Grupos de Tarefas Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tarefa-mãe que agrupa subtarefas com prazo/hora/lembretes próprios, recorrência mensal do grupo inteiro (árvore), cascata de conclusão, cards no Hoje/Semana/Agenda e criação no QuickCreate ("🗂️ Grupo").

**Architecture:** Subtarefa = task real (`tasks.parent_task_id`); mãe = task com `is_group=true`. Grupo mensal = mãe-TEMPLATE (RRULE `FREQ=MONTHLY;BYMONTHDAY=<dia>`) com filhas-template penduradas; o motor de recorrência (backend + espelho client) materializa a árvore preservando o dia-do-mês de cada filha e clonando `task_reminders` com delta. Filhas NUNCA aparecem soltas nas listas — entram pelo card do grupo. Conclusão em cascata dupla (última filha→mãe; mãe→todas) no PWA e no engine (WhatsApp).

**Tech Stack:** React+TS+Vite (PWA), Supabase JS (RLS atual intacta), dnd-kit, rrule, Node CJS (engine), vitest + node:test.

**Spec:** `docs/superpowers/specs/2026-06-09-grupos-de-tarefas-design.md` (telas aprovadas no Companion).

**Convenções do projeto (CLAUDE.md) — valem pra TODAS as tasks:**
- `_remote/` NÃO é repo git. **NÃO commitar/branch/worktree.** Deploy = Stop hook no fim do turno.
- Gates: `cd _remote/web && npx tsc --noEmit && npx vite build` · `npx vitest run <arquivo>` · `node --check src/<arquivo>.js`.
- Migrations via MCP Supabase (projeto `cesnbnrynvxvgdhfmaua`).
- DS: tokens `bg-bg-surface/bg-bg-elevated/text-fg/text-fg-muted/border-border/bg-tom`; componentes `AdaptiveSheet`, `DateInput`, `TimeInput`, `CustomSelect`, `Button`, `TaskCheckbox`, `RowMenu`, `RemindersField`, `ConfirmDialog`, `RecurrenceScopeDialog`. NUNCA inputs nativos de data/hora/select.
- Mobile + desktop: testar 375px e 1440px. Telas em produção são sagradas — mudanças ADITIVAS.

---

## File Structure

**Criar:**
- `migrations/2026-06-09-task-groups.sql` — `parent_task_id`, `is_group`, índice, CHECK anti-aninhamento.
- `web/src/lib/taskGroupDates.ts` + `.test.ts` — helpers PUROS de data (dia-do-mês com clamp, label do ciclo).
- `src/services/task-group-dates.js` + `.test.js` — espelho CJS dos helpers (motor backend).
- `web/src/lib/taskGroups.ts` — criação do grupo (template+ciclo corrente), fetch de grupos do dia, cascata de conclusão, add/remove subtarefa com escopo.
- `web/src/components/TaskGroupCard.tsx` — card do grupo nas listas (Hoje/Semana).
- `web/src/components/TaskGroupSheet.tsx` — detalhe do grupo (DnD, add inline, menu).
- `src/services/task-groups.js` — cascata no engine (`maybeCompleteParentGroup`).

**Modificar:**
- `web/src/types.ts` — `parent_task_id?`, `is_group?`, `subtasks?`.
- `src/services/recurrence-engine.js` — materialização em árvore (`_materializeGroupChildren`).
- `web/src/lib/materialize-recurrence.ts` — espelho da árvore.
- `web/src/components/QuickCreateSheet.tsx` — 4º kind `group`.
- `web/src/screens/Hoje.tsx`, `web/src/screens/Semana.tsx`, `web/src/screens/agenda/hooks/useAgendaTasks.ts` — filtros + card/linha do grupo.
- `web/src/screens/agenda/leftPanel/DayPanel.tsx` (ou componente novo `GroupRow.tsx` na mesma pasta) — linha expansível desktop.
- `web/src/components/EditTaskSheet.tsx` — esconder "Transformar em" pra tasks de grupo; selo da filha.
- `src/engine.js` — hook de cascata no branch `complete` (~L3941-3995).
- `src/prompts/system.js` — selo de grupo no contexto/briefing.

---

## Task 1: Migração + tipos

**Files:**
- Create: `migrations/2026-06-09-task-groups.sql`
- Modify: `web/src/types.ts` (interface `Task`, ~L122-158)

- [ ] **Step 1: Escrever a migração**

```sql
-- Grupos de tarefas (Rose/To-Do): mãe agrupa subtarefas; subtarefa é task real.
ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS parent_task_id uuid REFERENCES tasks(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS is_group boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_tasks_parent ON tasks(parent_task_id) WHERE parent_task_id IS NOT NULL;

-- 1 nível só: filha não pode ser grupo.
ALTER TABLE tasks ADD CONSTRAINT tasks_no_nested_groups
  CHECK (NOT (is_group AND parent_task_id IS NOT NULL));
```

- [ ] **Step 2: Aplicar via MCP** (`apply_migration`, projeto `cesnbnrynvxvgdhfmaua`, nome `task_groups`).

- [ ] **Step 3: Verificar** via `execute_sql`:
```sql
SELECT column_name FROM information_schema.columns WHERE table_name='tasks' AND column_name IN ('parent_task_id','is_group');
```
Expected: 2 linhas.

- [ ] **Step 4: Tipos** — em `web/src/types.ts`, dentro da interface `Task`, após `converted_to_event_id?: string | null;` adicionar:

```ts
  // Grupos de tarefas (2026-06-09): mãe agrupa subtarefas (filhas têm parent_task_id).
  parent_task_id?: string | null;
  is_group?: boolean;
  // Preenchido em runtime pelo fetch de grupos (nested select) — não vem solto do banco.
  subtasks?: Task[];
```

- [ ] **Step 5:** `cd _remote/web && npx tsc --noEmit` → exit 0.

---

## Task 2: Helpers puros de data (frontend, TDD)

**Files:**
- Create: `web/src/lib/taskGroupDates.ts`
- Test: `web/src/lib/taskGroupDates.test.ts`

- [ ] **Step 1: Teste primeiro**

```ts
import { describe, it, expect } from 'vitest'
import { childDueDateForCycle, cycleLabel, dayOfMonthToYmd } from './taskGroupDates'

describe('childDueDateForCycle', () => {
  it('preserva o dia-do-mês da filha no mês do ciclo (caso Rose)', () => {
    // filha-template dia 12 (junho); ciclo de julho (mãe-instância 2026-07-26)
    expect(childDueDateForCycle('2026-06-12', '2026-07-26')).toBe('2026-07-12')
  })
  it('clamp em mês curto: dia 31 → 30 em junho', () => {
    expect(childDueDateForCycle('2026-05-31', '2026-06-01')).toBe('2026-06-30')
  })
  it('clamp fevereiro: dia 30 → 28 (2027 não-bissexto)', () => {
    expect(childDueDateForCycle('2026-12-30', '2027-02-01')).toBe('2027-02-28')
  })
  it('virada de ano: filha dia 5, ciclo jan/2027', () => {
    expect(childDueDateForCycle('2026-12-05', '2027-01-26')).toBe('2027-01-05')
  })
})

describe('dayOfMonthToYmd', () => {
  it('dia 12 no mês de 2026-06 → 2026-06-12', () => {
    expect(dayOfMonthToYmd(12, '2026-06-09')).toBe('2026-06-12')
  })
  it('clamp: dia 31 em junho → 30', () => {
    expect(dayOfMonthToYmd(31, '2026-06-09')).toBe('2026-06-30')
  })
})

describe('cycleLabel', () => {
  it('nome do mês em pt-BR a partir do due da mãe-instância', () => {
    expect(cycleLabel('2026-06-26')).toBe('junho')
    expect(cycleLabel('2026-01-01')).toBe('janeiro')
  })
})
```

- [ ] **Step 2:** `npx vitest run src/lib/taskGroupDates.test.ts` → FAIL (módulo não existe).

- [ ] **Step 3: Implementar**

```ts
// web/src/lib/taskGroupDates.ts
// Helpers PUROS de data pra grupos de tarefas. ESPELHO: src/services/task-group-dates.js
// (manter em paridade — o motor backend usa a versão CJS).

const pad = (n: number) => String(n).padStart(2, '0')

/** Último dia do mês (1-12). */
function lastDay(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate()
}

/** YMD pra um dia-do-mês no mês de referência, com clamp (31→30, 30→28 em fev). */
export function dayOfMonthToYmd(day: number, refYmd: string): string {
  const [y, m] = refYmd.split('-').map(Number)
  return `${y}-${pad(m)}-${pad(Math.min(day, lastDay(y, m)))}`
}

/**
 * Due da filha-instância: MESMO dia-do-mês da filha-template, no mês do ciclo
 * (= mês do due da mãe-instância), com clamp em mês curto.
 */
export function childDueDateForCycle(childTemplateDueYmd: string, motherInstanceDueYmd: string): string {
  const childDay = Number(childTemplateDueYmd.split('-')[2])
  return dayOfMonthToYmd(childDay, motherInstanceDueYmd)
}

/** Label do ciclo pro card ("junho"). */
export function cycleLabel(motherInstanceDueYmd: string): string {
  const [y, m] = motherInstanceDueYmd.split('-').map(Number)
  return new Intl.DateTimeFormat('pt-BR', { month: 'long', timeZone: 'UTC' })
    .format(new Date(Date.UTC(y, m - 1, 15)))
}
```

- [ ] **Step 4:** `npx vitest run src/lib/taskGroupDates.test.ts` → 7 passed.

---

## Task 3: Espelho CJS dos helpers (backend, TDD)

**Files:**
- Create: `src/services/task-group-dates.js`
- Test: `src/services/task-group-dates.test.js`

- [ ] **Step 1: Teste primeiro** (node:test — padrão do projeto, ver `src/services/leader-routing.test.js`)

```js
const { test } = require('node:test');
const assert = require('node:assert');
const { childDueDateForCycle, dayOfMonthToYmd } = require('./task-group-dates');

test('preserva dia-do-mês no ciclo (caso Rose)', () => {
  assert.strictEqual(childDueDateForCycle('2026-06-12', '2026-07-26'), '2026-07-12');
});
test('clamp mês curto: 31 → 30/jun', () => {
  assert.strictEqual(childDueDateForCycle('2026-05-31', '2026-06-01'), '2026-06-30');
});
test('clamp fevereiro não-bissexto', () => {
  assert.strictEqual(childDueDateForCycle('2026-12-30', '2027-02-01'), '2027-02-28');
});
test('dayOfMonthToYmd com clamp', () => {
  assert.strictEqual(dayOfMonthToYmd(12, '2026-06-09'), '2026-06-12');
  assert.strictEqual(dayOfMonthToYmd(31, '2026-06-09'), '2026-06-30');
});
```

- [ ] **Step 2:** `cd _remote && node --test src/services/task-group-dates.test.js` → FAIL.

- [ ] **Step 3: Implementar** (tradução literal do Task 2, CJS):

```js
// src/services/task-group-dates.js
// ESPELHO de web/src/lib/taskGroupDates.ts — manter em paridade.
const pad = (n) => String(n).padStart(2, '0');
function lastDay(y, m) { return new Date(Date.UTC(y, m, 0)).getUTCDate(); }

function dayOfMonthToYmd(day, refYmd) {
  const [y, m] = refYmd.split('-').map(Number);
  return `${y}-${pad(m)}-${pad(Math.min(day, lastDay(y, m)))}`;
}

function childDueDateForCycle(childTemplateDueYmd, motherInstanceDueYmd) {
  const childDay = Number(childTemplateDueYmd.split('-')[2]);
  return dayOfMonthToYmd(childDay, motherInstanceDueYmd);
}

module.exports = { dayOfMonthToYmd, childDueDateForCycle };
```

- [ ] **Step 4:** `node --test src/services/task-group-dates.test.js` → 4 passed. `node --check src/services/task-group-dates.js` → exit 0.

---

## Task 4: Motor backend — materialização em árvore

**Files:**
- Modify: `src/services/recurrence-engine.js` (lido na íntegra; 284 linhas)

Contexto do arquivo: `materializeSeries(table, template)` insere mães com `.insert(toInsert).select('id, ${anchorCol}')` (L113-116) e depois chama `_cloneRemindersForInstances(table, template, inserted)` (L126). `_cloneTemplate` (L194) clona `{...template}` — então `is_group` propaga sozinho pra mãe-instância, MAS `parent_task_id` da filha-template apontaria pra mãe-TEMPLATE (precisa override).

- [ ] **Step 1: Importar o helper** — no topo, após `const { shiftReminderToInstance } = require('./recurrence-time');`:

```js
const { childDueDateForCycle } = require('./task-group-dates');
```

- [ ] **Step 2: Chamar a materialização das filhas** — em `materializeSeries`, após o bloco do `_cloneRemindersForInstances` (L125-129) e ANTES do `return { created: ... }`, adicionar:

```js
  // Grupos (2026-06-09): mãe-template com is_group materializa a ÁRVORE —
  // pra cada mãe-instância criada, clona as filhas-template preservando o
  // dia-do-mês de cada filha no mês do ciclo. Idempotente.
  if (table === 'tasks' && template.is_group && inserted && inserted.length > 0) {
    await _materializeGroupChildren(template, inserted).catch((e) =>
      console.error(`[recurrence] groupChildren unhandled series=${template.id}:`, e.message)
    );
  }
```

- [ ] **Step 3: Implementar `_materializeGroupChildren`** — adicionar a função após `_cloneRemindersForInstances` (após L188):

```js
/**
 * Grupos: clona as filhas-template pra cada mãe-instância recém-criada.
 * Filha-instância: parent_task_id = mãe-instância; recurrence_parent_id = filha-template;
 * due_date = dia-do-mês da filha no mês do ciclo (clamp); reminders com delta.
 * Idempotência: pula se já existe instância da filha-template apontando pra mãe-instância.
 *
 * @param {Object} motherTemplate — template da mãe (is_group=true)
 * @param {Array<{id:string, due_date:string}>} motherInstances — mães recém-inseridas
 */
async function _materializeGroupChildren(motherTemplate, motherInstances) {
  const { data: childTemplates, error: ctErr } = await supabase
    .from('tasks')
    .select('*')
    .eq('parent_task_id', motherTemplate.id)
    .order('sort_position', { ascending: true, nullsFirst: false });
  if (ctErr) {
    console.error(`[recurrence] childTemplates query err:`, ctErr.message);
    return;
  }
  if (!childTemplates || childTemplates.length === 0) return;

  // Idempotência: instâncias existentes das filhas-template → set de "tplId:motherId"
  const tplIds = childTemplates.map((c) => c.id);
  const { data: existingKids } = await supabase
    .from('tasks')
    .select('recurrence_parent_id, parent_task_id')
    .in('recurrence_parent_id', tplIds)
    .not('parent_task_id', 'is', null);
  const existingKeys = new Set(
    (existingKids || []).map((k) => `${k.recurrence_parent_id}:${k.parent_task_id}`)
  );

  for (const mother of motherInstances) {
    for (const childTpl of childTemplates) {
      if (existingKeys.has(`${childTpl.id}:${mother.id}`)) continue;
      const row = buildGroupChildRow(childTpl, mother);
      const { data: insertedKid, error: insErr } = await supabase
        .from('tasks')
        .insert(row)
        .select('id, due_date')
        .single();
      if (insErr) {
        console.error(`[recurrence] child insert err tpl=${String(childTpl.id).slice(0, 8)}:`, insErr.message);
        continue;
      }
      // Lembretes da filha: mesmo mecanismo de delta do motor.
      await _cloneRemindersForInstances('tasks', childTpl, [insertedKid]).catch((e) =>
        console.error(`[recurrence] child reminders err:`, e.message)
      );
    }
  }
  console.log(`[recurrence] group children materialized series=${motherTemplate.id} mothers=${motherInstances.length} childTpls=${childTemplates.length}`);
}

/**
 * Row da filha-instância (PURA — testável). Usa _cloneTemplate com a data do ciclo
 * e corrige os ponteiros: parent → mãe-instância (não a mãe-template).
 */
function buildGroupChildRow(childTemplate, motherInstance) {
  const childDueYmd = childDueDateForCycle(String(childTemplate.due_date), String(motherInstance.due_date));
  const occ = new Date(childDueYmd + 'T12:00:00-03:00');
  const row = _cloneTemplate('tasks', childTemplate, occ);
  row.parent_task_id = motherInstance.id;        // filha pendura na mãe-INSTÂNCIA
  row.recurrence_parent_id = childTemplate.id;   // instância-de (idempotência/série)
  row.is_group = false;
  return row;
}
```

- [ ] **Step 4: Exportar** o builder puro — trocar a linha final:

```js
module.exports = { parseRule, nextOccurrences, materializeSeries, materializeAll, shiftReminderToInstance, buildGroupChildRow };
```

- [ ] **Step 5: Teste do builder puro** — criar `src/services/recurrence-engine-groups.test.js`:

```js
const { test } = require('node:test');
const assert = require('node:assert');
const { buildGroupChildRow } = require('./recurrence-engine');

const childTpl = {
  id: 'tpl-filho-1', title: 'Cartão Barra', context: 'work', status: 'pending',
  due_date: '2026-06-12', due_time: '09:00:00', sort_position: 1,
  parent_task_id: 'tpl-mae', is_group: false,
  recurrence_rule: null, recurrence_parent_id: null, recurrence_excluded: false,
  assigned_to: 'rose', created_by: 'rose', priority: 'medium',
};

test('filha-instância: ponteiros e data do ciclo corretos', () => {
  const row = buildGroupChildRow(childTpl, { id: 'mae-julho', due_date: '2026-07-26' });
  assert.strictEqual(row.due_date, '2026-07-12');          // dia-do-mês preservado
  assert.strictEqual(row.parent_task_id, 'mae-julho');     // pendura na instância
  assert.strictEqual(row.recurrence_parent_id, 'tpl-filho-1');
  assert.strictEqual(row.status, 'pending');
  assert.strictEqual(row.is_group, false);
  assert.strictEqual(row.recurrence_rule, null);
  assert.strictEqual(row.id, undefined);                   // não copia id
  assert.strictEqual(row.due_time, '09:00:00');            // hora preservada
});

test('clamp: filha dia 31 em ciclo de junho → 30', () => {
  const row = buildGroupChildRow({ ...childTpl, due_date: '2026-05-31' }, { id: 'm', due_date: '2026-06-01' });
  assert.strictEqual(row.due_date, '2026-06-30');
});
```

- [ ] **Step 6:** `node --test src/services/recurrence-engine-groups.test.js` → 2 passed. `node --check src/services/recurrence-engine.js` → exit 0.

---

## Task 5: Espelho client da árvore

**Files:**
- Modify: `web/src/lib/materialize-recurrence.ts` (lido na íntegra; 130 linhas)

- [ ] **Step 1: Import** no topo:

```ts
import { childDueDateForCycle } from './taskGroupDates';
```

- [ ] **Step 2: Capturar IDs das mães** — trocar (L76-78):

```ts
  const { error } = await supabase.from(table).insert(toInsert);
  if (error) return { created: 0, skipped, error: error.message };
  return { created: toInsert.length, skipped };
```
por:
```ts
  const { data: inserted, error } = await supabase.from(table).insert(toInsert).select('id, due_date, start_at');
  if (error) return { created: 0, skipped, error: error.message };

  // Grupos: mãe-template com is_group materializa a árvore (espelho do backend).
  if (table === 'tasks' && (template as Record<string, unknown>).is_group && inserted && inserted.length > 0) {
    await materializeGroupChildrenClient(template, inserted as Array<{ id: string; due_date: string }>);
  }
  return { created: toInsert.length, skipped };
```

- [ ] **Step 3: Implementar a função** no fim do arquivo:

```ts
// Grupos (2026-06-09) — espelho de _materializeGroupChildren do backend.
// Mantém paridade: idempotência por (recurrence_parent_id filha-template + parent_task_id mãe-instância).
async function materializeGroupChildrenClient(
  motherTemplate: Template,
  motherInstances: Array<{ id: string; due_date: string }>
): Promise<void> {
  const { data: childTemplates } = await supabase
    .from('tasks')
    .select('*')
    .eq('parent_task_id', motherTemplate.id)
    .order('sort_position', { ascending: true, nullsFirst: false });
  if (!childTemplates || childTemplates.length === 0) return;

  const tplIds = childTemplates.map((c: { id: string }) => c.id);
  const { data: existingKids } = await supabase
    .from('tasks')
    .select('recurrence_parent_id, parent_task_id')
    .in('recurrence_parent_id', tplIds)
    .not('parent_task_id', 'is', null);
  const existingKeys = new Set(
    ((existingKids ?? []) as Array<{ recurrence_parent_id: string; parent_task_id: string }>)
      .map((k) => `${k.recurrence_parent_id}:${k.parent_task_id}`)
  );

  for (const mother of motherInstances) {
    for (const childTpl of childTemplates as Array<Record<string, unknown> & { id: string; due_date: string }>) {
      if (existingKeys.has(`${childTpl.id}:${mother.id}`)) continue;
      const childDueYmd = childDueDateForCycle(String(childTpl.due_date), String(mother.due_date));
      const occ = new Date(childDueYmd + 'T12:00:00-03:00');
      const row = cloneTemplate('tasks', childTpl as unknown as Template, occ);
      row.parent_task_id = mother.id;
      row.recurrence_parent_id = childTpl.id;
      row.is_group = false;
      const { data: kid, error: insErr } = await supabase.from('tasks').insert(row).select('id, due_date').single();
      if (insErr || !kid) continue;
      // Lembretes da filha-template → instância (delta a partir do due 00:00 BRT).
      const { data: tplReminders } = await supabase
        .from('task_reminders').select('remind_at, label').eq('task_id', childTpl.id);
      if (tplReminders && tplReminders.length > 0) {
        const tplAnchor = new Date(String(childTpl.due_date) + 'T00:00:00-03:00').getTime();
        const instAnchor = new Date(String(kid.due_date) + 'T00:00:00-03:00').getTime();
        const rows = tplReminders.map((r: { remind_at: string; label: string | null }) => ({
          task_id: kid.id,
          remind_at: new Date(instAnchor + (new Date(r.remind_at).getTime() - tplAnchor)).toISOString(),
          label: r.label ?? null,
        }));
        await supabase.from('task_reminders').insert(rows);
      }
    }
  }
}
```

- [ ] **Step 4:** `npx tsc --noEmit` → exit 0. (O retorno `.select(...)` extra não afeta chamadores existentes — `MaterializeResult` não mudou.)

---

## Task 6: `lib/taskGroups.ts` — criação, fetch e cascata

**Files:**
- Create: `web/src/lib/taskGroups.ts`

- [ ] **Step 1: Implementar** (código completo):

```ts
// web/src/lib/taskGroups.ts
// Grupos de tarefas: criação (template + ciclo corrente), fetch das listas,
// cascata de conclusão e edição estrutural com escopo. Client-side, RLS atual.
import { supabase } from './supabase';
import { todaySP } from '../utils/date';
import { dayOfMonthToYmd, childDueDateForCycle, cycleLabel } from './taskGroupDates';
import { materializeSeriesClient } from './materialize-recurrence';
import type { Task } from '../types';

export interface GroupChildInput {
  title: string;
  /** Grupo mensal: dia do mês (1-31). Sem repetição: YMD completo (due). */
  dayOfMonth?: number | null;
  due_date?: string | null;
  due_time?: string | null;        // HH:MM
  reminderTimes?: string[];        // datetime-local "YYYY-MM-DDTHH:MM" (RemindersField)
}

export interface CreateGroupInput {
  title: string;
  context: 'work' | 'personal';
  monthly: boolean;                 // v1: Mensal ou Não repete
  groupDueDay?: number | null;      // mensal: dia do prazo do grupo (opcional)
  groupDueDate?: string | null;     // sem repetição: prazo YMD (opcional)
  children: GroupChildInput[];
  collabId: string;
}

const GROUP_SELECT =
  'id, title, status, context, due_date, due_time, is_group, parent_task_id, ' +
  'recurrence_rule, recurrence_parent_id, sort_position, assigned_to, created_by, completed_at, ' +
  'subtasks:tasks!parent_task_id(id, title, status, due_date, due_time, sort_position, ' +
  'parent_task_id, recurrence_parent_id, assigned_to, created_by, completed_at, ' +
  'task_reminders(remind_at, sent_at))';

async function insertTask(row: Record<string, unknown>): Promise<{ id: string }> {
  const { data, error } = await supabase.from('tasks').insert(row).select('id').single();
  if (error) throw error;
  return data as { id: string };
}

async function insertReminders(taskId: string, localTimes: string[] | undefined): Promise<void> {
  if (!localTimes || localTimes.length === 0) return;
  const rows = localTimes.map((t) => ({ task_id: taskId, remind_at: `${t}:00-03:00` }));
  const { error } = await supabase.from('task_reminders').insert(rows);
  if (error) console.warn('[taskGroups] reminders insert err:', error.message);
}

/**
 * Cria o grupo. Mensal: cria TEMPLATE (mãe is_group + RRULE BYMONTHDAY=<âncora> + filhas)
 * e a INSTÂNCIA do ciclo corrente na hora (a Rose cria dia 9 e usa o ciclo de junho já);
 * materializeSeriesClient cuida dos próximos (dedupe por dia evita duplicar).
 * Sem repetição: cria mãe+filhas direto (sem template).
 */
export async function createGroup(input: CreateGroupInput): Promise<{ groupId: string }> {
  const today = todaySP();
  const base = {
    context: input.context,
    status: 'pending' as const,
    priority: 'medium' as const,
    source: 'manual' as const,
    assigned_to: input.collabId,
    created_by: input.collabId,
  };

  if (!input.monthly) {
    // ——— grupo simples (sem recorrência) ———
    const mother = await insertTask({
      ...base, title: input.title.trim().slice(0, 200), is_group: true,
      due_date: input.groupDueDate ?? null,
    });
    let pos = 1;
    for (const c of input.children) {
      const kid = await insertTask({
        ...base, title: c.title.trim().slice(0, 200), parent_task_id: mother.id,
        due_date: c.due_date ?? null, due_time: c.due_time || null, sort_position: pos++,
      });
      await insertReminders(kid.id, c.reminderTimes);
    }
    return { groupId: mother.id };
  }

  // ——— grupo MENSAL: template + ciclo corrente ———
  const anchorDay = input.groupDueDay ?? 1;
  const tplDue = dayOfMonthToYmd(anchorDay, today);
  const motherTpl = await insertTask({
    ...base, title: input.title.trim().slice(0, 200), is_group: true,
    due_date: tplDue, recurrence_rule: `FREQ=MONTHLY;BYMONTHDAY=${anchorDay}`,
  });
  let pos = 1;
  const childTpls: Array<{ id: string; due: string; input: GroupChildInput }> = [];
  for (const c of input.children) {
    const due = dayOfMonthToYmd(c.dayOfMonth ?? 1, today);
    const kid = await insertTask({
      ...base, title: c.title.trim().slice(0, 200), parent_task_id: motherTpl.id,
      due_date: due, due_time: c.due_time || null, sort_position: pos++,
    });
    await insertReminders(kid.id, c.reminderTimes);
    childTpls.push({ id: kid.id, due, input: c });
  }

  // Instância do CICLO CORRENTE (explícita — o motor só olha ocorrências futuras).
  const motherInst = await insertTask({
    ...base, title: input.title.trim().slice(0, 200), is_group: true,
    due_date: tplDue, recurrence_parent_id: motherTpl.id,
  });
  let pos2 = 1;
  for (const ct of childTpls) {
    const kid = await insertTask({
      ...base, title: ct.input.title.trim().slice(0, 200), parent_task_id: motherInst.id,
      due_date: childDueDateForCycle(ct.due, tplDue), due_time: ct.input.due_time || null,
      sort_position: pos2++, recurrence_parent_id: ct.id,
    });
    await insertReminders(kid.id, ct.input.reminderTimes);
  }

  // Próximos ciclos (idempotente — o dedupe por dia pula o ciclo corrente já criado).
  const { data: tplFull } = await supabase.from('tasks').select('*').eq('id', motherTpl.id).single();
  if (tplFull) {
    const r = await materializeSeriesClient('tasks', tplFull as { id: string; recurrence_rule: string });
    if (r.error) console.warn('[taskGroups] materialize err:', r.error);
  }
  return { groupId: motherInst.id };
}

/**
 * Grupos relevantes pras listas do dia: mães-INSTÂNCIA (ou sem recorrência) do colaborador
 * com filhas embutidas. Relevante = tem filha com due<=dia não concluída, OU filha
 * concluída no dia, OU mãe com due no dia. Filtragem final em JS (volume é baixo).
 */
export async function fetchGroupsForDay(collabId: string, ymd: string): Promise<Task[]> {
  const { data, error } = await supabase
    .from('tasks')
    .select(GROUP_SELECT)
    .eq('assigned_to', collabId)
    .eq('is_group', true)
    .is('recurrence_rule', null)          // esconde mãe-TEMPLATE
    .neq('status', 'cancelled')
    .eq('data_classification', 'real');
  if (error) throw error;
  const groups = ((data ?? []) as unknown as Task[]).map((g) => ({
    ...g,
    subtasks: [...(g.subtasks ?? [])].sort(
      (a, b) => (a.sort_position ?? 0) - (b.sort_position ?? 0)
    ),
  }));
  return groups.filter((g) => {
    const kids = g.subtasks ?? [];
    const kidRelevant = kids.some((k) =>
      (k.status !== 'done' && k.status !== 'cancelled' && k.due_date && k.due_date <= ymd) ||
      (k.status === 'done' && (k.completed_at ?? '').slice(0, 10) === ymd)
    );
    const motherToday = g.due_date === ymd && g.status !== 'done';
    const motherDoneToday = g.status === 'done' && (g.completed_at ?? '').slice(0, 10) === ymd;
    return kidRelevant || motherToday || motherDoneToday;
  });
}

/** Todos os grupos ativos (detalhe/gestão): mães-instância + simples, com filhas. */
export async function fetchGroup(groupId: string): Promise<Task | null> {
  const { data, error } = await supabase.from('tasks').select(GROUP_SELECT).eq('id', groupId).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const g = data as unknown as Task;
  g.subtasks = [...(g.subtasks ?? [])].sort((a, b) => (a.sort_position ?? 0) - (b.sort_position ?? 0));
  return g;
}

/** Toggle de FILHA com cascata: última aberta concluída → mãe conclui; reabrir → mãe reabre. */
export async function toggleChildWithCascade(child: Task, done: boolean): Promise<{ groupCompleted: boolean }> {
  const patch = done
    ? { status: 'done', completed_at: new Date().toISOString() }
    : { status: 'pending', completed_at: null };
  const { error } = await supabase.from('tasks').update(patch).eq('id', child.id);
  if (error) throw error;
  if (!child.parent_task_id) return { groupCompleted: false };

  // Re-checa contagem no servidor (idempotente sob corrida PWA×WhatsApp).
  const { data: siblings } = await supabase
    .from('tasks').select('id, status')
    .eq('parent_task_id', child.parent_task_id).neq('status', 'cancelled');
  const open = (siblings ?? []).filter((s) => s.status !== 'done').length;

  if (done && open === 0) {
    await supabase.from('tasks')
      .update({ status: 'done', completed_at: new Date().toISOString() })
      .eq('id', child.parent_task_id).neq('status', 'done');
    return { groupCompleted: true };
  }
  if (!done) {
    await supabase.from('tasks')
      .update({ status: 'pending', completed_at: null })
      .eq('id', child.parent_task_id).eq('status', 'done');
  }
  return { groupCompleted: false };
}

/** Conclui a mãe fechando as N filhas abertas (chamado após ConfirmDialog na UI). */
export async function completeGroupCascade(groupId: string): Promise<void> {
  const now = new Date().toISOString();
  const { error: e1 } = await supabase.from('tasks')
    .update({ status: 'done', completed_at: now })
    .eq('parent_task_id', groupId).not('status', 'in', '("done","cancelled")');
  if (e1) throw e1;
  const { error: e2 } = await supabase.from('tasks')
    .update({ status: 'done', completed_at: now }).eq('id', groupId);
  if (e2) throw e2;
}

/** Adiciona subtarefa à INSTÂNCIA; escopo 'future' também adiciona ao template. */
export async function addSubtask(
  group: Task, title: string, dayOfMonth: number | null, scope: 'only_this' | 'this_and_future',
): Promise<void> {
  const kids = group.subtasks ?? [];
  const nextPos = kids.length ? Math.max(...kids.map((k) => k.sort_position ?? 0)) + 1 : 1;
  const due = dayOfMonth && group.due_date ? dayOfMonthToYmd(dayOfMonth, group.due_date) : null;
  const base = {
    title: title.trim().slice(0, 200), context: group.context, status: 'pending',
    priority: 'medium', source: 'manual',
    assigned_to: group.assigned_to, created_by: group.assigned_to,
  };
  let tplChildId: string | null = null;
  if (scope === 'this_and_future' && group.recurrence_parent_id) {
    const { data: tplMother } = await supabase.from('tasks')
      .select('id, due_date').eq('id', group.recurrence_parent_id).single();
    if (tplMother) {
      const tplDue = dayOfMonth ? dayOfMonthToYmd(dayOfMonth, String(tplMother.due_date)) : null;
      const tplKid = await insertTask({ ...base, parent_task_id: tplMother.id, due_date: tplDue, sort_position: nextPos });
      tplChildId = tplKid.id;
    }
  }
  await insertTask({
    ...base, parent_task_id: group.id, due_date: due, sort_position: nextPos,
    recurrence_parent_id: tplChildId,
  });
}

/** Remove subtarefa da instância; escopo 'future' remove o template-filho (cascata futura). */
export async function removeSubtask(child: Task, scope: 'only_this' | 'this_and_future'): Promise<void> {
  const { error } = await supabase.from('tasks').delete().eq('id', child.id);
  if (error) throw error;
  if (scope === 'this_and_future' && child.recurrence_parent_id) {
    await supabase.from('tasks').delete().eq('id', child.recurrence_parent_id);
  }
}

/** Reordena filhas (DnD) — bulk update de sort_position. */
export async function reorderSubtasks(ordered: Array<{ id: string; sort_position: number }>): Promise<void> {
  await Promise.all(ordered.map((o) =>
    supabase.from('tasks').update({ sort_position: o.sort_position }).eq('id', o.id)
  ));
}

export { cycleLabel };
```

- [ ] **Step 2:** `npx tsc --noEmit` → exit 0. Se o nested select `tasks!parent_task_id(...)` reclamar de tipo, manter o cast `as unknown as Task[]` (padrão do projeto em `lib/events.ts`).

> Nota: `sort_position` precisa existir na interface `Task` — já existe (`sort_position` aparece no SELECT do Hoje). Se o tsc apontar ausência em `types.ts`, adicionar `sort_position?: number | null;` na interface.

---

## Task 7: `TaskGroupCard.tsx` (card nas listas)

**Files:**
- Create: `web/src/components/TaskGroupCard.tsx`

Visual aprovado: cabeçalho `🗂️ nome · x/y · <ciclo> · prazo`, barra `h-1 bg-tom`, filhas do dia/atrasadas dentro (TaskCheckbox + título + meta), resumo "+N no mês — …", tocar no corpo abre o detalhe.

- [ ] **Step 1: Implementar**

```tsx
// web/src/components/TaskGroupCard.tsx
// Card do grupo nas listas do dia (Hoje/Semana) — tela aprovada no Companion.
// Mostra filhas relevantes do dia (due<=hoje não-done + done hoje) e resume o resto.
import { TaskCheckbox } from './TaskCheckbox';
import { cycleLabel } from '../lib/taskGroups';
import type { Task } from '../types';

interface Props {
  group: Task;                       // mãe com subtasks carregadas
  viewYmd: string;                   // dia da lista (YYYY-MM-DD)
  onToggleChild: (child: Task, done: boolean) => void;
  onOpen: (group: Task) => void;     // abre TaskGroupSheet
}

function brDay(ymd: string | null | undefined): string {
  if (!ymd) return '';
  return `dia ${Number(ymd.slice(8, 10))}`;
}

export function TaskGroupCard({ group, viewYmd, onToggleChild, onOpen }: Props) {
  const kids = group.subtasks ?? [];
  const total = kids.filter(k => k.status !== 'cancelled').length;
  const done = kids.filter(k => k.status === 'done').length;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;

  const todayKids = kids.filter(k =>
    k.status !== 'cancelled' && (
      (k.status !== 'done' && k.due_date && k.due_date <= viewYmd) ||
      (k.status === 'done' && (k.completed_at ?? '').slice(0, 10) === viewYmd)
    )
  );
  const restKids = kids.filter(k => k.status !== 'cancelled' && k.status !== 'done' && !todayKids.includes(k));
  const ciclo = group.recurrence_parent_id && group.due_date ? cycleLabel(group.due_date) : null;

  return (
    <article className="surface overflow-hidden">
      <button type="button" onClick={() => onOpen(group)} className="w-full text-left p-md pb-2 focus-ring">
        <div className="flex items-center gap-2">
          <span aria-hidden>🗂️</span>
          <span className="text-body-md font-semibold min-w-0 flex-1 truncate">{group.title}</span>
          <span className="text-body-sm text-fg-muted tabular-nums shrink-0">
            {done}/{total}{ciclo ? ` · ${ciclo}` : ''}{group.due_date ? ` · prazo ${brDay(group.due_date)}` : ''}
          </span>
        </div>
        <div className="mt-2 h-1 w-full bg-bg-elevated rounded-full overflow-hidden" role="progressbar"
          aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
          <div className="h-full bg-tom transition-all" style={{ width: `${pct}%` }} />
        </div>
      </button>

      {todayKids.length > 0 && (
        <div className="border-t border-border bg-bg-subtle px-md py-1">
          {todayKids.map(k => {
            const isDone = k.status === 'done';
            const overdue = !isDone && k.due_date != null && k.due_date < viewYmd;
            const hm = k.due_time ? k.due_time.slice(0, 5) : null;
            return (
              <div key={k.id} className="flex items-center gap-2.5 py-2 border-b border-border/60 last:border-b-0">
                <TaskCheckbox done={isDone} overdue={overdue} size="sm"
                  onClick={() => onToggleChild(k, !isDone)} />
                <span className={['text-body-sm min-w-0 flex-1 truncate', isDone ? 'line-through text-fg-muted' : 'text-fg'].join(' ')}>
                  {k.title}
                </span>
                <span className={['text-body-sm shrink-0 tabular-nums', overdue ? 'text-danger' : 'text-fg-muted'].join(' ')}>
                  {overdue ? `atrasada (${brDay(k.due_date)})` : k.due_date === viewYmd ? `hoje${hm ? ` · 🕐 ${hm}` : ''}` : ''}
                </span>
              </div>
            );
          })}
          {restKids.length > 0 && (
            <button type="button" onClick={() => onOpen(group)}
              className="w-full text-left py-2 text-body-sm text-fg-muted hover:text-fg focus-ring rounded-sm">
              ▸ +{restKids.length} no mês — {restKids.slice(0, 4).map(k => `${k.title.split(' ').slice(-1)[0]} (${Number((k.due_date ?? '').slice(8, 10) || '?')})`).join(', ')}{restKids.length > 4 ? '…' : ''}
            </button>
          )}
        </div>
      )}
    </article>
  );
}
```

- [ ] **Step 2:** Confirmar props reais de `TaskCheckbox` (abrir `web/src/components/TaskCheckbox.tsx`): se `size="sm"` não existir, usar o tamanho disponível. `npx tsc --noEmit` → exit 0.

---

## Task 8: `TaskGroupSheet.tsx` (detalhe com DnD)

**Files:**
- Create: `web/src/components/TaskGroupSheet.tsx`

Padrões a seguir: DnD = `PersonalChecklistCard.tsx` (DndContext + SortableContext + useSortableSensors + handleDragEnd com splice); item = visual aprovado (⠿ + bolinha + título + meta à direita); escopo = `RecurrenceScopeDialog` existente; confirmação = `ConfirmDialog`.

- [ ] **Step 1: Implementar**

```tsx
// web/src/components/TaskGroupSheet.tsx
// Detalhe do grupo (tela aprovada): ciclo inteiro, DnD, add inline, conclusão em cascata.
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { GripVertical } from 'lucide-react';
import { DndContext, closestCenter, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useSortableSensors } from '../lib/sortableSensors';
import { AdaptiveSheet } from './AdaptiveSheet';
import { Button } from './Button';
import { TaskCheckbox } from './TaskCheckbox';
import { ConfirmDialog } from './ConfirmDialog';
import { RecurrenceScopeDialog } from './RecurrenceScopeDialog';
import { showToast } from './Toast';
import {
  fetchGroup, toggleChildWithCascade, completeGroupCascade,
  addSubtask, removeSubtask, reorderSubtasks, cycleLabel,
} from '../lib/taskGroups';
import type { Task } from '../types';

interface Props {
  open: boolean;
  groupId: string | null;
  onClose: () => void;
  /** Abre o EditTaskSheet da filha no parent (edição completa de data/hora/lembretes). */
  onEditChild?: (child: Task) => void;
}

function SortableChildRow({ child, onToggle, onEdit, onDelete }: {
  child: Task;
  onToggle: (done: boolean) => void;
  onEdit?: () => void;
  onDelete: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: child.id });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition: isDragging ? 'none' : transition,
    zIndex: isDragging ? 50 : undefined,
  };
  const isDone = child.status === 'done';
  const hm = child.due_time ? child.due_time.slice(0, 5) : null;
  return (
    <div ref={setNodeRef} style={style} className="flex items-center gap-2 py-2 border-b border-border/60 last:border-b-0">
      <button type="button" {...attributes} {...listeners} aria-label="Reordenar"
        className="cursor-grab active:cursor-grabbing p-0.5 text-fg-muted/40 hover:text-fg-muted" style={{ touchAction: 'none' }}>
        <GripVertical size={14} />
      </button>
      <TaskCheckbox done={isDone} size="sm" onClick={() => onToggle(!isDone)} />
      <button type="button" onClick={onEdit} className="min-w-0 flex-1 text-left focus-ring rounded-sm">
        <span className={['text-body-sm', isDone ? 'line-through text-fg-muted' : 'text-fg'].join(' ')}>{child.title}</span>
      </button>
      <span className="text-body-sm text-fg-muted tabular-nums shrink-0">
        {child.due_date ? `dia ${Number(child.due_date.slice(8, 10))}` : 'sem prazo'}{hm ? ` · 🕐 ${hm}` : ''}
      </span>
      <button type="button" onClick={onDelete} aria-label="Remover subtarefa"
        className="p-1 text-fg-muted hover:text-danger focus-ring rounded-sm">✕</button>
    </div>
  );
}

export function TaskGroupSheet({ open, groupId, onClose, onEditChild }: Props) {
  const qc = useQueryClient();
  const sensors = useSortableSensors();
  const [confirmAll, setConfirmAll] = useState(false);
  const [pendingRemove, setPendingRemove] = useState<Task | null>(null);
  const [newTitle, setNewTitle] = useState('');
  const [newDay, setNewDay] = useState('');
  const [scopeFor, setScopeFor] = useState<'add' | 'remove' | null>(null);

  const groupQ = useQuery({
    queryKey: ['task-group', groupId],
    enabled: open && Boolean(groupId),
    queryFn: () => fetchGroup(groupId!),
  });
  const group = groupQ.data ?? null;
  const kids = group?.subtasks ?? [];
  const total = kids.filter(k => k.status !== 'cancelled').length;
  const done = kids.filter(k => k.status === 'done').length;
  const openCount = total - done;
  const isRecurrentInstance = Boolean(group?.recurrence_parent_id);

  useEffect(() => { if (!open) { setNewTitle(''); setNewDay(''); setScopeFor(null); } }, [open]);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['task-group', groupId] });
    qc.invalidateQueries({ queryKey: ['tasks'] });
    qc.invalidateQueries({ queryKey: ['task-groups'] });
  };

  const toggleMut = useMutation({
    mutationFn: ({ child, done: d }: { child: Task; done: boolean }) => toggleChildWithCascade(child, d),
    onSuccess: (r) => {
      invalidate();
      if (r.groupCompleted) showToast({ kind: 'success', title: '🎉 Grupo concluído!', msg: `${group?.title ?? ''} fechado.` });
    },
  });
  const completeAllMut = useMutation({
    mutationFn: () => completeGroupCascade(groupId!),
    onSuccess: () => { invalidate(); showToast({ kind: 'success', title: '🎉 Grupo concluído!' }); setConfirmAll(false); },
  });
  const reorderMut = useMutation({
    mutationFn: (ordered: Array<{ id: string; sort_position: number }>) => reorderSubtasks(ordered),
    onSuccess: invalidate,
  });
  const addMut = useMutation({
    mutationFn: (scope: 'only_this' | 'this_and_future') =>
      addSubtask(group!, newTitle, newDay ? Number(newDay) : null, scope),
    onSuccess: () => { setNewTitle(''); setNewDay(''); invalidate(); },
  });
  const removeMut = useMutation({
    mutationFn: ({ child, scope }: { child: Task; scope: 'only_this' | 'this_and_future' }) =>
      removeSubtask(child, scope),
    onSuccess: invalidate,
  });

  function handleDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id || !group) return;
    const oldIndex = kids.findIndex(k => k.id === active.id);
    const newIndex = kids.findIndex(k => k.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;
    const reordered = [...kids];
    const [moved] = reordered.splice(oldIndex, 1);
    reordered.splice(newIndex, 0, moved);
    reorderMut.mutate(reordered.map((k, i) => ({ id: k.id, sort_position: i + 1 })));
  }

  function submitAdd() {
    if (!newTitle.trim() || !group) return;
    if (isRecurrentInstance) setScopeFor('add');
    else addMut.mutate('only_this');
  }
  function submitRemove(child: Task) {
    setPendingRemove(child);
    if (isRecurrentInstance && child.recurrence_parent_id) setScopeFor('remove');
  }

  return (
    <AdaptiveSheet open={open && Boolean(group)} onClose={onClose} title={group ? group.title : 'Grupo'} size="md">
      {group && (
        <div className="space-y-md">
          <div className="text-body-sm text-fg-muted">
            🗂️ grupo{isRecurrentInstance ? ' · 🔁 renasce todo mês' : ''} · {done}/{total}
            {isRecurrentInstance && group.due_date ? ` em ${cycleLabel(group.due_date)}` : ''}
          </div>
          <div className="h-1 w-full bg-bg-elevated rounded-full overflow-hidden">
            <div className="h-full bg-tom transition-all" style={{ width: `${total ? Math.round((done / total) * 100) : 0}%` }} />
          </div>

          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={kids.map(k => k.id)} strategy={verticalListSortingStrategy}>
              {kids.map(k => (
                <SortableChildRow key={k.id} child={k}
                  onToggle={(d) => toggleMut.mutate({ child: k, done: d })}
                  onEdit={onEditChild ? () => onEditChild(k) : undefined}
                  onDelete={() => submitRemove(k)} />
              ))}
            </SortableContext>
          </DndContext>

          {/* Add inline: título + dia do mês (1-31) */}
          <div className="rounded-md border border-dashed border-border p-3 space-y-2 bg-bg-elevated/50">
            <input type="text" maxLength={200} value={newTitle} onChange={e => setNewTitle(e.target.value)}
              placeholder="Nova subtarefa…"
              className="w-full bg-bg-surface border border-border rounded-md p-2 text-fg text-body-sm focus:outline-none focus:border-tom" />
            <div className="flex items-center gap-2">
              <input type="text" inputMode="numeric" maxLength={2} value={newDay}
                onChange={e => setNewDay(e.target.value.replace(/\D/g, ''))}
                placeholder={isRecurrentInstance ? 'dia (1-31)' : 'dia'}
                className="w-24 bg-bg-surface border border-border rounded-md p-2 text-fg text-body-sm focus:outline-none focus:border-tom" />
              <Button size="sm" disabled={!newTitle.trim() || addMut.isPending} onClick={submitAdd}>Adicionar</Button>
            </div>
          </div>

          <div className="border-t border-border pt-3 space-y-2 text-body-sm text-fg-muted">
            {group.due_date && <div>📅 Prazo do grupo: dia {Number(group.due_date.slice(8, 10))}</div>}
            <div>🔁 Repetição: {isRecurrentInstance ? 'Mensal' : 'Não repete'}</div>
            <div>💬 TOM lembra cada subtarefa no prazo dela · <span className="text-tom">ativo</span></div>
          </div>

          <div className="flex items-center gap-md pt-1">
            <Button variant="secondary" onClick={onClose}>Fechar</Button>
            <Button fullWidth disabled={openCount === 0 || completeAllMut.isPending}
              onClick={() => setConfirmAll(true)}>
              Concluir grupo{openCount > 0 ? ` (${openCount} abertas)` : ''}
            </Button>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={confirmAll}
        onClose={() => setConfirmAll(false)}
        title={`Concluir "${group?.title ?? ''}"?`}
        description={openCount > 0 ? `As ${openCount} subtarefas abertas também serão concluídas.` : 'O grupo será concluído.'}
        confirmLabel="Concluir tudo"
        confirmVariant="primary"
        onConfirm={() => completeAllMut.mutate()}
        isPending={completeAllMut.isPending}
      />
      <RecurrenceScopeDialog
        open={scopeFor !== null}
        onClose={() => { setScopeFor(null); setPendingRemove(null); }}
        onChoose={(scope) => {
          if (scopeFor === 'add') addMut.mutate(scope);
          if (scopeFor === 'remove' && pendingRemove) removeMut.mutate({ child: pendingRemove, scope });
          setScopeFor(null); setPendingRemove(null);
        }}
      />
    </AdaptiveSheet>
  );
}
```

- [ ] **Step 2:** Confirmar assinaturas reais de `RecurrenceScopeDialog` (props `open/onClose/onChoose(scope)` — usado em `EditTaskSheet.tsx:329-333`) e `ConfirmDialog` (usado em `PersonalChecklistCard.tsx:263-272`). Ajustar se divergirem e reportar.

- [ ] **Step 3:** Remover de grupo NÃO-recorrente: quando `scopeFor` não abre (else), o `submitRemove` precisa deletar direto — adicionar no `submitRemove`:
```ts
    else removeMut.mutate({ child, scope: 'only_this' });
```
(garantir que o fluxo sem recorrência não fica pendurado).

- [ ] **Step 4:** `npx tsc --noEmit` → exit 0.

---

## Task 9: QuickCreateSheet — 4º kind "Grupo"

**Files:**
- Modify: `web/src/components/QuickCreateSheet.tsx` (lido na íntegra nesta sessão)

- [ ] **Step 1:** Tipo do kind — trocar `type Kind = 'task' | 'event' | 'delegated'` por:
```ts
type Kind = 'task' | 'event' | 'delegated' | 'group';
```

- [ ] **Step 2:** Grid do seletor — no `<div role="tablist" className="grid grid-cols-3 gap-2 mb-md">`, trocar `grid-cols-3` por `grid-cols-4` e adicionar o 4º `KindButton` (import `FolderKanban` de lucide-react):
```tsx
<KindButton active={kind === 'group'} onClick={() => setKind('group')} icon={<FolderKanban size={20} />} label="Grupo" hint="com subtarefas" />
```

- [ ] **Step 3:** Estado do grupo — junto dos outros estados:
```ts
  // Grupo (2026-06-09)
  const [groupMonthly, setGroupMonthly] = useState(true);
  const [groupDueDay, setGroupDueDay] = useState('');           // dia 1-31 (mensal)
  const [groupDueDate, setGroupDueDate] = useState('');         // YMD (sem repetição)
  const [groupChildren, setGroupChildren] = useState<Array<{ title: string; day: string; time: string; reminder: boolean }>>([]);
  const [draftChild, setDraftChild] = useState({ title: '', day: '', time: '', reminder: false });
```
E no reset do `useEffect [open]`: `setGroupMonthly(true); setGroupDueDay(''); setGroupDueDate(''); setGroupChildren([]); setDraftChild({ title: '', day: '', time: '', reminder: false });`

- [ ] **Step 4:** Mutation — junto das outras:
```ts
  const createGroupMut = useMutation({
    mutationFn: async () => {
      const collab = collaborator ?? await ensureSession();
      if (!collab) throw new Error('no_session');
      const children = groupChildren.map((c) => {
        const dayN = c.day ? Number(c.day) : null;
        const dueYmd = groupMonthly
          ? null
          : (dayN ? dayOfMonthToYmd(dayN, today) : null);
        const reminderTimes = c.reminder
          ? [`${groupMonthly ? dayOfMonthToYmd(dayN ?? 1, today) : (dueYmd ?? today)}T${c.time || '09:00'}`]
          : [];
        return {
          title: c.title, dayOfMonth: dayN, due_date: dueYmd,
          due_time: c.time || null, reminderTimes,
        };
      });
      return createGroup({
        title: title.trim(), context: taskCtx, monthly: groupMonthly,
        groupDueDay: groupDueDay ? Number(groupDueDay) : null,
        groupDueDate: groupDueDate || null,
        children, collabId: collab.id,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tasks'] });
      qc.invalidateQueries({ queryKey: ['task-groups'] });
      showToast({ kind: 'success', title: 'Grupo criado', msg: `${groupChildren.length} subtarefa${groupChildren.length === 1 ? '' : 's'}.` });
      onClose();
    },
  });
```
Imports: `import { createGroup } from '../lib/taskGroups';` e `import { dayOfMonthToYmd } from '../lib/taskGroupDates';`

- [ ] **Step 5:** Branch do form — adicionar `kind === 'group'` na cadeia de renderização condicional (após o branch `delegated`), com a UI aprovada:

```tsx
        ) : kind === 'group' ? (
          <>
            <fieldset>
              <legend className="text-label uppercase tracking-wide text-fg-muted mb-1.5">Tipo</legend>
              <div role="radiogroup" className="grid grid-cols-2 gap-2">
                {([{ v: 'work', label: 'Trabalho' }, { v: 'personal', label: 'Pessoal' }] as const).map(o => (
                  <button key={o.v} type="button" role="radio" aria-checked={taskCtx === o.v}
                    onClick={() => setTaskCtx(o.v)}
                    className={['h-11 rounded-md border text-body-md font-semibold transition-colors focus-ring',
                      taskCtx === o.v ? 'bg-tom text-black border-tom' : 'bg-bg-subtle text-fg-secondary border-border'].join(' ')}
                  >{o.label}</button>
                ))}
              </div>
            </fieldset>

            <div>
              <div className="text-label uppercase tracking-wide text-fg-muted mb-1.5 flex items-baseline gap-2">
                <span>Subtarefas</span>
                <span className="text-[10px] normal-case tracking-normal text-fg-muted/70">cada uma com seu prazo</span>
              </div>
              {groupChildren.map((c, i) => (
                <div key={i} className="flex items-center gap-2 rounded-md border border-border bg-bg-elevated px-3 py-2 mb-1.5">
                  <span className="inline-block h-4 w-4 rounded-full border-2 border-fg-muted shrink-0" aria-hidden />
                  <span className="text-body-sm min-w-0 flex-1 truncate">{c.title}</span>
                  {c.day && <span className="text-[11px] px-2 py-0.5 rounded-full bg-bg-elevated2 text-tom">dia {c.day}</span>}
                  {c.time && <span className="text-[11px] px-2 py-0.5 rounded-full bg-bg-elevated2 text-fg-secondary">🕐 {c.time}</span>}
                  {c.reminder && <span className="text-[11px] px-2 py-0.5 rounded-full bg-bg-elevated2 text-fg-secondary">🔔</span>}
                  <button type="button" aria-label="Remover"
                    onClick={() => setGroupChildren(prev => prev.filter((_, j) => j !== i))}
                    className="text-fg-muted hover:text-danger p-0.5">✕</button>
                </div>
              ))}
              <div className="rounded-md border border-dashed border-border p-3 space-y-2 bg-bg-elevated/40">
                <div className="flex items-center gap-2">
                  <span className="inline-block h-4 w-4 rounded-full border-2 border-fg-muted shrink-0" aria-hidden />
                  <input type="text" maxLength={200} value={draftChild.title}
                    onChange={e => setDraftChild(d => ({ ...d, title: e.target.value }))}
                    placeholder="Ex.: Cartão Mercado Pago"
                    className="flex-1 min-w-0 bg-transparent text-body-sm text-fg placeholder:text-fg-muted focus:outline-none" />
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <input type="text" inputMode="numeric" maxLength={2} value={draftChild.day}
                    onChange={e => setDraftChild(d => ({ ...d, day: e.target.value.replace(/\D/g, '') }))}
                    placeholder="📅 dia"
                    className="w-20 h-8 px-2 rounded-full border border-border bg-bg-surface text-body-sm text-fg focus:outline-none focus:border-tom" />
                  <div className="w-24"><TimeInput value={draftChild.time} onChange={(t) => setDraftChild(d => ({ ...d, time: t }))} /></div>
                  <button type="button" onClick={() => setDraftChild(d => ({ ...d, reminder: !d.reminder }))}
                    className={['h-8 px-3 rounded-full border text-[11px] focus-ring',
                      draftChild.reminder ? 'border-tom text-tom' : 'border-border text-fg-muted'].join(' ')}>
                    🔔 lembrete
                  </button>
                  <button type="button" disabled={!draftChild.title.trim()}
                    onClick={() => { setGroupChildren(prev => [...prev, draftChild]); setDraftChild({ title: '', day: '', time: '', reminder: false }); }}
                    className="ml-auto h-8 px-4 rounded-full bg-tom text-black text-body-sm font-semibold disabled:opacity-50 focus-ring">
                    Adicionar
                  </button>
                </div>
              </div>
            </div>

            <fieldset>
              <legend className="text-label uppercase tracking-wide text-fg-muted mb-1.5">Repetição</legend>
              <div role="radiogroup" className="grid grid-cols-2 gap-2">
                {([{ v: true, label: '🔁 Mensal' }, { v: false, label: 'Não repete' }] as const).map(o => (
                  <button key={String(o.v)} type="button" role="radio" aria-checked={groupMonthly === o.v}
                    onClick={() => setGroupMonthly(o.v)}
                    className={['h-11 rounded-md border text-body-sm font-semibold transition-colors focus-ring',
                      groupMonthly === o.v ? 'bg-tom text-black border-tom' : 'bg-bg-subtle text-fg-secondary border-border'].join(' ')}
                  >{o.label}</button>
                ))}
              </div>
              {groupMonthly && <p className="text-body-sm text-fg-muted mt-1.5">Renasce todo mês com os mesmos dias.</p>}
            </fieldset>

            <div>
              <div className="text-label uppercase tracking-wide text-fg-muted mb-1.5 flex items-baseline gap-2">
                <span>Prazo do grupo</span>
                <span className="text-[10px] normal-case tracking-normal text-fg-muted/70">opcional · quando tudo deve estar pronto</span>
              </div>
              {groupMonthly ? (
                <input type="text" inputMode="numeric" maxLength={2} value={groupDueDay}
                  onChange={e => setGroupDueDay(e.target.value.replace(/\D/g, ''))}
                  placeholder="dia do mês (1-31)"
                  className="w-full h-12 px-3 rounded-md bg-bg-elevated border border-border text-fg placeholder:text-fg-muted focus-ring" />
              ) : (
                <DateInput value={groupDueDate} onChange={setGroupDueDate} />
              )}
            </div>
          </>
        ) : (
```

> Nota: o branch entra ANTES do branch final de evento (`) : (`). Conferir a cadeia existente `kind === 'task' ? ... : kind === 'delegated' ? ... : (evento)` e inserir mantendo o evento como else final. Se a classe `bg-bg-elevated2` não existir no Tailwind config, usar `bg-bg-elevated`.

- [ ] **Step 6:** Submit — no `onSubmit`, adicionar o caso:
```ts
    } else if (kind === 'group') {
      if (groupChildren.length === 0) { setError('Adiciona pelo menos uma subtarefa.'); return; }
      createGroupMut.mutate();
```
E incluir `createGroupMut.isPending` em `submitting` e `createGroupMut.error` em `submitError`.

- [ ] **Step 7:** `npx tsc --noEmit && npx vite build` → exit 0.

---

## Task 10: Hoje.tsx — filtro + card do grupo

**Files:**
- Modify: `web/src/screens/Hoje.tsx`

- [ ] **Step 1:** Na query `fetchTasksToday` (L84-126): adicionar ao `baseSelect` os campos `parent_task_id, is_group` e, nas DUAS queries (principal e a de concluídas-no-dia), encadear os filtros:
```ts
    .is('parent_task_id', null)
    .eq('is_group', false)
```
(filha nunca solta; mãe vira card — spec.)

- [ ] **Step 2:** Query dos grupos — junto das queries da tela:
```ts
  const groupsQ = useQuery({
    queryKey: ['task-groups', collaborator?.id, viewDate],
    enabled: Boolean(collaborator?.id),
    queryFn: () => fetchGroupsForDay(collaborator!.id, viewDate),
  });
```
Imports: `import { fetchGroupsForDay } from '../lib/taskGroups';`, `import { TaskGroupCard } from '../components/TaskGroupCard';`, `import { TaskGroupSheet } from '../components/TaskGroupSheet';`, `import { toggleChildWithCascade } from '../lib/taskGroups';`

- [ ] **Step 3:** Estado + handlers:
```ts
  const [openGroupId, setOpenGroupId] = useState<string | null>(null);
  const toggleChildMut = useMutation({
    mutationFn: ({ child, done }: { child: Task; done: boolean }) => toggleChildWithCascade(child, done),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['task-groups'] });
      qc.invalidateQueries({ queryKey: ['tasks'] });
      if (r.groupCompleted) showToast({ kind: 'success', title: '🎉 Grupo concluído!' });
    },
  });
```

- [ ] **Step 4:** Render — na aba/conteúdo de tarefas (Trabalho e Pessoal), ANTES da primeira seção de tarefas (`SortableTaskList`/seções de atraso), renderizar os cards filtrados pelo contexto da aba:
```tsx
  {(groupsQ.data ?? []).filter(g => g.context === currentTabContext).map(g => (
    <TaskGroupCard key={g.id} group={g} viewYmd={viewDate}
      onToggleChild={(child, done) => toggleChildMut.mutate({ child, done })}
      onOpen={(grp) => setOpenGroupId(grp.id)} />
  ))}
```
(`currentTabContext` = a variável existente da aba ativa — 'work'/'personal'; localizar o nome real no arquivo, ex.: `tab`/`context`. Aba "Delegadas" não mostra grupos.)

- [ ] **Step 5:** Renderizar o sheet (junto dos outros sheets da tela):
```tsx
  <TaskGroupSheet open={Boolean(openGroupId)} groupId={openGroupId}
    onClose={() => setOpenGroupId(null)}
    onEditChild={(child) => { setOpenGroupId(null); setEditTask(child); }} />
```
(`setEditTask` = o estado existente que abre o `EditTaskSheet`; conferir o nome real.)

- [ ] **Step 6:** `npx tsc --noEmit && npx vite build` → exit 0. **Não alterar nada além do listado** — tela sagrada.

---

## Task 11: Semana + Agenda desktop

**Files:**
- Modify: `web/src/screens/Semana.tsx`
- Modify: `web/src/screens/agenda/hooks/useAgendaTasks.ts`
- Modify: `web/src/screens/agenda/leftPanel/DayPanel.tsx` (+ Create `web/src/screens/agenda/leftPanel/rows/GroupRow.tsx`)

- [ ] **Step 1 (Semana):** na query de tarefas da Semana, adicionar `.is('parent_task_id', null).eq('is_group', false)` (+ campos no select). Renderizar `TaskGroupCard` por dia: reusar `fetchGroupsForDay(collabId, <ymd do dia>)` via uma query `['task-groups', collabId, ymd]` pro dia selecionado da semana (a Semana renderiza dia-a-dia; aplicar no dia corrente da view, mesmo padrão do Hoje). Reusar `TaskGroupSheet` (mesmo wiring do Hoje, Steps 3/5 do Task 10).

- [ ] **Step 2 (useAgendaTasks):** no `.select(...)` adicionar `parent_task_id, is_group`; nos filtros da query adicionar `.is('parent_task_id', null)` e `.eq('is_group', false)`. Adicionar segunda query/derivação: exportar do hook também `groups` (mães `is_group=true, recurrence_rule null` com filhas nested no range — `due_date` da mãe OU de filha dentro do range), tipo `TaskForPanel` ganhando `is_group?: boolean; subtasks?: TaskForPanel[]`.

- [ ] **Step 3 (GroupRow):** criar `web/src/screens/agenda/leftPanel/rows/GroupRow.tsx` no padrão do `CompactTaskRow.tsx` (mesma densidade):

```tsx
// GroupRow — linha expansível do grupo no painel da Agenda (tela aprovada).
import { useState } from 'react';
import type { TaskForPanel } from '../../hooks/useAgendaTasks';

interface Props {
  group: TaskForPanel & { subtasks?: TaskForPanel[] };
  dayYmd: string;
  onToggleChild: (child: TaskForPanel, done: boolean) => void;
  onOpen: () => void;
}

export function GroupRow({ group, dayYmd, onToggleChild, onOpen }: Props) {
  const [expanded, setExpanded] = useState(true);
  const kids = (group.subtasks ?? []);
  const total = kids.length;
  const done = kids.filter(k => k.status === 'done').length;
  const dayKids = kids.filter(k => k.status !== 'done' && k.due_date && k.due_date <= dayYmd);
  return (
    <div className="px-1 py-0.5">
      <div className="flex items-center gap-1.5 px-1 py-1 rounded hover:bg-bg-elevated min-w-0">
        <button type="button" onClick={() => setExpanded(v => !v)} className="text-fg-muted text-[10px] w-3">{expanded ? '▼' : '▸'}</button>
        <button type="button" onClick={onOpen} className="flex items-center gap-1.5 min-w-0 flex-1 text-left">
          <span aria-hidden>🗂️</span>
          <span className="text-[12px] font-semibold truncate">{group.title}</span>
        </button>
        <span className="w-12 h-[3px] bg-bg-elevated rounded-full overflow-hidden shrink-0">
          <span className="block h-full bg-tom" style={{ width: `${total ? Math.round((done / total) * 100) : 0}%` }} />
        </span>
        <span className="text-[10px] text-fg-muted tabular-nums shrink-0">{done}/{total}</span>
      </div>
      {expanded && dayKids.map(k => (
        <div key={k.id} className="ml-5 border-l border-border pl-2 flex items-center gap-2 px-1 py-0.5 rounded hover:bg-bg-elevated">
          <button type="button" aria-label="Concluir" onClick={() => onToggleChild(k, true)}
            className="h-3 w-3 rounded-full border-2 border-fg-muted hover:border-tom shrink-0" />
          <span className="text-[12px] truncate flex-1">{k.title}</span>
          <span className="text-[10px] text-fg-muted shrink-0">{k.due_time ? `🕐 ${k.due_time.slice(0, 5)}` : (k.due_date === dayYmd ? 'hoje' : '')}</span>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 4:** Fiar o `GroupRow` no `DayPanel.tsx` (onde as `CompactTaskRow` são listadas): grupos do dia primeiro, depois as tasks soltas. `onOpen` abre `TaskGroupSheet` hospedado na `AgendaDesktop.tsx` (estado `openGroupId`, mesmo padrão do Task 10 Step 5). `onToggleChild` usa `toggleChildWithCascade` + invalidação de `['agenda-tasks']` e `['task-groups']`.

- [ ] **Step 5:** `npx tsc --noEmit && npx vite build` → exit 0. Mudanças ADITIVAS — não tocar no resto do layout.

---

## Task 12: EditTaskSheet — tasks de grupo

**Files:**
- Modify: `web/src/components/EditTaskSheet.tsx`

- [ ] **Step 1:** Na seção "Transformar em" (adicionada na feature anterior, guard `onTransform && task.assigned_to === collaborator?.id && ...`), acrescentar à condição:
```ts
&& !task.is_group && !task.parent_task_id
```
(mãe/filha de grupo não delegam nem viram compromisso no v1 — spec.)

- [ ] **Step 2:** Selo da filha — logo após o `<form ...>` abrir (antes do campo Título), adicionar:
```tsx
          {task.parent_task_id && (
            <div className="rounded-md border border-border bg-bg-elevated px-3 py-2 text-body-sm text-fg-muted">
              🗂️ Subtarefa de grupo — prazo e lembretes valem só pra ela.
            </div>
          )}
```

- [ ] **Step 3:** `npx tsc --noEmit` → exit 0.

---

## Task 13: Engine — cascata + selo no contexto do TOM

**Files:**
- Create: `src/services/task-groups.js`
- Modify: `src/engine.js` (branch `complete` de tasks, ~L3941-3999)
- Modify: `src/prompts/system.js` (query de tasks + renderTaskList)

- [ ] **Step 1: Service de cascata**

```js
// src/services/task-groups.js
// Cascata de conclusão de grupos no caminho do WhatsApp (paridade com o PWA).
// Chamado APÓS um complete bem-sucedido de task. Best-effort: nunca lança.
const supabase = require('../supabase/client');

/**
 * Se a task concluída é FILHA de grupo e era a última aberta, conclui a mãe.
 * @returns {Promise<{groupCompleted: boolean, groupTitle: string|null}>}
 */
async function maybeCompleteParentGroup(taskId) {
  try {
    const { data: t } = await supabase
      .from('tasks').select('id, parent_task_id').eq('id', taskId).maybeSingle();
    if (!t || !t.parent_task_id) return { groupCompleted: false, groupTitle: null };

    const { data: siblings } = await supabase
      .from('tasks').select('id, status')
      .eq('parent_task_id', t.parent_task_id).neq('status', 'cancelled');
    const open = (siblings || []).filter((s) => s.status !== 'done').length;
    if (open > 0) return { groupCompleted: false, groupTitle: null };

    const { data: mother } = await supabase
      .from('tasks')
      .update({ status: 'done', completed_at: new Date().toISOString() })
      .eq('id', t.parent_task_id).neq('status', 'done')
      .select('id, title').maybeSingle();
    if (mother) {
      console.log(`[TaskGroups] grupo auto-concluído: ${mother.title} (${String(mother.id).slice(0, 8)})`);
      return { groupCompleted: true, groupTitle: mother.title };
    }
    return { groupCompleted: false, groupTitle: null };
  } catch (e) {
    console.error('[TaskGroups] maybeCompleteParentGroup err:', e.message);
    return { groupCompleted: false, groupTitle: null };
  }
}

module.exports = { maybeCompleteParentGroup };
```

- [ ] **Step 2: Hook no engine** — no branch `complete` de TAREFAS em `applyTaskActions` (engine.js ~L3941; o UPDATE `status:'done'` fica ~L3989-3995), APÓS o update bem-sucedido (onde `okCount++` do complete acontece), adicionar:

```js
        // Grupos: se era a última filha aberta, conclui a mãe (paridade com PWA).
        const tg = require('./services/task-groups');
        const cascade = await tg.maybeCompleteParentGroup(t.id);
        if (cascade.groupCompleted && cascade.groupTitle) {
          okMessages.push(`🎉 Com essa, o grupo *${cascade.groupTitle}* fechou completo!`);
        }
```
> O implementador DEVE ler o entorno real do branch (3941-4010) pra usar o acumulador de mensagens correto (`okMessages`/`failMessages`/equivalente — conferir o nome usado no arquivo; se não houver acumulador de sucesso, apenas logar e seguir).

- [ ] **Step 3: Contexto do TOM** — em `src/prompts/system.js`:
(a) na query que busca as tasks do colaborador pro contexto (localizar o `.select(` das tasks pendentes — grep `from('tasks')` no arquivo), adicionar os campos `parent_task_id, is_group`;
(b) onde cada linha de task é renderizada (`renderTaskList` ou equivalente — grep `renderTaskList`), enriquecer:
- task com `is_group=true`: renderizar como `🗂️ <título> (grupo)` ;
- task com `parent_task_id`: sufixo ` · 🗂️ grupo` no fim da linha.
(Não montar hierarquia complexa — só sinalizar, spec v1.)
Adicionar também o filtro pra NÃO injetar filhas-template/mãe-template: a query já exclui templates de recorrência; garantir `.is('parent_task_id', null)` NÃO é aplicado aqui (filhas DEVEM aparecer pro TOM — com selo), apenas conferir que templates não vazam (filha-template tem mãe com recurrence_rule — se a query atual já filtra por due_date/status, filhas-template têm due no mês corrente e PODEM vazar: adicionar exclusão via join? v1 pragmático: filtrar em JS — após o fetch, remover tasks cujo `parent_task_id` aponte pra task com `recurrence_rule` — exige buscar os ids das mães-template do colaborador: 1 query `select id from tasks where is_group and recurrence_rule is not null and assigned_to=<id>` e filtrar).

- [ ] **Step 4:** `node --check src/services/task-groups.js && node --check src/engine.js && node --check src/prompts/system.js` → exit 0.

---

## Task 14: Verificação final

**Files:** nenhum (validação).

- [ ] **Step 1:** Gates completos:
```
cd _remote/web && npx tsc --noEmit && npx vite build
npx vitest run src/lib/taskGroupDates.test.ts src/lib/delegableMembers.test.ts
cd _remote && node --test src/services/task-group-dates.test.js src/services/recurrence-engine-groups.test.js
node --check src/services/recurrence-engine.js src/services/task-groups.js src/engine.js src/prompts/system.js
```
Expected: tudo verde.

- [ ] **Step 2:** Preview (`web-preview`, localhost:4173, limpar SW caches) — 375px e 1440px:
- "Novo" mostra 4 kinds; criar grupo mensal de teste ("TESTE Grupo — apagar", 2 filhas dias 12/17, mensal) na conta do Alf.
- Hoje: card do grupo aparece (filha dia 12 entra como "do dia" se view=12) com barra/contagem; tocar abre o TaskGroupSheet; DnD reordena; toggle de filha atualiza barra; concluir última → 🎉 e mãe fecha; "Concluir grupo" pede confirmação.
- Verificar no banco (MCP): template criado (mãe `is_group+rrule` + filhas-template), instância do ciclo corrente + filhas-instância com `parent_task_id`/`recurrence_parent_id` corretos; `task_reminders` clonados.
- Tarefas normais continuam funcionando (sem regressão visual nas seções do Hoje).
- **Apagar o grupo de teste no fim** (delete da mãe-template e da mãe-instância — cascade limpa filhas) — anotar ids antes.

- [ ] **Step 3:** Forçar materialização futura (simular virada): via MCP, conferir que rodar `materializeSeries` de novo não duplica (idempotência) — opcional, coberto por unit; no mínimo conferir contagem de instâncias == 1 ciclo + futuros do horizonte.

- [ ] **Step 4:** Auto-deploy do turno publica web + engine (src/) — sem ação manual.

---

## Self-review do plano (feito)

- **Cobertura da spec:** modelo (T1) ✓ · árvore motor+client (T4/T5) ✓ · criação template+ciclo corrente (T6/T9) ✓ · cascata dupla PWA (T6/T8) e engine (T13) ✓ · card Hoje (T7/T10) ✓ · detalhe DnD+add+escopo (T8) ✓ · Semana+Agenda desktop (T11) ✓ · esconder transformar + selo (T12) ✓ · selo no TOM (T13) ✓ · visibilidade filha/template (T10/T11 filtros + T6 GROUP_SELECT) ✓ · testes (T2/T3/T4 unit; T14 manual) ✓.
- **Consistências:** `childDueDateForCycle(childYmd, motherYmd)` mesma assinatura em TS e CJS; `toggleChildWithCascade(child, done)` usada em T8/T10/T11; `fetchGroupsForDay(collabId, ymd)` em T10/T11; `createGroup(input)` em T9.
- **Riscos sinalizados nos próprios steps:** nomes de variáveis locais das telas (currentTabContext/setEditTask) e acumulador de mensagens do engine — implementador confere o nome real e reporta.
