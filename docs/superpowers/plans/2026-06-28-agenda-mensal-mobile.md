# Agenda Mensal Mobile (aba "Mês") — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adicionar a visão "Mês" à agenda do PWA mobile (`/mes`): uma grade de calendário com chips coloridos por status/tipo; tocar um dia abre um bottom-sheet que reusa as ações de tarefa/compromisso que já existem (concluir, detalhe, editar, reagendar, excluir, recorrência, lembrete).

**Architecture:** Tela `Mes` (espelha `Hoje`/`Semana`) → `MonthGrid` (reusa `getMonthGrid`, chips via lógica pura `monthChips`) → tocar dia → `MonthDaySheet` → `DayBoard` (lista + sheets de ação **reusados** de `Hoje`). Sheets são `fixed inset-0 z-50` e empilham por ordem de DOM — sem mudança de z-index. `Hoje.tsx`/`Semana.tsx` não são reescritos (só 1 mudança aditiva no `Hoje`: ler `?date=`).

**Tech Stack:** React 18, TypeScript, Vite, Tailwind, @tanstack/react-query, react-router-dom v6, vitest.

## Global Constraints

- **Não commitar entre tasks.** O Stop hook (auto-deploy) commita tudo em `_remote/` no fim do turno. Cada task termina em **verificação** (vitest/`tsc`/build/preview), nunca `git commit`. (CLAUDE.md.)
- **Design System obrigatório:** nada de `<input>`/`<select>`/`<button>` nativo pra controles — usar DS. Os componentes reusados (`EditTaskSheet` etc.) já cumprem isso.
- **Guardrail:** `Hoje.tsx` e `Semana.tsx` não são reescritos. Única exceção: Task 7 (1 linha aditiva no `Hoje` pra ler `?date=`). Desktop `?view=month` permanece intacto.
- **Tokens:** verde da marca = `tom` (`tom-deep` pra texto); cores semânticas via classes Tailwind tokenizadas (`bg-danger/10`, `text-info`, etc.). Nunca hex solto.
- **Datas:** YMD local sempre via `todaySP()`/`localYmd()` de `utils/date` ou via `Intl` em `America/Sao_Paulo`. Nunca `toISOString().slice(0,10)` pra um dia local.
- **Comandos** (rodar de `_remote/web`): teste `npx vitest run <arquivo>`; typecheck `npx tsc --noEmit`; build `npx vite build`; preview já em `localhost:4173`.

## Visão geral das tasks

1. `lib/monthChips.ts` — lógica pura dos chips (tom por status/tipo, agrupar por dia). **vitest.**
2. `lib/dayItems.ts` — `fetchTasksForDay` (Task[] completos de um dia). typecheck.
3. `screens/agenda/mobile/MonthGrid.tsx` — a grade.
4. `screens/agenda/mobile/DayBoard.tsx` — lista + sheets de ação reusados.
5. `screens/agenda/mobile/MonthDaySheet.tsx` — bottom-sheet do dia em volta do `DayBoard`.
6. `screens/Mes.tsx` — a tela (nav de mês + grade + sheet + FAB).
7. `screens/Hoje.tsx` — ler `?date=` (faz o "Ver dia completo" abrir o dia certo). **Aditivo.**
8. Integração: `AgendaTabs` (3 slots), `App.tsx` (rota `/mes`), `AppShell` (`AGENDA_PATHS`), `lib/navItems.ts` (matchPaths). **vitest em navItems.**
9. Validação final: typecheck + build + preview 375px + regressão.

---

### Task 1: `lib/monthChips.ts` — lógica pura dos chips

**Files:**
- Create: `web/src/lib/monthChips.ts`
- Test: `web/src/lib/monthChips.test.ts`

**Interfaces:**
- Produces: `type ChipTone`, `interface MonthChip {id,label,tone,kind,sortKey}`, `CHIP_TONE_CLASS: Record<ChipTone,string>`, `ymdInSP(iso:string):string`, `taskChipTone(t,todayYmd):ChipTone`, `eventChipTone(e):ChipTone|null`, `buildMonthDayMap(tasks:TaskForPanel[], events:EventForGrid[], todayYmd:string):Map<string,MonthChip[]>`.
- Consumes: `TaskForPanel` de `../screens/agenda/hooks/useAgendaTasks`, `EventForGrid` de `../screens/agenda/hooks/useAgendaEvents`.

- [ ] **Step 1: Escreve o teste que falha**

