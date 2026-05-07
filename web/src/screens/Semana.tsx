import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CalendarDays } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { supabase, supabaseConfigured } from '../lib/supabase';
import { todaySP, weekDaysMonSat, dowShort, brShort } from '../utils/date';
import { fetchEventsForRange, formatEventTimeRange, eventLocalYmd } from '../lib/events';
import { LoadingState } from '../components/LoadingState';
import { EmptyState } from '../components/EmptyState';
import { Fab } from '../components/Fab';
import { QuickCreateSheet } from '../components/QuickCreateSheet';
import { RescheduleSheet } from '../components/RescheduleSheet';
import { EditEventSheet } from '../components/EditEventSheet';
import type { Task, CalendarEvent, Project } from '../types';

// Sprint 22.11 — Semana refatorada: cards individuais por dia, inclui sábado,
// tags de categoria do projeto, empty state limpo. Hoje destaca por borda olive sutil.

type WeekTask = Task & { projects?: { name: string; category?: Project['category'] } | null };

async function fetchWeekTasks(collabId: string, start: string, end: string): Promise<WeekTask[]> {
  const { data, error } = await supabase
    .from('tasks')
    .select('id, title, status, context, priority, category, due_date, scheduled_date, remind_at, eisenhower_quadrant, project_id, assigned_to, created_by, projects(name, category)')
    .eq('assigned_to', collabId)
    .eq('context', 'work')
    .neq('status', 'cancelled')
    .gte('due_date', start)
    .lte('due_date', end)
    .order('remind_at', { ascending: true, nullsFirst: false })
    .order('due_date', { ascending: true })
    .order('eisenhower_quadrant', { ascending: true, nullsFirst: false });
  if (error) throw error;
  return (data ?? []) as unknown as WeekTask[];
}

// Sprint 22.16 — paleta distinta dos tokens semânticos (status, Eisenhower).
// Verde reservado pra "concluído", vermelho/âmbar/azul pra Eisenhower.
const CATEGORY_TAG: Record<string, string> = {
  pedagogical:    'bg-[#8B5CF6]/15 text-[#A78BFA]',  // violet
  commercial:     'bg-[#D946EF]/15 text-[#E879F9]',  // fuchsia
  administrative: 'bg-[#06B6D4]/15 text-[#22D3EE]',  // cyan
  operational:    'bg-[#14B8A6]/15 text-[#5EEAD4]',  // teal
  event:          'bg-[#F43F5E]/15 text-[#FB7185]',  // rose
  infrastructure: 'bg-[#64748B]/20 text-[#CBD5E1]',  // slate
};

const QUADRANT_DOT: Record<string, string> = {
  '1': 'bg-danger',
  '2': 'bg-warning',
  '3': 'bg-info',
};

function CategoryTag({ task }: { task: WeekTask }) {
  const proj = task.projects;
  if (!proj?.name) return null;
  const cat = proj.category;
  const cls = (cat && CATEGORY_TAG[cat]) ?? 'bg-bg-elevated text-fg-muted border border-border';
  return (
    <span className={['inline-block text-label uppercase tracking-wide rounded-sm px-1.5 py-0.5', cls].join(' ')}>
      {proj.name}
    </span>
  );
}

function dayCounts(tasks: WeekTask[], events: CalendarEvent[], today: string) {
  const activeEvents = events.filter(e => e.status !== 'cancelled');
  const total = tasks.length + activeEvents.length;
  const done = tasks.filter(t => t.status === 'done').length + activeEvents.filter(e => e.status === 'done').length;
  const overdue = tasks.filter(t => t.status === 'overdue' || (t.due_date && t.due_date < today && t.status !== 'done')).length;
  return { total, done, overdue };
}

