import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ListTodo, CalendarClock, Check, Flame } from 'lucide-react';
import { DndContext, closestCenter, type DragEndEvent } from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useAuth } from '../contexts/AuthContext';
import { supabase, supabaseConfigured } from '../lib/supabase';
import { todaySP } from '../utils/date';
import { useSortableSensors } from '../lib/sortableSensors';
import { fetchEventsForDay } from '../lib/events';
import { TaskRow } from '../components/TaskRow';
import { EventRow } from '../components/EventRow';
import { StatCard } from '../components/StatCard';
import { Tabs } from '../components/Tabs';
import { LoadingState } from '../components/LoadingState';
import { EmptyState } from '../components/EmptyState';
import { Button } from '../components/Button';
import { Fab } from '../components/Fab';
import { QuickCreateSheet } from '../components/QuickCreateSheet';
import { EditEventSheet } from '../components/EditEventSheet';
import { RescheduleSheet } from '../components/RescheduleSheet';
import type { Task, TaskContext, CalendarEvent, ActionType } from '../types';
import { ACTION_TYPE_LABELS, ACTION_TYPE_VISUAL } from '../types';

// Sprint 22.5 — hábitos privados aparecem na aba Pessoal de Hoje (linha rápida).
type HabitToday = {
  id: string;
  name: string;
  icon: string | null;
  current_streak: number | null;
  done_today: boolean;
  log_id: string | null;
};

async function fetchHabitsToday(collabId: string): Promise<HabitToday[]> {
  const today = todaySP();
  const { data: habits, error } = await supabase
    .from('habits')
    .select('id, name, icon, current_streak')
    .eq('collaborator_id', collabId)
    .eq('is_active', true)
    .order('created_at', { ascending: true });
  if (error) throw error;
  const list = habits ?? [];
  if (list.length === 0) return [];
  const ids = list.map(h => h.id);
  const { data: logs } = await supabase
    .from('habit_logs')
    .select('id, habit_id, is_completed')
    .in('habit_id', ids)
    .eq('log_date', today);
  const logByHabit = new Map<string, { id: string; is_completed: boolean }>();
  for (const l of logs ?? []) logByHabit.set(l.habit_id, { id: l.id, is_completed: l.is_completed });
  return list.map(h => {
    const log = logByHabit.get(h.id);
    return {
      id: h.id,
      name: h.name,
      icon: h.icon,
      current_streak: h.current_streak,
      done_today: Boolean(log?.is_completed),
      log_id: log?.id ?? null,
    };
  });
}

// Sprint 22.7 — exclui 'cancelled' da view de Hoje. Cancelladas só interessam em
// histórico, não no daily focus.
async function fetchTasksToday(collabId: string): Promise<Task[]> {
  const today = todaySP();
  const { data, error } = await supabase
    .from('tasks')
    .select('id, title, status, context, priority, category, action_type, source, due_date, scheduled_date, remind_at, eisenhower_quadrant, sort_position, project_id, assigned_to, created_by, completed_at, projects(name, category), assignee:collaborators!tasks_assigned_to_fkey(full_name)')
    .eq('assigned_to', collabId)
    .neq('status', 'cancelled')
    .or(`due_date.eq.${today},and(due_date.lt.${today},status.not.in.(done,cancelled))`)
    // Sprint 22.29 — sort_position primeiro pra DnD manual mandar; data como tiebreak.
    .order('sort_position', { ascending: true, nullsFirst: false })
    .order('remind_at', { ascending: true, nullsFirst: false })
    .order('due_date', { ascending: true })
    .order('eisenhower_quadrant', { ascending: true, nullsFirst: false });
  if (error) throw error;
  return (data ?? []) as unknown as Task[];
}

async function fetchDelegatedTasks(collabId: string): Promise<Task[]> {
  const today = todaySP();
  const { data, error } = await supabase
    .from('tasks')
    .select('id, title, status, context, priority, category, action_type, source, due_date, scheduled_date, remind_at, eisenhower_quadrant, sort_position, project_id, assigned_to, created_by, completed_at, projects(name, category), assignee:collaborators!tasks_assigned_to_fkey(full_name)')
    .eq('created_by', collabId)
    .neq('assigned_to', collabId)
    .neq('status', 'cancelled')
    .or(`due_date.eq.${today},and(due_date.lt.${today},status.not.in.(done,cancelled))`)
    .order('sort_position', { ascending: true, nullsFirst: false })
    .order('due_date', { ascending: true });
  if (error) throw error;
  return (data ?? []) as unknown as Task[];
}

