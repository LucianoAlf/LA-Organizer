import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { CalendarDays } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { supabase, supabaseConfigured } from '../lib/supabase';
import { todaySP, weekDaysMonSat, dowShort, brShort } from '../utils/date';
import { fetchEventsForRange, formatEventTimeRange, eventLocalYmd } from '../lib/events';
import { LoadingState } from '../components/LoadingState';
import { EmptyState } from '../components/EmptyState';
import { EmptyDay } from '../components/EmptyDay';
import { CategoryTag } from '../components/CategoryTag';
import { TaskCheckbox } from '../components/TaskCheckbox';
import { Fab } from '../components/Fab';
import { QuickCreateSheet } from '../components/QuickCreateSheet';
import { RescheduleSheet } from '../components/RescheduleSheet';
import { EditEventSheet } from '../components/EditEventSheet';
import { Tabs } from '../components/Tabs';
import { DateNavHeader } from '../components/DateNavHeader';
import type { Task, CalendarEvent, Project, TaskContext } from '../types';

// Sprint 22.11 — Semana refatorada: cards individuais por dia, inclui sábado,
// tags de categoria do projeto, empty state limpo. Hoje destaca por borda olive sutil.

type WeekTask = Task & {
  projects?: { name: string; category?: Project['category'] } | null;
  assignee?: { id: string; full_name: string } | null;
};

async function fetchWeekTasks(collabId: string, start: string, end: string): Promise<WeekTask[]> {
  // Sprint 22.34m — Semana inclui delegadas (criadas por mim com assignee !== eu).
  // OR no Supabase: tasks atribuídas a mim OU criadas por mim e atribuídas a outro.
  const { data, error } = await supabase
    .from('tasks')
    .select('id, title, status, context, priority, category, due_date, scheduled_date, remind_at, eisenhower_quadrant, project_id, assigned_to, created_by, projects(name, category), assignee:collaborators!tasks_assigned_to_fkey(id, full_name)')
    .or(`assigned_to.eq.${collabId},and(created_by.eq.${collabId},assigned_to.neq.${collabId})`)
    .neq('status', 'cancelled')
    .gte('due_date', start)
    .lte('due_date', end)
    .order('remind_at', { ascending: true, nullsFirst: false })
    .order('due_date', { ascending: true })
    .order('eisenhower_quadrant', { ascending: true, nullsFirst: false });
  if (error) throw error;
  return (data ?? []) as unknown as WeekTask[];
}

// Sprint 22 Phase A — palette + checkbox + empty day migrados (docs/design-system.md).

const QUADRANT_DOT: Record<string, string> = {
  '1': 'bg-danger',
  '2': 'bg-warning',
  '3': 'bg-info',
};

function dayCounts(tasks: WeekTask[], events: CalendarEvent[], today: string) {
  const activeEvents = events.filter(e => e.status !== 'cancelled');
  const total = tasks.length + activeEvents.length;
  const done = tasks.filter(t => t.status === 'done').length + activeEvents.filter(e => e.status === 'done').length;
  const overdue = tasks.filter(t => t.status === 'overdue' || (t.due_date && t.due_date < today && t.status !== 'done')).length;
  return { total, done, overdue };
}

async function toggleTaskStatus(task: WeekTask): Promise<void> {
  const next = task.status === 'done' ? 'pending' : 'done';
  const { error } = await supabase
    .from('tasks')
    .update({ status: next, completed_at: next === 'done' ? new Date().toISOString() : null })
    .eq('id', task.id);
  if (error) throw error;
}

// Sprint 22.34c — toggle done em eventos da Semana, espelhando Hoje.
async function toggleEventStatus(event: CalendarEvent): Promise<void> {
  const next = event.status === 'done' ? 'scheduled' : 'done';
  const { data, error } = await supabase.from('events').update({ status: next }).eq('id', event.id).select('id');
  if (error) throw error;
  if (!data || data.length === 0) throw new Error('Sem permissão para alterar este compromisso.');
}

