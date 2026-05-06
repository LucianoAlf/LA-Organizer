import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ListTodo, CalendarClock } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { supabase, supabaseConfigured } from '../lib/supabase';
import { todaySP } from '../utils/date';
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
import type { Task, TaskContext, CalendarEvent, ActionType } from '../types';
import { ACTION_TYPE_LABELS, ACTION_TYPE_VISUAL } from '../types';

async function fetchTasksToday(collabId: string): Promise<Task[]> {
  const today = todaySP();
  const { data, error } = await supabase
    .from('tasks')
    .select('id, title, status, context, priority, category, action_type, source, due_date, scheduled_date, remind_at, eisenhower_quadrant, project_id, assigned_to, created_by, completed_at, projects(name), assignee:collaborators!tasks_assigned_to_fkey(full_name)')
    .eq('assigned_to', collabId)
    .or(`due_date.eq.${today},and(due_date.lt.${today},status.not.in.(done,cancelled))`)
    .order('remind_at', { ascending: true, nullsFirst: false })
    .order('due_date', { ascending: true })
    .order('eisenhower_quadrant', { ascending: true, nullsFirst: false });
  if (error) throw error;
  return (data ?? []) as unknown as Task[];
}

// Sprint 22.5 — tasks que o collab criou pra outras pessoas (delegações).
async function fetchDelegatedTasks(collabId: string): Promise<Task[]> {
  const today = todaySP();
  const { data, error } = await supabase
    .from('tasks')
    .select('id, title, status, context, priority, category, action_type, source, due_date, scheduled_date, remind_at, eisenhower_quadrant, project_id, assigned_to, created_by, completed_at, projects(name), assignee:collaborators!tasks_assigned_to_fkey(full_name)')
    .eq('created_by', collabId)
    .neq('assigned_to', collabId)
    .or(`due_date.eq.${today},and(due_date.lt.${today},status.not.in.(done,cancelled))`)
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

  const { data: events = [], isLoading: eLoading } = useQuery({
    queryKey: ['events', 'hoje', collaborator?.id, today],
    queryFn: () => collaborator ? fetchEventsForDay(collaborator.id, today) : Promise.resolve([]),
    enabled: Boolean(collaborator?.id && supabaseConfigured),
  });

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
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tasks'] }),
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

  // Sprint 22.5 — totais globais pra subheader (somam tudo: work + personal + events).
  const totalDueToday = tasks.filter(t => t.due_date === today && t.status !== 'done' && t.status !== 'cancelled').length
    + events.filter(e => e.status === 'scheduled').length;
  const totalOverdue = tasks.filter(t => t.due_date && t.due_date < today && t.status !== 'done' && t.status !== 'cancelled').length;

  return (
    <div className="space-y-lg">
      {/* Subheader — quick context line */}
      {!isLoading && (totalDueToday > 0 || totalOverdue > 0) && (
        <p className="text-body-sm text-fg-muted -mt-sm">
          {totalDueToday > 0 && <span><span className="text-fg font-medium">{totalDueToday}</span> pra hoje</span>}
          {totalDueToday > 0 && totalOverdue > 0 && <span className="text-fg-muted"> · </span>}
          {totalOverdue > 0 && <span className="text-danger"><span className="font-medium">{totalOverdue}</span> atrasada{totalOverdue > 1 ? 's' : ''}</span>}
        </p>
      )}

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
                ? 'bg-brand text-white border-brand'
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
                    ? 'bg-brand text-white border-brand'
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

      {/* Tasks block */}
      <section className="surface px-md">
        {todayEvents.length > 0 && (
          <div className="flex items-center gap-2 py-3 border-b border-border text-label uppercase tracking-wide text-fg-muted">
            <ListTodo size={14} /> Tarefas
          </div>
        )}
        {!supabaseConfigured ? (
          <EmptyState
            icon={<ListTodo size={32} />}
            title="Configure Supabase"
            description="Defina VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY no .env e reinicie."
          />
        ) : isLoading ? (
          <div className="py-md"><LoadingState rows={3} /></div>
        ) : tError ? (
          <EmptyState
            title="Não consegui carregar suas tarefas"
            description={(tError as Error).message}
            action={<Button variant="secondary" onClick={() => qc.invalidateQueries({ queryKey: ['tasks'] })}>Tentar de novo</Button>}
          />
        ) : todayList.length === 0 ? (
          hasNothing ? (
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
            <div className="py-3 text-body-sm text-fg-muted">Sem tarefas — só compromissos hoje.</div>
          )
        ) : (
          <>
            {/* Sprint 22.5 — agrupamento visual: Atrasadas → Pra hoje → Concluídas */}
            {overdue.length > 0 && (
              <div>
                <div className="py-2 text-label uppercase tracking-wide text-danger">
                  🔴 Atrasadas ({overdue.length})
                </div>
                {overdue.map(t => (
                  <TaskRow
                    key={t.id}
                    task={t}
                    onToggle={tab === 'delegated' ? undefined : (task) => toggleTask.mutate(task)}
                    readOnly={tab === 'delegated'}
                  />
                ))}
              </div>
            )}
            {dueToday.length > 0 && (
              <div>
                {overdue.length > 0 && (
                  <div className="py-2 text-label uppercase tracking-wide text-fg-muted">
                    Pra hoje ({dueToday.length})
                  </div>
                )}
                {dueToday.map(t => (
                  <TaskRow
                    key={t.id}
                    task={t}
                    onToggle={tab === 'delegated' ? undefined : (task) => toggleTask.mutate(task)}
                    readOnly={tab === 'delegated'}
                  />
                ))}
              </div>
            )}
            {done.length > 0 && (
              <details className="group">
                <summary className="py-2 text-label uppercase tracking-wide text-success cursor-pointer list-none flex items-center gap-2 select-none">
                  <span>✅ Concluídas ({done.length})</span>
                  <span className="text-fg-muted text-body-sm normal-case tracking-normal group-open:hidden">expandir</span>
                  <span className="text-fg-muted text-body-sm normal-case tracking-normal hidden group-open:inline">recolher</span>
                </summary>
                {done.map(t => (
                  <TaskRow
                    key={t.id}
                    task={t}
                    onToggle={tab === 'delegated' ? undefined : (task) => toggleTask.mutate(task)}
                    readOnly={tab === 'delegated'}
                  />
                ))}
              </details>
            )}
          </>
        )}
      </section>

      <Fab onClick={() => setSheetOpen(true)} label="Novo" ariaLabel="Criar novo item" />
      <QuickCreateSheet open={sheetOpen} onClose={() => setSheetOpen(false)} defaultDueDate={today} />
      <EditEventSheet open={Boolean(editingEvent)} event={editingEvent} onClose={() => setEditingEvent(null)} />
    </div>
  );
}