type TabKey = TaskContext | 'delegated';

export function Hoje() {
  const { collaborator } = useAuth();
  const qc = useQueryClient();
  const [tab, setTab] = useState<TabKey>('work');
  // Sprint 12 Bloco D: filtro opcional por categoria de execução. null = todas.
  const [actionFilter, setActionFilter] = useState<ActionType | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editingEvent, setEditingEvent] = useState<CalendarEvent | null>(null);
  const [reschedulingTask, setReschedulingTask] = useState<Task | null>(null);
  const [doneOpen, setDoneOpen] = useState(false);

  const today = todaySP();

  const { data: tasks = [], isLoading: tLoading, error: tError } = useQuery({
    queryKey: ['tasks', 'hoje', collaborator?.id],
    queryFn: () => collaborator ? fetchTasksToday(collaborator.id) : Promise.resolve([]),
    enabled: Boolean(collaborator?.id && supabaseConfigured),
  });

  // Sprint 22.5 — delegadas (criadas pra outros).
  const { data: delegated = [], isLoading: dLoading } = useQuery({
    queryKey: ['tasks', 'delegated', collaborator?.id],
    queryFn: () => collaborator ? fetchDelegatedTasks(collaborator.id) : Promise.resolve([]),
    enabled: Boolean(collaborator?.id && supabaseConfigured),
  });

  // Sprint 22.5 — hábitos do dia (aba Pessoal).
  const { data: habits = [] } = useQuery({
    queryKey: ['habits', 'hoje', collaborator?.id],
    queryFn: () => collaborator ? fetchHabitsToday(collaborator.id) : Promise.resolve([] as HabitToday[]),
    enabled: Boolean(collaborator?.id && supabaseConfigured),
  });

  const toggleHabit = useMutation({
    mutationFn: async (h: HabitToday) => {
      const newDone = !h.done_today;
      const todayDate = todaySP();
      if (h.log_id) {
        const { error } = await supabase
          .from('habit_logs')
          .update({ is_completed: newDone, completed_at: newDone ? new Date().toISOString() : null })
          .eq('id', h.log_id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('habit_logs')
          .insert({
            habit_id: h.id,
            collaborator_id: collaborator!.id,
            log_date: todayDate,
            is_completed: newDone,
            completed_at: newDone ? new Date().toISOString() : null,
          });
        if (error) throw error;
      }
    },
    onMutate: async (h) => {
      await qc.cancelQueries({ queryKey: ['habits', 'hoje', collaborator?.id] });
      const prev = qc.getQueryData<HabitToday[]>(['habits', 'hoje', collaborator?.id]);
      qc.setQueryData<HabitToday[]>(['habits', 'hoje', collaborator?.id], (old) =>
        (old ?? []).map(x => x.id === h.id ? { ...x, done_today: !x.done_today } : x)
      );
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(['habits', 'hoje', collaborator?.id], ctx.prev);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['habits'] });
    },
  });

  const { data: events = [], isLoading: eLoading } = useQuery({
    queryKey: ['events', 'hoje', collaborator?.id, today],
    queryFn: () => collaborator ? fetchEventsForDay(collaborator.id, today) : Promise.resolve([]),
    enabled: Boolean(collaborator?.id && supabaseConfigured),
  });

  // Sprint 22.25 (audit Hoje, Mega-fatia A) — toggle otimista (paridade com
  // toggleHabit e ProjetoDetalhe). Elimina flicker visivel ao marcar/desmarcar.
  const toggleTask = useMutation({
    mutationFn: async (task: Task) => {
      const isDone = task.status === 'done';
      const { error } = await supabase
        .from('tasks')
        .update(isDone
          ? { status: 'pending', completed_at: null, completed_by: null }
          : { status: 'done', completed_at: new Date().toISOString(), completed_by: collaborator?.id })
        .eq('id', task.id);
      if (error) throw error;
    },
    onMutate: async (task) => {
      const keyHoje = ['tasks', 'hoje', collaborator?.id] as const;
      const keyDelegated = ['tasks', 'delegated', collaborator?.id] as const;
      await qc.cancelQueries({ queryKey: ['tasks'] });
      const prevHoje = qc.getQueryData<Task[]>(keyHoje);
      const prevDelegated = qc.getQueryData<Task[]>(keyDelegated);
      const flip = (t: Task): Task => t.id === task.id
        ? ({ ...t, status: t.status === 'done' ? 'pending' : 'done', completed_at: t.status === 'done' ? null : new Date().toISOString() } as Task)
        : t;
      qc.setQueryData<Task[]>(keyHoje, (old) => (old ?? []).map(flip));
      qc.setQueryData<Task[]>(keyDelegated, (old) => (old ?? []).map(flip));
      return { prevHoje, prevDelegated, keyHoje, keyDelegated };
    },
    onError: (_e, _v, ctx) => {
      if (!ctx) return;
      if (ctx.prevHoje) qc.setQueryData(ctx.keyHoje, ctx.prevHoje);
      if (ctx.prevDelegated) qc.setQueryData(ctx.keyDelegated, ctx.prevDelegated);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['tasks'] }),
  });

  // Sprint 22.29 — DnD reorder otimista. User arrasta dentro de um grupo
  // (atrasadas/pra hoje) e atualiza sort_position. Query primaria ja ordena
  // por sort_position, entao o feedback eh instantaneo.
  const reorderTasks = useMutation({
    mutationFn: async (orderedIds: string[]) => {
      await Promise.all(
        orderedIds.map((tid, idx) =>
          supabase.from('tasks').update({ sort_position: idx }).eq('id', tid).then(({ error }) => {
            if (error) throw error;
          }),
        ),
      );
    },
    onMutate: async (orderedIds) => {
      const keyHoje = ['tasks', 'hoje', collaborator?.id] as const;
      await qc.cancelQueries({ queryKey: keyHoje });
      const prev = qc.getQueryData<Task[]>(keyHoje);
      qc.setQueryData<Task[]>(keyHoje, (old) => {
        if (!old) return old;
        const positionMap = new Map(orderedIds.map((id, idx) => [id, idx]));
        return old.map(t => {
          const newPos = positionMap.get(t.id);
          if (newPos == null) return t;
          return { ...t, sort_position: newPos } as Task;
        }).sort((a, b) => {
          const pa = (a as Task & { sort_position?: number | null }).sort_position ?? 999;
          const pb = (b as Task & { sort_position?: number | null }).sort_position ?? 999;
          return pa - pb;
        });
      });
      return { prev, keyHoje };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(ctx.keyHoje, ctx.prev);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['tasks'] }),
  });

  // Sprint 22.28 — delete inline na Hoje (otimista). RowMenu cuida do confirm.
  const deleteTask = useMutation({
    mutationFn: async (task: Task) => {
      const { error } = await supabase.from('tasks').delete().eq('id', task.id);
      if (error) throw error;
    },
    onMutate: async (task) => {
      const keyHoje = ['tasks', 'hoje', collaborator?.id] as const;
      const keyDelegated = ['tasks', 'delegated', collaborator?.id] as const;
      await qc.cancelQueries({ queryKey: ['tasks'] });
      const prevHoje = qc.getQueryData<Task[]>(keyHoje);
      const prevDelegated = qc.getQueryData<Task[]>(keyDelegated);
      qc.setQueryData<Task[]>(keyHoje, (old) => (old ?? []).filter(t => t.id !== task.id));
      qc.setQueryData<Task[]>(keyDelegated, (old) => (old ?? []).filter(t => t.id !== task.id));
      return { prevHoje, prevDelegated, keyHoje, keyDelegated };
    },
    onError: (_e, _v, ctx) => {
      if (!ctx) return;
      if (ctx.prevHoje) qc.setQueryData(ctx.keyHoje, ctx.prevHoje);
      if (ctx.prevDelegated) qc.setQueryData(ctx.keyDelegated, ctx.prevDelegated);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['tasks'] }),
  });

  const work = tasks.filter(t => t.context === 'work');
  const personal = tasks.filter(t => t.context === 'personal');
  const tabList: Task[] = tab === 'work' ? work : tab === 'personal' ? personal : delegated;
  // Sprint 12 Bloco D: chips só aparecem para categorias presentes na aba atual.
  const presentActionTypes = Array.from(
    new Set(tabList.map(t => t.action_type).filter((x): x is ActionType => Boolean(x))),
  );
  const todayList = actionFilter
    ? tabList.filter(t => t.action_type === actionFilter)
    : tabList;
  // Eventos só nas abas work/personal (delegadas é só task).
  const todayEvents = tab === 'delegated' ? [] : events.filter(e => e.context === tab);

  const dueToday = todayList.filter(t => t.due_date === today && t.status !== 'done' && t.status !== 'cancelled');
  const overdue = todayList.filter(t => t.status === 'overdue' || (t.due_date && t.due_date < today && t.status !== 'done' && t.status !== 'cancelled'));
  const done = todayList.filter(t => t.status === 'done');

  const isLoading = tLoading || eLoading || dLoading;
  const hasNothing = todayList.length === 0 && todayEvents.length === 0;

  return (
    <div className="space-y-lg">
      {/* Stats */}
      <div className="grid grid-cols-3 gap-sm">
        <StatCard label="Pra hoje" value={dueToday.length + todayEvents.filter(e => e.status === 'scheduled').length} tone="brand" />
        <StatCard label="Atrasadas" value={overdue.length} tone={overdue.length ? 'danger' : 'neutral'} />
        <StatCard label="Concluídas" value={done.length} tone={done.length ? 'success' : 'neutral'} />
      </div>

      {/* Tabs */}
      <Tabs
        tabs={[
          { id: 'work', label: 'Trabalho', badge: work.length + events.filter(e => e.context === 'work').length },
          { id: 'personal', label: 'Pessoal', badge: personal.length + events.filter(e => e.context === 'personal').length },
          { id: 'delegated', label: 'Delegadas', badge: delegated.length },
        ]}
        active={tab}
        onChange={(t) => { setTab(t as TabKey); setActionFilter(null); }}
      />

      {/* Sprint 12 Bloco D: filtro de chips por categoria de execução.
          Aparece só se TOM já classificou ≥1 task da aba atual. */}
      {presentActionTypes.length > 0 && (
        <div className="flex flex-wrap gap-2 -mt-sm">
          <button
            type="button"
            onClick={() => setActionFilter(null)}
            className={[
              'px-3 py-1 rounded-full text-body-sm border transition-colors focus-ring',
              actionFilter === null
                ? 'bg-tom text-white border-tom'
                : 'bg-bg-elevated text-fg-muted border-border hover:text-fg',
            ].join(' ')}
          >
            Todas
          </button>
          {presentActionTypes.map(at => {
            const visual = ACTION_TYPE_VISUAL[at];
            const active = actionFilter === at;
            return (
              <button
                key={at}
                type="button"
                onClick={() => setActionFilter(active ? null : at)}
                className={[
                  'px-3 py-1 rounded-full text-body-sm border transition-colors focus-ring',
                  active
                    ? 'bg-tom text-white border-tom'
                    : 'bg-bg-elevated text-fg-muted border-border hover:text-fg',
                ].join(' ')}
                aria-pressed={active}
              >
                <span className="mr-1" aria-hidden>{visual.icon}</span>
                {ACTION_TYPE_LABELS[at]}
              </button>
            );
          })}
        </div>
      )}

      {/* Sprint 22.5 — Hábitos só na aba Pessoal */}
      {tab === 'personal' && habits.length > 0 && (
        <section className="surface px-md">
          <div className="flex items-center gap-2 py-3 border-b border-border text-label uppercase tracking-wide text-fg-muted">
            <Flame size={14} className="text-warning" /> Hábitos hoje
          </div>
          <ul className="divide-y divide-border">
            {habits.map(h => (
              <li key={h.id}>
                <button
                  type="button"
                  onClick={() => toggleHabit.mutate(h)}
                  disabled={toggleHabit.isPending}
                  className="w-full flex items-center gap-md py-3 hover:bg-bg-elevated focus-ring text-left transition-colors"
                >
                  <span
                    className={[
                      'h-6 w-6 shrink-0 rounded-full border grid place-items-center transition-colors',
                      h.done_today
                        ? 'bg-success border-success text-white'
                        : 'border-border text-transparent hover:border-tom hover:text-tom',
                    ].join(' ')}
                    aria-label={h.done_today ? 'concluído hoje' : 'marcar feito'}
                  >
                    <Check size={14} strokeWidth={3} />
                  </span>
                  <span className={['flex-1 min-w-0 text-body-md', h.done_today ? 'line-through text-fg-muted' : ''].join(' ')}>
                    {h.icon ? `${h.icon} ` : ''}{h.name}
                  </span>
                  {(h.current_streak ?? 0) > 0 && (
                    <span className="shrink-0 text-body-sm text-fg-muted tabular-nums">
                      🔥 {h.current_streak}
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Events block (with time) */}
      {todayEvents.length > 0 && (
        <section className="surface px-md">
          <div className="flex items-center gap-2 py-3 border-b border-border text-label uppercase tracking-wide text-fg-muted">
            <CalendarClock size={14} /> Compromissos
          </div>
          {todayEvents.map(e => (
            <EventRow key={e.id} event={e} onClick={setEditingEvent} />
          ))}
        </section>
      )}

      {/* Sprint 22.15 — Tasks em múltiplos cards (Atrasadas, Pra hoje, Concluídas)
          com gap entre eles, mesma linguagem visual da Semana. */}
      {!supabaseConfigured ? (
        <section className="surface p-md">
          <EmptyState
            icon={<ListTodo size={32} />}
            title="Configure Supabase"
            description="Defina VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY no .env e reinicie."
          />
        </section>
      ) : isLoading ? (
        <section className="surface p-md">
          <LoadingState rows={3} />
        </section>
      ) : tError ? (
        <section className="surface p-md">
          <EmptyState
            icon={<ListTodo size={32} />}
            title="Deu ruim ao carregar"
            description="Não consegui buscar suas tarefas. Pode ser conexão instável. Tenta de novo."
            action={<Button variant="secondary" onClick={() => qc.invalidateQueries({ queryKey: ['tasks'] })}>Tentar de novo</Button>}
          />
        </section>
      ) : todayList.length === 0 ? (
        <section className="surface p-md">
          {hasNothing ? (
            <EmptyState
              icon={<ListTodo size={32} />}
              title={tab === 'delegated' ? 'Sem delegações pra hoje' : 'Tá leve hoje.'}
              description={
                tab === 'delegated'
                  ? 'Nada que você pediu pra outro fica vencendo hoje.'
                  : tab === 'work'
                    ? 'Manda um zap pro TOM no WhatsApp tipo "anota: ligar pro contador hoje" pra criar de lá. Ou usa o + abaixo.'
                    : 'Sem nada pessoal pra hoje. Aproveita.'
              }
            />
          ) : (
            <EmptyState
              icon={<ListTodo size={32} />}
              title="Sem tarefas"
              description="Só compromissos hoje. Foco no que tem horário."
            />
          )}
        </section>
      ) : (
        <div className="space-y-lg">
          {overdue.length > 0 && (
            <section className="space-y-sm">
              <div className="px-1 text-label uppercase tracking-wide text-danger">
                Atrasadas ({overdue.length})
              </div>
              <SortableTaskList
                tasks={overdue}
                tabIsDelegated={tab === 'delegated'}
                onToggle={(task) => toggleTask.mutate(task)}
                onReschedule={setReschedulingTask}
                onDelete={(task) => deleteTask.mutate(task)}
                onReorder={(ids) => reorderTasks.mutate(ids)}
              />
            </section>
          )}
          {dueToday.length > 0 && (
            <section className="space-y-sm">
              <div className="px-1 text-label uppercase tracking-wide text-fg-muted">
                Pra hoje ({dueToday.length})
              </div>
              <SortableTaskList
                tasks={dueToday}
                tabIsDelegated={tab === 'delegated'}
                onToggle={(task) => toggleTask.mutate(task)}
                onReschedule={setReschedulingTask}
                onDelete={(task) => deleteTask.mutate(task)}
                onReorder={(ids) => reorderTasks.mutate(ids)}
              />
            </section>
          )}
          {done.length > 0 && (
            <section className="space-y-sm">
              <button
                type="button"
                onClick={() => setDoneOpen(o => !o)}
                className="w-full px-1 flex items-center gap-2 text-label uppercase tracking-wide text-success focus-ring rounded-sm select-none cursor-pointer"
                aria-expanded={doneOpen}
              >
                <span>Concluídas ({done.length})</span>
                <span className="text-fg-muted text-body-sm normal-case tracking-normal">
                  {doneOpen ? 'recolher' : 'expandir'}
                </span>
              </button>
              {doneOpen && done.map(t => (
                <TaskRow
                  key={t.id}
                  task={t}
                  onToggle={tab === 'delegated' ? undefined : (task) => toggleTask.mutate(task)}
                  readOnly={tab === 'delegated'}
                />
              ))}
            </section>
          )}
        </div>
      )}

      {/* Sprint 22.16 — legenda Eisenhower como dots (igual ao display inline). */}
      {todayList.some(t => t.eisenhower_quadrant) && (
        <p className="text-body-sm text-fg-muted flex items-center gap-3 flex-wrap pt-sm">
          <span className="flex items-center gap-1.5"><span className="inline-block h-1.5 w-1.5 rounded-full bg-danger" /> urgente + importante</span>
          <span className="flex items-center gap-1.5"><span className="inline-block h-1.5 w-1.5 rounded-full bg-warning" /> importante</span>
          <span className="flex items-center gap-1.5"><span className="inline-block h-1.5 w-1.5 rounded-full bg-info" /> urgente</span>
        </p>
      )}

      <Fab onClick={() => setSheetOpen(true)} label="Novo" ariaLabel="Criar novo item" />
      <QuickCreateSheet open={sheetOpen} onClose={() => setSheetOpen(false)} defaultDueDate={today} />
      <EditEventSheet open={Boolean(editingEvent)} event={editingEvent} onClose={() => setEditingEvent(null)} />
      <RescheduleSheet open={Boolean(reschedulingTask)} task={reschedulingTask} onClose={() => setReschedulingTask(null)} />
    </div>
  );
}

// Sprint 22.29 — Wrapper DnD pra grupos da Hoje (overdue / dueToday). Cada grupo
// tem seu proprio DndContext. Reorder so DENTRO do grupo (nao move task entre).
function SortableTaskList({
  tasks,
  tabIsDelegated,
  onToggle,
  onReschedule,
  onDelete,
  onReorder,
}: {
  tasks: Task[];
  tabIsDelegated: boolean;
  onToggle: (task: Task) => void;
  onReschedule: (task: Task) => void;
  onDelete: (task: Task) => void;
  onReorder: (orderedIds: string[]) => void;
}) {
  const sensors = useSortableSensors();
  const ids = tasks.map(t => t.id);

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = ids.indexOf(String(active.id));
    const newIndex = ids.indexOf(String(over.id));
    if (oldIndex < 0 || newIndex < 0) return;
    onReorder(arrayMove(ids, oldIndex, newIndex));
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        <div className="space-y-sm">
          {tasks.map(t => (
            <SortableTaskItem
              key={t.id}
              task={t}
              tabIsDelegated={tabIsDelegated}
              onToggle={onToggle}
              onReschedule={onReschedule}
              onDelete={onDelete}
            />
          ))}
        </div>
      </SortableContext>
    </DndContext>
  );
}

function SortableTaskItem({
  task,
  tabIsDelegated,
  onToggle,
  onReschedule,
  onDelete,
}: {
  task: Task;
  tabIsDelegated: boolean;
  onToggle: (task: Task) => void;
  onReschedule: (task: Task) => void;
  onDelete: (task: Task) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: task.id,
  });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
  };
  // Sprint 22.29 (Bucket 4) — em delegadas, sem checkbox (so o assignee marca
  // feita) mas COM reagendar/excluir (created_by mexe).
  return (
    <TaskRow
      task={task}
      onToggle={tabIsDelegated ? undefined : onToggle}
      readOnly={tabIsDelegated}
      onReschedule={onReschedule}
      onDelete={onDelete}
      sortableRef={setNodeRef}
      sortableStyle={style}
      sortableAttributes={attributes}
      sortableListeners={listeners}
      isDragging={isDragging}
    />
  );
}