export function Semana() {
  const { collaborator } = useAuth();
  const qc = useQueryClient();
  const today = todaySP();
  // Sprint 22.49 — viewYmd navegavel: chevrons (-7/+7 dias) + date picker.
  const [viewYmd, setViewYmd] = useState(today);
  const days = useMemo(() => weekDaysMonSat(viewYmd), [viewYmd]);
  const start = days[0];
  const end = days[days.length - 1];
  const isCurrentWeek = days.includes(today);
  const [createOpen, setCreateOpen] = useState(false);
  const [rescheduleTask, setRescheduleTask] = useState<Task | null>(null);
  const [editingEvent, setEditingEvent] = useState<CalendarEvent | null>(null);
  // Sprint 22.34m — tabs Trabalho/Pessoal/Delegadas espelhando Hoje.
  type SemanaTab = TaskContext | 'delegated';
  const [tab, setTab] = useState<SemanaTab>('work');

  const { data: tasks = [], isLoading: tLoading, error } = useQuery({
    queryKey: ['tasks', 'semana', collaborator?.id, start, end],
    queryFn: () => collaborator ? fetchWeekTasks(collaborator.id, start, end) : Promise.resolve([]),
    enabled: Boolean(collaborator?.id && supabaseConfigured),
  });

  const { data: events = [], isLoading: eLoading } = useQuery({
    queryKey: ['events', 'semana', collaborator?.id, start, end],
    queryFn: () => collaborator ? fetchEventsForRange(collaborator.id, start, end) : Promise.resolve([]),
    enabled: Boolean(collaborator?.id && supabaseConfigured),
  });

  // Sprint 22.34m — filtro por aba: work/personal usa context+assigned_to=me;
  // delegated mostra tasks criadas por mim com assignee !== eu.
  const taskMatchesTab = (t: WeekTask): boolean => {
    if (!collaborator) return false;
    if (tab === 'delegated') {
      return t.created_by === collaborator.id && t.assigned_to !== collaborator.id;
    }
    return t.context === tab && t.assigned_to === collaborator.id;
  };

  const tasksByDay = useMemo(() => {
    const map = new Map<string, WeekTask[]>();
    for (const d of days) map.set(d, []);
    for (const t of tasks) {
      if (!taskMatchesTab(t)) continue;
      if (t.due_date && map.has(t.due_date)) map.get(t.due_date)!.push(t);
    }
    return map;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tasks, days, tab, collaborator?.id]);

  const eventsByDay = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    for (const d of days) map.set(d, []);
    // Delegadas não tem events.
    if (tab === 'delegated') return map;
    for (const e of events) {
      if (e.context !== tab) continue;
      const ymd = eventLocalYmd(e.start_at);
      if (map.has(ymd)) map.get(ymd)!.push(e);
    }
    return map;
  }, [events, days, tab]);

  const tabTasks = tasks.filter(taskMatchesTab);
  const tabEvents = tab === 'delegated' ? [] : events.filter(e => e.context === tab && e.status !== 'cancelled');
  const totalWeek = tabTasks.length + tabEvents.length;
  const doneWeek = tabTasks.filter(t => t.status === 'done').length + tabEvents.filter(e => e.status === 'done').length;
  const pct = totalWeek ? Math.round((doneWeek / totalWeek) * 100) : 0;
  const isLoading = tLoading || eLoading;

  const toggleTask = useMutation({
    mutationFn: toggleTaskStatus,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tasks'] });
    },
  });

  const toggleEvent = useMutation({
    mutationFn: toggleEventStatus,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['events'] });
    },
  });

  return (
    <div className="space-y-md">
      {/* Sprint 22.49 — navegacao por semana (-7/+7 dias). */}
      <div className="surface px-md py-2">
        <DateNavHeader
          value={viewYmd}
          onChange={setViewYmd}
          step={7}
          label={`Semana ${brShort(start)} – ${brShort(end)}`}
          today={today}
          todayLabel="Esta semana"
        />
      </div>

      <header className="space-y-2">
        <div className="flex items-baseline justify-between gap-md">
          <div>
            <h2 className="text-section-title">{isCurrentWeek ? 'Progresso da semana' : 'Semana selecionada'}</h2>
            <p className="text-body-sm text-fg-muted mt-0.5">
              <span className="tabular-nums">{brShort(start)}</span>
              <span className="text-fg-muted"> – </span>
              <span className="tabular-nums">{brShort(end)}</span>
              <span className="text-fg-muted"> · seg a sáb</span>
            </p>
          </div>
          <div className="text-right">
            <div className="text-card-title tabular-nums">
              <span className={pct >= 70 ? 'text-success' : pct >= 40 ? 'text-warning' : 'text-fg'}>
                {doneWeek}
              </span>
              <span className="text-fg-muted">/{totalWeek}</span>
            </div>
          </div>
        </div>
        <div className="h-1 w-full bg-bg-elevated rounded-full overflow-hidden">
          <div className="h-full bg-tom transition-[width]" style={{ width: `${pct}%` }} />
        </div>
      </header>

      {/* Sprint 22.34f — Tabs Trabalho/Pessoal alinhadas com Hoje. */}
      <Tabs
        tabs={[
          { id: 'work', label: 'Trabalho' },
          { id: 'personal', label: 'Pessoal' },
          { id: 'delegated', label: 'Delegadas' },
        ]}
        active={tab}
        onChange={(t) => setTab(t as SemanaTab)}
      />

      {!supabaseConfigured ? (
        <EmptyState icon={<CalendarDays size={32} />} title="Configure Supabase" description="Defina VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY." />
      ) : isLoading ? (
        <LoadingState rows={3} />
      ) : error ? (
        <EmptyState title="Erro" description={(error as Error).message} />
      ) : (
        // Fase D2 — desktop renderiza dias em grid 3 colunas (2 linhas x 3 dias
        // para 6 dias seg-sab). Mobile mantem stack vertical.
        <div className="space-y-sm lg:grid lg:grid-cols-3 lg:gap-3 lg:space-y-0">
          {days.map(d => {
            const dayTasks = tasksByDay.get(d) ?? [];
            const dayEvents = eventsByDay.get(d) ?? [];
            const isToday = d === today;
            const isPast = d < today;
            const { total, done, overdue } = dayCounts(dayTasks, dayEvents, today);
            const isEmpty = dayEvents.length === 0 && dayTasks.length === 0;

            return (
              <section
                key={d}
                aria-label={`${dowShort(d)} ${brShort(d)}`}
                className={[
                  'surface p-md',
                  isToday ? 'border-tom/40 bg-tom/5' : '',
                ].join(' ')}
              >
                <div className="flex items-baseline justify-between gap-md">
                  <div className="flex items-baseline gap-2">
                    <span className={['text-label uppercase tracking-wide', isToday ? 'text-tom' : isPast ? 'text-fg-muted' : 'text-fg-secondary'].join(' ')}>
                      {dowShort(d)}
                    </span>
                    <span className={['text-card-title tabular-nums', isPast && !isToday ? 'text-fg-muted' : ''].join(' ')}>
                      {brShort(d)}
                    </span>
                    {isToday && (
                      <span className="inline-block text-label uppercase tracking-wide bg-tom text-black rounded-sm px-1.5 py-0.5">
                        hoje
                      </span>
                    )}
                  </div>
                  <div className="text-body-sm tabular-nums">
                    {total === 0 ? (
                      <span className="text-fg-muted">—</span>
                    ) : (
                      <>
                        <span className={done === total ? 'text-success' : ''}>{done}</span>
                        <span className="text-fg-muted">/{total}</span>
                        {overdue > 0 && <span className="ml-2 text-danger">⚠ {overdue}</span>}
                      </>
                    )}
                  </div>
                </div>

                {isEmpty ? (
                  <EmptyDay />
                ) : (
                  <div className="mt-3 space-y-2">
                    {dayEvents.length > 0 && (
                      <ul className="space-y-2">
                        {dayEvents.map(e => {
                          const range = formatEventTimeRange(e.start_at, e.end_at);
                          const cancelled = e.status === 'cancelled';
                          const isDone = e.status === 'done';
                          const qk = e.eisenhower_quadrant ? String(e.eisenhower_quadrant) : null;
                          const qcCls = qk && QUADRANT_DOT[qk] ? QUADRANT_DOT[qk] : null;
                          return (
                            <li key={e.id} className="flex items-start gap-2 -mx-1 px-1 py-0.5">
                              <TaskCheckbox
                                done={isDone}
                                overdue={false}
                                size="sm"
                                disabled={cancelled || toggleEvent.isPending}
                                onClick={() => !cancelled && toggleEvent.mutate(e)}
                              />
                              <button
                                type="button"
                                onClick={() => setEditingEvent(e)}
                                className={[
                                  'flex-1 min-w-0 text-left rounded-sm hover:bg-bg-elevated px-1 -mx-1 focus-ring',
                                  cancelled ? 'line-through text-fg-muted' : isDone ? 'line-through text-fg-muted' : '',
                                ].join(' ')}
                                title="Editar compromisso"
                              >
                                <div className="text-body-sm flex items-baseline gap-2">
                                  {qcCls && (
                                    <span aria-hidden title={`Q${qk}`} className={['inline-block h-1.5 w-1.5 rounded-full align-middle shrink-0', qcCls].join(' ')} />
                                  )}
                                  <span className="text-fg font-semibold tabular-nums shrink-0">{range.split('–')[0]}</span>
                                  {(e.event_reminders ?? []).some(r => !r.sent_at) && (
                                    <span className="shrink-0 text-[10px] opacity-60" aria-label="tem lembrete">🔔</span>
                                  )}
                                  <span className="truncate text-fg-secondary">{e.title}</span>
                                </div>
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    )}

                    {dayTasks.length > 0 && (
                      <ul className="space-y-2">
                        {dayTasks.map(t => {
                          const isDone = t.status === 'done';
                          const isCancelled = t.status === 'cancelled';
                          const isOverdue = t.status === 'overdue' || (!isDone && !isCancelled && t.due_date && t.due_date < today);
                          const qk = t.eisenhower_quadrant ? String(t.eisenhower_quadrant) : null;
                          const qcCls = qk && QUADRANT_DOT[qk] ? QUADRANT_DOT[qk] : null;
                          return (
                            <li key={t.id} className="flex items-start gap-2 -mx-1 px-1 py-0.5">
                              <TaskCheckbox
                                done={isDone}
                                overdue={Boolean(isOverdue)}
                                size="sm"
                                disabled={isCancelled || toggleTask.isPending}
                                onClick={() => !isCancelled && toggleTask.mutate(t)}
                              />
                              {/* Corpo: clica pra reagendar. */}
                              {!isDone && !isCancelled ? (
                                <button
                                  type="button"
                                  onClick={() => setRescheduleTask(t)}
                                  className="flex-1 min-w-0 text-left rounded-sm hover:bg-bg-elevated px-1 -mx-1 focus-ring"
                                  title="Reagendar"
                                >
                                  <div className="text-body-sm text-fg">
                                    {qcCls && (
                                      <span aria-hidden title={`Q${qk}`} className={['inline-block h-1.5 w-1.5 rounded-full mr-1.5 align-middle', qcCls].join(' ')} />
                                    )}
                                    {t.title}
                                  </div>
                                  <div className="mt-1">
                                    <CategoryTag project={t.projects} />
                                  </div>
                                </button>
                              ) : (
                                <div className="flex-1 min-w-0">
                                  <div className={['text-body-sm', isDone ? 'line-through text-fg-muted' : 'text-fg'].join(' ')}>
                                    {t.title}
                                  </div>
                                  <div className="mt-1">
                                    <CategoryTag project={t.projects} />
                                  </div>
                                </div>
                              )}
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      )}

      <Fab onClick={() => setCreateOpen(true)} label="Novo" ariaLabel="Criar novo item" />
      <QuickCreateSheet open={createOpen} onClose={() => setCreateOpen(false)} defaultDueDate={today} />
      <RescheduleSheet open={Boolean(rescheduleTask)} task={rescheduleTask} onClose={() => setRescheduleTask(null)} />
      <EditEventSheet open={Boolean(editingEvent)} event={editingEvent} onClose={() => setEditingEvent(null)} />
    </div>
  );
}