`web/src/lib/monthChips.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { taskChipTone, eventChipTone, ymdInSP, buildMonthDayMap } from './monthChips';

describe('taskChipTone', () => {
  it('done → done', () => expect(taskChipTone({ status: 'done', due_date: '2026-06-01' }, '2026-06-28')).toBe('done'));
  it('vencida e não-done → overdue', () => expect(taskChipTone({ status: 'pending', due_date: '2026-06-10' }, '2026-06-28')).toBe('overdue'));
  it('no prazo → open', () => expect(taskChipTone({ status: 'pending', due_date: '2026-06-28' }, '2026-06-28')).toBe('open'));
  it('sem due_date → open', () => expect(taskChipTone({ status: 'pending', due_date: null }, '2026-06-28')).toBe('open'));
});

describe('eventChipTone', () => {
  it('cancelado → null', () => expect(eventChipTone({ status: 'cancelled' })).toBeNull());
  it('done → eventDone', () => expect(eventChipTone({ status: 'done' })).toBe('eventDone'));
  it('agendado → event', () => expect(eventChipTone({ status: 'scheduled' })).toBe('event'));
});

describe('ymdInSP', () => {
  it('02:00Z do dia 28 ainda é dia 27 em SP (UTC-3)', () =>
    expect(ymdInSP('2026-06-28T02:00:00.000Z')).toBe('2026-06-27'));
  it('12:00Z do dia 15 é dia 15 em SP', () =>
    expect(ymdInSP('2026-06-15T12:00:00.000Z')).toBe('2026-06-15'));
});

describe('buildMonthDayMap', () => {
  const tasks = [
    { id: 't1', title: 'Conta', status: 'pending', due_date: '2026-06-10' },
    { id: 't2', title: 'Sem data', status: 'pending', due_date: null },
  ] as any;
  const events = [
    { id: 'e1', title: 'Reunião', status: 'scheduled', start_at: '2026-06-10T17:00:00.000Z' },
    { id: 'e2', title: 'Cancelado', status: 'cancelled', start_at: '2026-06-10T18:00:00.000Z' },
  ] as any;
  const map = buildMonthDayMap(tasks, events, '2026-06-28');

  it('agrupa por dia e ignora tarefa sem data + evento cancelado', () => {
    expect(map.get('2026-06-10')!.map(c => c.id)).toEqual(['e-e1', 't-t1']);
    expect([...map.keys()]).toEqual(['2026-06-10']);
  });
  it('evento vem antes da tarefa no mesmo dia', () => {
    const day = map.get('2026-06-10')!;
    expect(day[0].kind).toBe('event');
    expect(day[1].kind).toBe('task');
  });
});
```

- [ ] **Step 2: Roda e confirma a falha**

Run: `cd _remote/web && npx vitest run src/lib/monthChips.test.ts`
Expected: FAIL (`monthChips` não existe).

- [ ] **Step 3: Implementa**

`web/src/lib/monthChips.ts`:
```ts
import type { TaskForPanel } from '../screens/agenda/hooks/useAgendaTasks';
import type { EventForGrid } from '../screens/agenda/hooks/useAgendaEvents';

export type ChipTone = 'overdue' | 'open' | 'done' | 'event' | 'eventDone';

export interface MonthChip {
  id: string;
  label: string;
  tone: ChipTone;
  kind: 'task' | 'event';
  /** ordenação: eventos (prefixo 0, por start_at) antes de tarefas (prefixo 1, por título). */
  sortKey: string;
}

/** Fundo leve (token a baixa opacidade) + texto do mesmo família. Adapta a dark/light. */
export const CHIP_TONE_CLASS: Record<ChipTone, string> = {
  overdue: 'bg-danger/10 text-danger',
  open: 'bg-tom/20 text-tom-deep',
  done: 'bg-transparent text-fg-muted line-through',
  event: 'bg-info/10 text-info',
  eventDone: 'bg-transparent text-fg-muted line-through',
};

/** YMD (America/Sao_Paulo) de um ISO — evita o shift de UTC após 21h BRT. */
export function ymdInSP(iso: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date(iso));
}

export function taskChipTone(t: { status: string; due_date: string | null }, todayYmd: string): ChipTone {
  if (t.status === 'done') return 'done';
  if (t.due_date && t.due_date.slice(0, 10) < todayYmd) return 'overdue';
  return 'open';
}

/** null = não mostra (cancelado). */
export function eventChipTone(e: { status: string }): ChipTone | null {
  if (e.status === 'cancelled') return null;
  if (e.status === 'done') return 'eventDone';
  return 'event';
}

export function buildMonthDayMap(
  tasks: TaskForPanel[],
  events: EventForGrid[],
  todayYmd: string,
): Map<string, MonthChip[]> {
  const map = new Map<string, MonthChip[]>();
  const push = (ymd: string, chip: MonthChip) => {
    const list = map.get(ymd) ?? [];
    list.push(chip);
    map.set(ymd, list);
  };
  for (const e of events) {
    const tone = eventChipTone(e);
    if (!tone) continue;
    push(ymdInSP(e.start_at), { id: `e-${e.id}`, label: e.title, tone, kind: 'event', sortKey: `0-${e.start_at}` });
  }
  for (const t of tasks) {
    if (!t.due_date) continue;
    push(t.due_date.slice(0, 10), { id: `t-${t.id}`, label: t.title, tone: taskChipTone(t, todayYmd), kind: 'task', sortKey: `1-${t.title}` });
  }
  for (const [, list] of map) list.sort((a, b) => a.sortKey.localeCompare(b.sortKey));
  return map;
}
```

- [ ] **Step 4: Roda e confirma o verde**

Run: `cd _remote/web && npx vitest run src/lib/monthChips.test.ts`
Expected: PASS (todos).

---

### Task 2: `lib/dayItems.ts` — `fetchTasksForDay`

**Files:**
- Create: `web/src/lib/dayItems.ts`