export function Semana() {
  const { collaborator } = useAuth();
  const today = todaySP();
  const days = useMemo(() => weekDaysMonSat(today), [today]);
  const start = days[0];
  const end = days[days.length - 1];
  const [createOpen, setCreateOpen] = useState(false);
  const [rescheduleTask, setRescheduleTask] = useState<Task | null>(null);
  const [editingEvent, setEditingEvent] = useState<CalendarEvent | null>(null);

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

  const tasksByDay = useMemo(() => {
    const map = new Map<string, WeekTask[]>();
    for (const d of days) map.set(d, []);
    for (const t of tasks) {
      if (t.due_date && map.has(t.due_date)) map.get(t.due_date)!.push(t);
    }
    return map;
  }, [tasks, days]);

  const eventsByDay = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    for (const d of days) map.set(d, []);
    for (const e of events) {
      if (e.context !== 'work') continue;
      const ymd = eventLocalYmd(e.start_at);
      if (map.has(ymd)) map.get(ymd)!.push(e);
    }
    return map;
  }, [events, days]);

  const workEvents = events.filter(e => e.context === 'work' && e.status !== 'cancelled');
  const totalWeek = tasks.length + workEvents.length;
  const doneWeek = tasks.filter(t => t.status === 'done').length + workEvents.filter(e => e.status === 'done').length;
  const pct = totalWeek ? Math.round((doneWeek / totalWeek) * 100) : 0;
  const isLoading = tLoading || eLoading;

  return (
    <div className="space-y-md">
      <header className="space-y-2">
        <div className="flex items-baseline justify-between gap-md">
          <div>
            <h2 className="text-section-title">Progresso da semana</h2>
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

      {!supabaseConfigured ? (
        <EmptyState icon={<CalendarDays size={32} />} title="Configure Supabase" description="Defina VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY." />
      ) : isLoading ? (
        <LoadingState rows={3} />
      ) : error ? (
        <EmptyState title="Erro" description={(error as Error).message} />
      ) : (
        <div className="space-y-sm">
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
                      <span className="inline-block text-label uppercase tracking-wide bg-tom text-white rounded-sm px-1.5 py-0.5">
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
                  <p className="mt-2 text-body-sm text-fg-muted italic">Nenhuma tarefa</p>
                ) : (
                  <div className="mt-3 space-y-2">
                    {dayEvents.length > 0 && (
                      <ul className="space-y-1.5">
                        {dayEvents.map(e => {
                          const range = formatEventTimeRange(e.start_at, e.end_at);
                          const cancelled = e.status === 'cancelled';
                          return (
                            <li
                              key={e.id}
                              onClick={() => setEditingEvent(e)}
                              className={[
                                'text-body-sm flex items-baseline gap-2 cursor-pointer hover:bg-bg-elevated rounded-sm -mx-1 px-1 py-0.5',
                                cancelled ? 'line-through text-fg-muted' : 'text-fg-secondary',
                              ].join(' ')}>
                              <span className="text-fg font-semibold tabular-nums shrink-0">{range.split('–')[0]}</span>
                              <span className="truncate">{e.title}</span>
                            </li>
                          );
                        })}
                      </ul>
                    )}

                    {dayTasks.length > 0 && (
                      <ul className="space-y-2">
                        {dayTasks.map(t => {
                          const tappable = t.status !== 'done' && t.status !== 'cancelled';
                          const isDone = t.status === 'done';
                          const inner = (
                            <div className="flex items-start gap-2 w-full">
                              <span aria-hidden className={[
                                'mt-1 inline-block h-4 w-4 shrink-0 rounded-full grid place-items-center transition-colors',
                                isDone ? 'bg-tom text-white' : t.status === 'overdue' ? 'border-2 border-danger' : 'border-2 border-fg-muted',
                              ].join(' ')}>
                                {isDone && (
                                  <svg viewBox="0 0 12 12" className="h-2.5 w-2.5" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M2 6 L5 9 L10 3" /></svg>
                                )}
                              </span>
                              <div className="min-w-0 flex-1">
                                <div className={['text-body-sm', isDone ? 'line-through text-fg-muted' : 'text-fg'].join(' ')}>
                                  {(() => {
                                    const qk = t.eisenhower_quadrant ? String(t.eisenhower_quadrant) : null;
                                    const qc = qk && QUADRANT_DOT[qk] ? QUADRANT_DOT[qk] : null;
                                    return qc && !isDone ? (
                                      <span aria-hidden title={`Q${qk}`} className={['inline-block h-1.5 w-1.5 rounded-full mr-1.5 align-middle', qc].join(' ')} />
                                    ) : null;
                                  })()}
                                  {t.title}
                                </div>
                                <div className="mt-1">
                                  <CategoryTag task={t} />
                                </div>
                              </div>
                            </div>
                          );
                          return (
                            <li key={t.id}>
                              {tappable ? (
                                <button
                                  type="button"
                                  onClick={() => setRescheduleTask(t)}
                                  className="w-full text-left hover:bg-bg-elevated rounded-sm -mx-1 px-1 py-0.5 focus-ring"
                                  title="Reagendar"
                                >
                                  {inner}
                                </button>
                              ) : (
                                <div className="-mx-1 px-1 py-0.5">{inner}</div>
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