**Interfaces:**
- Produces: `fetchTasksForDay(collabId: string, ymd: string, groupIds?: string[]): Promise<Task[]>` — objetos `Task` completos com vencimento (due_date) EXATAMENTE no dia, na mesma visibilidade do `useAgendaTasks` (minhas + criadas por mim + pool dos meus grupos). Alimenta os sheets de detalhe/edição (que exigem `Task`).
- Consumes: `supabase` de `./supabase`, `Task` de `../types`.

> Verificação: este arquivo faz fetch no banco — segue a convenção do projeto (igual `lib/events.ts`, sem unit test). Validação = `tsc` (Task 9) + uso real no `DayBoard` (preview).

- [ ] **Step 1: Implementa**

`web/src/lib/dayItems.ts`:
```ts
import { supabase } from './supabase';
import type { Task } from '../types';

// Mesmo select de fetchTasksToday (Hoje.tsx) — os sheets precisam de todos os campos.
const DAY_TASK_SELECT = 'id, title, description, status, context, priority, category, action_type, source, due_date, due_time, scheduled_date, remind_at, eisenhower_quadrant, sort_position, project_id, assigned_to, assigned_group_id, created_by, completed_at, recurrence_rule, recurrence_parent_id, parent_task_id, is_group, projects(name, category), assignee:collaborators!tasks_assigned_to_fkey(full_name), creator:collaborators!tasks_created_by_fkey(preferred_name, full_name), work_group:work_groups!tasks_assigned_group_id_fkey(name), task_reminders(remind_at, sent_at)';

/** Tarefas com due_date == ymd, visíveis ao colaborador (minhas / criadas por mim / pool
 *  dos meus grupos). Objetos Task completos. Espelha a visibilidade de useAgendaTasks. */
export async function fetchTasksForDay(collabId: string, ymd: string, groupIds: string[] = []): Promise<Task[]> {
  const vis = [`assigned_to.eq.${collabId}`, `created_by.eq.${collabId}`];
  if (groupIds.length) vis.push(`assigned_group_id.in.(${groupIds.join(',')})`);
  const { data, error } = await supabase
    .from('tasks')
    .select(DAY_TASK_SELECT)
    .or(vis.join(','))
    .neq('status', 'cancelled')
    .eq('data_classification', 'real')
    .is('parent_task_id', null)
    .eq('is_group', false)
    .eq('due_date', ymd)
    .order('due_time', { ascending: true, nullsFirst: false })
    .order('eisenhower_quadrant', { ascending: true, nullsFirst: false });
  if (error) throw error;
  return (data ?? []) as unknown as Task[];
}
```

- [ ] **Step 2: Verifica o tipo**

Run: `cd _remote/web && npx tsc --noEmit`
Expected: 0 erros relativos a `dayItems.ts`.

---

### Task 3: `screens/agenda/mobile/MonthGrid.tsx` — a grade

**Files:**
- Create: `web/src/screens/agenda/mobile/MonthGrid.tsx`

**Interfaces:**
- Consumes: `getMonthGrid` de `../lib/monthGrid`; `buildMonthDayMap`, `CHIP_TONE_CLASS` de `../../../lib/monthChips`; `todaySP` de `../../../utils/date`; `TaskForPanel`/`EventForGrid` dos hooks.
- Produces: `MonthGrid({ monthDate: Date; tasks: TaskForPanel[]; events: EventForGrid[]; onDayClick: (ymd: string) => void })`.

- [ ] **Step 1: Implementa**

`web/src/screens/agenda/mobile/MonthGrid.tsx`:
```tsx
import { getMonthGrid } from '../lib/monthGrid';
import { buildMonthDayMap, CHIP_TONE_CLASS } from '../../../lib/monthChips';
import { todaySP } from '../../../utils/date';
import type { TaskForPanel } from '../hooks/useAgendaTasks';
import type { EventForGrid } from '../hooks/useAgendaEvents';

const WEEKDAYS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];

function ymdLocal(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

interface Props {
  monthDate: Date;
  tasks: TaskForPanel[];
  events: EventForGrid[];
  onDayClick: (ymd: string) => void;
}

export function MonthGrid({ monthDate, tasks, events, onDayClick }: Props) {
  const todayYmd = todaySP();
  const grid = getMonthGrid(monthDate);
  const byDay = buildMonthDayMap(tasks, events, todayYmd);
  const curMonth = monthDate.getMonth();

  return (
    <div className="surface overflow-hidden">
      <div className="grid grid-cols-7 border-b border-border">
        {WEEKDAYS.map(w => (
          <div key={w} className="py-2 text-center text-[11px] text-fg-muted">{w}</div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {grid.map(d => {
          const ymd = ymdLocal(d);
          const inMonth = d.getMonth() === curMonth;
          const isToday = ymd === todayYmd;
          const chips = byDay.get(ymd) ?? [];
          return (
            <button
              type="button"
              key={ymd}
              onClick={() => onDayClick(ymd)}
              className="min-h-[74px] p-1 text-left align-top border-b border-r border-border/40 focus-ring"
            >
              <div className="text-center mb-1">
                {isToday ? (
                  <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-tom text-black text-[13px] font-semibold tabular-nums">
                    {d.getDate()}
                  </span>
                ) : (
                  <span className={['text-[13px] tabular-nums', inMonth ? 'text-fg' : 'text-fg-muted/50'].join(' ')}>
                    {d.getDate()}
                  </span>
                )}
              </div>
              <div className="space-y-0.5">
                {chips.slice(0, 3).map(c => (
                  <div key={c.id} className={['text-[11px] leading-tight rounded px-1 truncate', CHIP_TONE_CLASS[c.tone]].join(' ')}>
                    {c.label}
                  </div>
                ))}
                {chips.length > 3 && (
                  <div className="text-[11px] text-fg-muted pl-0.5">+{chips.length - 3}</div>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verifica o tipo**

Run: `cd _remote/web && npx tsc --noEmit`
Expected: 0 erros relativos a `MonthGrid.tsx`.

---

### Task 4: `screens/agenda/mobile/DayBoard.tsx` — lista + ações reusadas

**Files:**
- Create: `web/src/screens/agenda/mobile/DayBoard.tsx`

**Interfaces:**
- Consumes: `fetchTasksForDay` (Task 2); `fetchEventsForDay` de `../../../lib/events`; `TaskRow`, `EventRow`, `EditEventSheet`, `EditTaskSheet`, `RescheduleSheet`, `TaskDetailSheet`, `TaskChecklistSection` de `../../../components/*`; `taskDetailMeta` de `../../../lib/taskDetail`; `useTaskTransform` de `../../../hooks/useTaskTransform`; `useMyGroupIds` de `../../../hooks/useWorkGroups`; `useAuth`; `Task`/`CalendarEvent` de `../../../types`.
- Produces: `DayBoard({ ymd: string })` — renderiza as linhas do dia e **possui** a pilha de sheets (detalhe/editar/reagendar/excluir/transformar/evento). Recorrência + Lembrete vêm de dentro do `EditTaskSheet`.

> Reuso 1:1 da fiação do `Hoje` (linhas 837-872 + handlers), com mutações simples (invalida amplo). Os sheets são `fixed inset-0 z-50`: aninhados aqui, empilham sobre o `MonthDaySheet` por ordem de DOM — sem z-index.

- [ ] **Step 1: Implementa**

`web/src/screens/agenda/mobile/DayBoard.tsx`:
```tsx
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../../contexts/AuthContext';
import { supabase, supabaseConfigured } from '../../../lib/supabase';
import { fetchEventsForDay } from '../../../lib/events';
import { fetchTasksForDay } from '../../../lib/dayItems';
import { useMyGroupIds } from '../../../hooks/useWorkGroups';
import { useTaskTransform } from '../../../hooks/useTaskTransform';
import { TaskRow } from '../../../components/TaskRow';
import { EventRow } from '../../../components/EventRow';
import { EditEventSheet } from '../../../components/EditEventSheet';
import { EditTaskSheet } from '../../../components/EditTaskSheet';
import { RescheduleSheet } from '../../../components/RescheduleSheet';
import { TaskDetailSheet } from '../../../components/TaskDetailSheet';
import { TaskChecklistSection } from '../../../components/TaskChecklistSection';
import { EmptyState } from '../../../components/EmptyState';
import { taskDetailMeta } from '../../../lib/taskDetail';
import { CalendarClock, ListTodo } from 'lucide-react';
import type { Task, CalendarEvent } from '../../../types';

export function DayBoard({ ymd }: { ymd: string }) {
  const { collaborator } = useAuth();
  const qc = useQueryClient();
  const tt = useTaskTransform();
  const myGroupIds = useMyGroupIds();

  const [editingEvent, setEditingEvent] = useState<CalendarEvent | null>(null);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [readingTask, setReadingTask] = useState<Task | null>(null);
  const [reschedulingTask, setReschedulingTask] = useState<Task | null>(null);

  const enabled = Boolean(collaborator?.id && supabaseConfigured);
  const groupKey = (myGroupIds.data ?? []).join(',');

  const { data: tasks = [] } = useQuery({
    queryKey: ['agenda-day-tasks', collaborator?.id, ymd, groupKey],
    queryFn: () => fetchTasksForDay(collaborator!.id, ymd, myGroupIds.data ?? []),
    enabled,
  });
  const { data: events = [] } = useQuery({
    queryKey: ['agenda-day-events', collaborator?.id, ymd],
    queryFn: () => fetchEventsForDay(collaborator!.id, ymd),
    enabled,
  });

  const invalidateAll = () => {
    for (const k of [['agenda-day-tasks'], ['agenda-day-events'], ['agenda-tasks'], ['agenda-events'], ['tasks'], ['events']]) {
      qc.invalidateQueries({ queryKey: k });
    }
  };

  const toggleTask = useMutation({
    mutationFn: async (task: Task) => {
      const isDone = task.status === 'done';
      const { error } = await supabase.from('tasks').update(
        isDone
          ? { status: 'pending', completed_at: null, completed_by: null }
          : { status: 'done', completed_at: new Date().toISOString(), completed_by: collaborator?.id },
      ).eq('id', task.id);
      if (error) throw error;
    },
    onSuccess: invalidateAll,
  });
  const deleteTask = useMutation({
    mutationFn: async (task: Task) => {
      const { error } = await supabase.from('tasks').delete().eq('id', task.id);
      if (error) throw error;
    },
    onSuccess: invalidateAll,
  });
  const toggleEventDone = useMutation({
    mutationFn: async (event: CalendarEvent) => {
      const next = event.status === 'done' ? 'scheduled' : 'done';
      const { data, error } = await supabase.from('events').update({ status: next }).eq('id', event.id).select('id');
      if (error) throw error;
      if (!data || data.length === 0) throw new Error('Sem permissão para alterar este compromisso.');
    },
    onSuccess: invalidateAll,
  });
  const cancelEvent = useMutation({
    mutationFn: async (event: CalendarEvent) => {
      const { data, error } = await supabase.from('events').update({ status: 'cancelled' }).eq('id', event.id).select('id');
      if (error) throw error;
      if (!data || data.length === 0) throw new Error('Sem permissão para cancelar este compromisso.');
    },
    onSuccess: invalidateAll,
  });
  const deleteEvent = useMutation({
    mutationFn: async (event: CalendarEvent) => {
      const { error } = await supabase.from('events').delete().eq('id', event.id);
      if (error) throw error;
    },
    onSuccess: invalidateAll,
  });

  const isEmpty = tasks.length === 0 && events.length === 0;

  return (
    <div className="space-y-md">
      {isEmpty && (
        <EmptyState icon={<ListTodo size={28} />} title="Nada nesse dia" description="Toque no + pra criar uma tarefa ou compromisso." />
      )}

      {events.length > 0 && (
        <section className="surface px-md">
          <div className="flex items-center gap-2 py-3 border-b border-border text-label uppercase tracking-wide text-fg-muted">
            <CalendarClock size={14} /> Compromissos
          </div>
          {events.map(e => (
            <EventRow
              key={e.id}
              event={e}
              onClick={setEditingEvent}
              onToggleDone={(ev) => toggleEventDone.mutate(ev)}
              onCancel={(ev) => cancelEvent.mutate(ev)}
              onDelete={(ev) => deleteEvent.mutate(ev)}
            />
          ))}
        </section>
      )}

      {tasks.length > 0 && (
        <section className="space-y-sm">
          {tasks.map(t => (
            <TaskRow
              key={t.id}
              task={t}
              onOpen={setReadingTask}
              onToggle={(task) => toggleTask.mutate(task)}
              onEdit={setEditingTask}
              onReschedule={setReschedulingTask}
              onDelete={(task) => deleteTask.mutate(task)}
              onTransformToEvent={tt.canConvert(t) ? tt.openConvert : undefined}
              onDelegate={tt.canDelegate(t) ? tt.openDelegate : undefined}
            />
          ))}
        </section>
      )}

      <EditEventSheet open={Boolean(editingEvent)} event={editingEvent} onClose={() => setEditingEvent(null)} />
      <RescheduleSheet open={Boolean(reschedulingTask)} task={reschedulingTask} onClose={() => setReschedulingTask(null)} />
      <EditTaskSheet open={Boolean(editingTask)} task={editingTask} onClose={() => setEditingTask(null)} onTransform={tt.onEditSheetTransform} canDelegate={tt.canDelegateAny} />
      {readingTask && (() => {
        const rt = readingTask;
        const meta = taskDetailMeta({
          meId: collaborator?.id ?? null,
          assigned_to: rt.assigned_to ?? null,
          created_by: rt.created_by ?? null,
          assigned_group_id: rt.assigned_group_id ?? null,
          creatorName: rt.creator?.preferred_name ?? rt.creator?.full_name ?? null,
          assigneeName: rt.assignee?.full_name ?? null,
          groupName: (rt as Task & { work_group?: { name?: string } | null }).work_group?.name ?? null,
        });
        const isDone = rt.status === 'done';
        return (
          <TaskDetailSheet
            open
            onClose={() => setReadingTask(null)}
            title={rt.title}
            metaLine={meta.label}
            description={rt.description}
            isRecurring={Boolean(rt.recurrence_rule || rt.recurrence_parent_id)}
            isDone={isDone}
            canComplete={!isDone}
            onComplete={() => { toggleTask.mutate(rt); setReadingTask(null); }}
            onEdit={() => { setEditingTask(rt); setReadingTask(null); }}
            checklist={<TaskChecklistSection parent={{ id: rt.id, context: rt.context, assigned_to: rt.assigned_to ?? null, assigned_group_id: rt.assigned_group_id ?? null }} meId={collaborator?.id} editable />}
          />
        );
      })()}
      {tt.sheets}
    </div>
  );
}
```

- [ ] **Step 2: Verifica o tipo**

Run: `cd _remote/web && npx tsc --noEmit`
Expected: 0 erros. (Se `taskDetailMeta`/`useTaskTransform` exigirem campos extras, alinhe com o uso em `Hoje.tsx` linhas 837-872 — é a mesma fiação.)

---

### Task 5: `screens/agenda/mobile/MonthDaySheet.tsx`

**Files:**
- Create: `web/src/screens/agenda/mobile/MonthDaySheet.tsx`

**Interfaces:**
- Consumes: `AdaptiveSheet` de `../../../components/AdaptiveSheet`; `DayBoard` (Task 4); `dowShort`, `brShort` de `../../../utils/date`; `ArrowRight` de `lucide-react`.
- Produces: `MonthDaySheet({ open: boolean; ymd: string | null; onClose: () => void; onOpenFullDay: (ymd: string) => void })`.

- [ ] **Step 1: Implementa**

`web/src/screens/agenda/mobile/MonthDaySheet.tsx`:
```tsx
import { ArrowRight } from 'lucide-react';
import { AdaptiveSheet } from '../../../components/AdaptiveSheet';
import { DayBoard } from './DayBoard';
import { dowShort, brShort } from '../../../utils/date';

interface Props {
  open: boolean;
  ymd: string | null;
  onClose: () => void;
  onOpenFullDay: (ymd: string) => void;
}

export function MonthDaySheet({ open, ymd, onClose, onOpenFullDay }: Props) {
  return (
    <AdaptiveSheet
      open={open && Boolean(ymd)}
      onClose={onClose}
      title={ymd ? `${dowShort(ymd)} ${brShort(ymd)}` : ''}
      size="md"
    >
      {ymd && (
        <div className="space-y-md">
          <DayBoard ymd={ymd} />
          <button
            type="button"
            onClick={() => onOpenFullDay(ymd)}
            className="w-full flex items-center justify-center gap-2 py-3 rounded-md border border-border text-fg-secondary hover:text-fg focus-ring"
          >
            Ver dia completo <ArrowRight size={16} />
          </button>
        </div>
      )}
    </AdaptiveSheet>
  );
}
```

- [ ] **Step 2: Verifica o tipo**

Run: `cd _remote/web && npx tsc --noEmit`
Expected: 0 erros relativos a `MonthDaySheet.tsx`. (Confirme a assinatura do `AdaptiveSheet` — `open`, `onClose`, `title`, `size`, `children` — igual ao uso em `EditTaskSheet.tsx:229`.)

---

### Task 6: `screens/Mes.tsx` — a tela

**Files:**
- Create: `web/src/screens/Mes.tsx`

**Interfaces:**
- Consumes: `useAgendaTasks`/`useAgendaEvents` de `./agenda/hooks/*`; `AgendaFilters` de `./agenda/hooks/useAgendaFilters`; `getMonthGrid` de `./agenda/lib/monthGrid`; `MonthGrid` (Task 3); `MonthDaySheet` (Task 5); `Fab`, `QuickCreateSheet` de `../components/*`; `useNavigate`; `ChevronLeft`/`ChevronRight`.
- Produces: `Mes()` (export nomeado) — tela mobile `/mes`.

- [ ] **Step 1: Implementa**

`web/src/screens/Mes.tsx`:
```tsx
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useAgendaTasks } from './agenda/hooks/useAgendaTasks';
import { useAgendaEvents } from './agenda/hooks/useAgendaEvents';
import type { AgendaFilters } from './agenda/hooks/useAgendaFilters';
import { getMonthGrid } from './agenda/lib/monthGrid';
import { MonthGrid } from './agenda/mobile/MonthGrid';
import { MonthDaySheet } from './agenda/mobile/MonthDaySheet';
import { Fab } from '../components/Fab';
import { QuickCreateSheet } from '../components/QuickCreateSheet';

// Mês = visão geral: mostra tudo (sem as pills de contexto do Dia/Semana).
// Se o tsc reclamar de chaves faltando, adicione-as como `true` (ver a interface AgendaFilters).
const ALL_FILTERS: AgendaFilters = { trabalho: true, pessoal: true, delegadas: true };

function firstOfThisMonth(): Date {
  const n = new Date();
  return new Date(n.getFullYear(), n.getMonth(), 1);
}

export function Mes() {
  const navigate = useNavigate();
  const [viewMonth, setViewMonth] = useState<Date>(firstOfThisMonth);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);

  const grid = getMonthGrid(viewMonth);
  const from = grid[0];
  const last = grid[grid.length - 1];
  const to = new Date(last.getFullYear(), last.getMonth(), last.getDate(), 23, 59, 59);

  const { tasks } = useAgendaTasks({ from, to, filters: ALL_FILTERS });
  const { events } = useAgendaEvents({ from, to, filters: ALL_FILTERS });

  const monthLabel = viewMonth.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
  const now = new Date();
  const isCurMonth = now.getFullYear() === viewMonth.getFullYear() && now.getMonth() === viewMonth.getMonth();
  const stepMonth = (delta: number) => setViewMonth(m => new Date(m.getFullYear(), m.getMonth() + delta, 1));

  return (
    <div className="space-y-lg">
      <div className="surface px-md py-2 flex items-center gap-2">
        <button type="button" onClick={() => stepMonth(-1)} aria-label="Mês anterior" className="h-8 w-8 grid place-items-center rounded-full text-fg-muted hover:bg-bg-elevated focus-ring">
          <ChevronLeft size={18} />
        </button>
        <span className="flex-1 text-center text-body-md text-fg capitalize">{monthLabel}</span>
        <button type="button" onClick={() => stepMonth(1)} aria-label="Próximo mês" className="h-8 w-8 grid place-items-center rounded-full text-fg-muted hover:bg-bg-elevated focus-ring">
          <ChevronRight size={18} />
        </button>
        {!isCurMonth && (
          <button type="button" onClick={() => setViewMonth(firstOfThisMonth())} className="ml-1 px-2 py-1 text-body-sm rounded-sm bg-bg-elevated text-fg-secondary hover:text-fg focus-ring">
            Mês atual
          </button>
        )}
      </div>

      <MonthGrid monthDate={viewMonth} tasks={tasks} events={events} onDayClick={setSelectedDay} />

      <Fab onClick={() => setSheetOpen(true)} label="Novo" ariaLabel="Criar novo item" />
      <QuickCreateSheet open={sheetOpen} onClose={() => setSheetOpen(false)} defaultDueDate={selectedDay ?? undefined} />
      <MonthDaySheet
        open={Boolean(selectedDay)}
        ymd={selectedDay}
        onClose={() => setSelectedDay(null)}
        onOpenFullDay={(ymd) => navigate(`/hoje?date=${ymd}`)}
      />
    </div>
  );
}
```

- [ ] **Step 2: Verifica o tipo**

Run: `cd _remote/web && npx tsc --noEmit`
Expected: 0 erros. (Se `AgendaFilters` tiver mais chaves obrigatórias, complete `ALL_FILTERS` com elas em `true`. Confirme a prop `defaultDueDate` do `QuickCreateSheet` — é a usada no `Hoje.tsx:833`.)

---

### Task 7: `screens/Hoje.tsx` — ler `?date=` (aditivo)

**Files:**
- Modify: `web/src/screens/Hoje.tsx` (import + a inicialização do `viewDate`, ~linha 234)

**Interfaces:**
- Produces: ao navegar `/hoje?date=YYYY-MM-DD`, o Dia abre já naquele dia (faz o "Ver dia completo" do mês funcionar). Sem `?date=`, comportamento inalterado (abre hoje).

> Única mudança no `Hoje` — aditiva e isolada. Os chevrons e o `isViewingToday` continuam funcionando a partir da data inicial.

- [ ] **Step 1: Adiciona o import do `useSearchParams`**

No bloco de imports do `Hoje.tsx`, adicione:
```tsx
import { useSearchParams } from 'react-router-dom';
```

- [ ] **Step 2: Lê o `?date=` na inicialização do `viewDate`**

Substitua (Hoje.tsx ~linha 234):
```tsx
  const [viewDate, setViewDate] = useState(realToday);
```
por:
```tsx
  const [searchParams] = useSearchParams();
  const [viewDate, setViewDate] = useState(() => {
    const d = searchParams.get('date');
    return d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : realToday;
  });
```
(`realToday` já está declarado logo acima, em `const realToday = todaySP();`.)

- [ ] **Step 3: Verifica o tipo**

Run: `cd _remote/web && npx tsc --noEmit`
Expected: 0 erros.

---

### Task 8: Integração — tabs, rota, shell, nav

**Files:**
- Modify: `web/src/components/AgendaTabs.tsx`
- Modify: `web/src/App.tsx`
- Modify: `web/src/components/AppShell.tsx`
- Modify: `web/src/lib/navItems.ts` (e `web/src/components/BottomNav.tsx` se o item Agenda também estiver lá)
- Test: `web/src/lib/navItems.test.ts`

**Interfaces:**
- Produces: `/mes` acessível no mobile, com o 3º slot "Mês" no segmented control, `AgendaTabs` visível em `/mes`, e o tab "Agenda" da bottom nav ativo em `/mes`.

- [ ] **Step 1: `AgendaTabs` com 3 slots**

Substitua o corpo de `web/src/components/AgendaTabs.tsx` (a partir do `export function`) por:
```tsx
export function AgendaTabs() {
  const location = useLocation();
  const path = location.pathname;
  const activeIdx = path.startsWith('/mes') ? 2 : path.startsWith('/semana') ? 1 : 0;

  const labelCls = (active: boolean) =>
    [
      'relative z-10 flex-1 text-center py-2 text-body-sm font-semibold rounded-md focus-ring',
      'transition-colors duration-200',
      active ? 'text-black' : 'text-fg-muted hover:text-fg',
    ].join(' ');

  return (
    <div className="relative grid grid-cols-3 p-1 rounded-md bg-bg-elevated border border-border">
      <span
        aria-hidden
        className="absolute top-1 bottom-1 rounded-md bg-tom shadow-sm"
        style={{
          left: '0.25rem',
          width: 'calc(33.333% - 0.1667rem)',
          transform: `translateX(${activeIdx * 100}%)`,
          transition: 'transform 400ms cubic-bezier(0.32, 0.72, 0, 1)',
          willChange: 'transform',
        }}
      />
      <NavLink to="/hoje" end className={() => labelCls(activeIdx === 0)}>Dia</NavLink>
      <NavLink to="/semana" className={() => labelCls(activeIdx === 1)}>Semana</NavLink>
      <NavLink to="/mes" className={() => labelCls(activeIdx === 2)}>Mês</NavLink>
    </div>
  );
}
```
(Se no preview o indicador desalinhar levemente, ajuste só o `- 0.1667rem` do `width`.)

- [ ] **Step 2: `AppShell` — incluir `/mes` em `AGENDA_PATHS`**

`web/src/components/AppShell.tsx`, linha 14:
```tsx
const AGENDA_PATHS = ['/hoje', '/semana', '/mes'];
```

- [ ] **Step 3: Rota `/mes` no `App.tsx`**

Em `web/src/App.tsx`: localize a função `SemanaOrDesktopAgenda` e a `<Route path="semana" ...>`. Adicione, espelhando-as:
```tsx
import { Mes } from './screens/Mes';

function MesOrDesktopAgenda() {
  const bp = useBreakpoint();
  if (bp === 'mobile') return <Mes />;
  return <Navigate to="/agenda?view=month" replace />;
}
```
e, ao lado da rota `semana`:
```tsx
<Route path="mes" element={<MesOrDesktopAgenda />} />
```
(Use exatamente a mesma checagem de breakpoint que `SemanaOrDesktopAgenda` usa — copie e troque Semana→Mes e `view=week`→`view=month`. `useBreakpoint` e `Navigate` já estão importados pro `Semana`.)

- [ ] **Step 4: `navItems` — matchPaths do Agenda inclui `/mes` (TDD)**

Abra `web/src/lib/navItems.ts` e ache o item "Agenda" (tem `matchPaths: ['/hoje', '/semana']`). Primeiro atualize o teste:

Em `web/src/lib/navItems.test.ts`, no caso que verifica o matchPaths do Agenda, passe a esperar `/mes` também (ex.: `expect(agenda.matchPaths).toEqual(['/hoje', '/semana', '/mes'])`). Se não houver esse caso, adicione:
```ts
it('Agenda casa /hoje, /semana e /mes', () => {
  const agenda = NAV_ITEMS.find(i => i.label === 'Agenda');
  expect(agenda?.matchPaths).toEqual(['/hoje', '/semana', '/mes']);
});
```
(Use o nome real do export — `NAV_ITEMS`/`navItems` — conforme o arquivo.)

- [ ] **Step 5: Roda o teste e confirma a falha**

Run: `cd _remote/web && npx vitest run src/lib/navItems.test.ts`
Expected: FAIL (matchPaths sem `/mes`).

- [ ] **Step 6: Adiciona `/mes` ao matchPaths**

Em `web/src/lib/navItems.ts`, no item Agenda: `matchPaths: ['/hoje', '/semana', '/mes']`. Se `web/src/components/BottomNav.tsx` tiver uma cópia estática do item Agenda (linha ~19), atualize lá também.

- [ ] **Step 7: Roda o teste e confirma o verde**

Run: `cd _remote/web && npx vitest run src/lib/navItems.test.ts`
Expected: PASS.

---

### Task 9: Validação final

**Files:** nenhum (verificação).

- [ ] **Step 1: Typecheck**

Run: `cd _remote/web && npx tsc --noEmit`
Expected: 0 erros.

- [ ] **Step 2: Build**

Run: `cd _remote/web && npx vite build`
Expected: build OK.

- [ ] **Step 3: Testes**

Run: `cd _remote/web && npx vitest run src/lib/monthChips.test.ts src/lib/navItems.test.ts`
Expected: PASS.

- [ ] **Step 4: Preview a 375px** (preview tools, `localhost:4173`, limpar SW cache)

Confira:
- `/hoje` e `/semana` intactos; o segmented control agora mostra **Dia · Semana · Mês** e o indicador desliza certo.
- `/mes`: grade dom→sáb, hoje em verde, chips coloridos (atrasada vermelho, no prazo verde, feita riscada, compromisso azul), "+N" em dia cheio.
- Tocar um dia → sobe o `MonthDaySheet` com os itens; vazio mostra empty.
- Tocar a tarefa → Detalhe → "Editar" → `EditTaskSheet` (com Recorrência + Lembrete); salvar recorrente → "só esta / esta e as próximas". "..." → Reagendar/Excluir. Checkbox conclui.
- "Ver dia completo" → `/hoje?date=...` abre o dia certo.
- Fechar os sheets desempilha (voltar nível a nível) até o mês.
- Tab "Agenda" da bottom nav fica ativo em `/mes`.

- [ ] **Step 5: Regressão**

- Desktop (1440px): `/agenda?view=month` inalterado; `/mes` redireciona pro desktop.
- `/hoje` sem `?date=` abre hoje normalmente.

---

## Self-Review (autor)

- **Cobertura da spec:** rota/tabs (T8) · grade dom→sáb + hoje + "+N" (T3) · cores semânticas (T1) · dados range da grade (T6) · MonthDaySheet parcial (T5) · DayBoard reuso de editar/reagendar/excluir/recorrência/lembrete (T4) · "ver dia completo" (T5+T7) · sem cards de resumo / calendário puro (T6) · estados vazio (T4) · guardrail Hoje/Semana (só T7 aditivo) · fora de escopo respeitado (sem recorrência de evento, sem category_color, sem hábito-chip). ✔
- **Placeholders:** nenhum — todo passo tem código/comando real. Fetches de banco (T2) seguem a convenção do projeto (sem unit test; validados por `tsc`+preview), explicitado.
- **Consistência de tipos:** `MonthChip`/`ChipTone`/`CHIP_TONE_CLASS` (T1) usados em T3; `fetchTasksForDay` (T2) consumido em T4; `MonthGrid`/`MonthDaySheet` props batem com T6; `Mes` exportado como `Mes` e roteado em T8; `?date=` (T7) consumido pelo `onOpenFullDay` (T6).
- **Empilhamento:** confirmado que `BottomSheet`/`AdaptiveSheet` são `fixed inset-0 z-50` e aninhados empilham por DOM — sem mudança de z-index. Plano B (prop `level`) não foi necessário; fica documentado na spec se o preview mostrar problema.
