import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CalendarDays } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { supabase, supabaseConfigured } from '../lib/supabase';
import { todaySP, workWeekDays, dowShort, brShort } from '../utils/date';
import { fetchEventsForRange, formatEventTimeRange, eventLocalYmd } from '../lib/events';
import { LoadingState } from '../components/LoadingState';
import { EmptyState } from '../components/EmptyState';
import { Fab } from '../components/Fab';
import { QuickCreateSheet } from '../components/QuickCreateSheet';
import { RescheduleSheet } from '../components/RescheduleSheet';
import type { Task, CalendarEvent } from '../types';

async function fetchWeekTasks(collabId: string, start: string, end: string): Promise<Task[]> {
  const { data, error } = await supabase
    .from('tasks')
    .select('id, title, status, context, priority, category, due_date, scheduled_date, remind_at, eisenhower_quadrant, project_id, assigned_to, created_by, projects(name)')
    .eq('assigned_to', collabId)
    .eq('context', 'work')
    .gte('due_date', start)
    .lte('due_date', end)
    .order('due_date', { ascending: true })
    .order('eisenhower_quadrant', { ascending: true, nullsFirst: false });
  if (error) throw error;
  return (data ?? []) as unknown as Task[];
}

function dayCounts(tasks: Task[], events: CalendarEvent[], today: string) {
  const total = tasks.length + events.length;
  const done = tasks.filter(t => t.status === 'done').length + events.filter(e => e.status === 'done').length;
  const overdue = tasks.filter(t => t.status === 'overdue' || (t.due_date && t.due_date < today && t.status !== 'done' && t.status !== 'cancelled')).length;
  return { total, done, overdue };
}

export function Semana() {
  const { collaborator } = useAuth();
  const today = todaySP();
  const days = useMemo(() => workWeekDays(today), [today]);
  const start = days[0];
  const end = days[days.length - 1];
  const [createOpen, setCreateOpen] = useState(false);
  const [rescheduleTask, setRescheduleTask] = useState<Task | null>(null);

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
    const map = new Map<string, Task[]>();
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
      // Show only work events on the week summary; personal events are private to the day-level only.
      if (e.context !== 'work') continue;
      const ymd = eventLocalYmd(e.start_at);
      if (map.has(ymd)) map.get(ymd)!.push(e);
    }
    return map;
  }, [events, days]);

  const totalWeek = tasks.length + events.filter(e => e.context === 'work').length;
  const doneWeek = tasks.filter(t => t.status === 'done').length + events.filter(e => e.status === 'done' && e.context === 'work').length;
  const pct = totalWeek ? Math.round((doneWeek / totalWeek) * 100) : 0;
  const isLoading = tLoading || eLoading;

  return (
    <div className="space-y-md">
      <header>
        <div className="flex items-baseline justify-between gap-md">
          <div>
            <h2 className="text-section-title">
              <span className="tabular-nums">{brShort(start)}</span>
              <span className="text-fg-muted"> – </span>
              <span className="tabular-nums">{brShort(end)}</span>
            </h2>
            <p className="text-body-sm text-fg-muted mt-0.5">Trabalho · seg a sex</p>
          </div>
          <div className="text-right">
            <div className="text-card-title tabular-nums">
              <span className={pct >= 70 ? 'text-success' : pct >= 40 ? 'text-warning' : 'text-fg'}>
                {doneWeek}
              </span>
              <span className="text-fg-muted">/{totalWeek}</span>
            </div>
            <div className="text-label uppercase text-fg-muted tracking-wide">Da semana</div>
          </div>
        </div>
        <div className="mt-md h-1 w-full bg-bg-elevated rounded-full overflow-hidden">
          <div className="h-full bg-brand transition-[width]" style={{ width: `${pct}%` }} />
        </div>
      </header>

      {!supabaseConfigured ? (
        <EmptyState icon={<CalendarDays size={32} />} title="Configure Supabase" description="Defina VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY." />
      ) : isLoading ? (
        <LoadingState rows={3} />
      ) : error ? (
        <EmptyState title="Erro" description={(error as Error).message} />
      ) : (
        <div className="surface overflow-hidden md:grid md:grid-cols-5 md:divide-x md:divide-y-0 divide-y divide-border">
          {days.map(d => {
            const dayTasks = tasksByDay.get(d) ?? [];
            const dayEvents = eventsByDay.get(d) ?? [];
            const isToday = d === today;
            const isPast = d < today;
            const { total, done, overdue } = dayCounts(dayTasks, dayEvents, today);

            return (
              <section
                key={d}
                aria-label={`${dowShort(d)} ${brShort(d)}`}
                className={[
                  'relative flex flex-col gap-2 p-md md:p-md md:min-h-[180px]',
                  isToday ? 'bg-brand/5' : '',
                ].join(' ')}
              >
                {isToday && <span aria-hidden className="absolute left-0 top-0 bottom-0 w-[3px] bg-brand md:hidden" />}
                {isToday && <span aria-hidden className="hidden md:block absolute left-0 right-0 top-0 h-[3px] bg-brand" />}

                <div className="flex items-baseline justify-between gap-md">
                  <div className="flex items-baseline gap-2">
                    <span className={['text-label uppercase tracking-wide', isToday ? 'text-brand' : isPast ? 'text-fg-muted' : 'text-fg-secondary'].join(' ')}>
                      {dowShort(d)}
                    </span>
                    <span className={['text-card-title tabular-nums', isToday ? '' : isPast ? 'text-fg-muted' : ''].join(' ')}>
                      {brShort(d)}
                    </span>
                    {isToday && <span className="text-label uppercase tracking-wide text-brand">hoje</span>}
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

                {/* Compromissos primeiro (com horário) */}
                {dayEvents.length > 0 && (
                  <ul className="space-y-1">
                    {dayEvents.slice(0, isToday ? 4 : 2).map(e => {
                      const range = formatEventTimeRange(e.start_at, e.end_at);
                      const cancelled = e.status === 'cancelled';
                      return (
                        <li key={e.id} className={[
                          'text-body-sm flex items-baseline gap-2',
                          cancelled ? 'line-through text-fg-muted' : 'text-fg-secondary',
                        ].join(' ')}>
                          <span className="text-brand font-semibold tabular-nums shrink-0">{range.split('–')[0]}</span>
                          <span className="truncate">{e.title}</span>
                        </li>
                      );
                    })}
                    {dayEvents.length > (isToday ? 4 : 2) && (
                      <li className="text-body-sm text-fg-muted pl-12">+ {dayEvents.length - (isToday ? 4 : 2)} compromisso(s)</li>
                    )}
                  </ul>
                )}

                {/* Tarefas — bullet list */}
                {dayTasks.length > 0 && (
                  <ul className="space-y-1">
                    {dayTasks.slice(0, isToday ? 4 : 3).map(t => {
                      const tappable = t.status !== 'done' && t.status !== 'cancelled';
                      const inner = (
                        <>
                          <span aria-hidden className={[
                            'inline-block h-1.5 w-1.5 rounded-full shrink-0',
                            t.status === 'done' ? 'bg-success' : t.status === 'overdue' ? 'bg-danger' : 'bg-fg-muted',
                          ].join(' ')} />
                          <span className="truncate">{t.title}</span>
                        </>
                      );
                      const cls = [
                        'text-body-sm truncate flex items-center gap-2 w-full text-left',
                        t.status === 'done' ? 'line-through text-fg-muted' : 'text-fg-secondary',
                      ].join(' ');
                      return (
                        <li key={t.id}>
                          {tappable ? (
                            <button
                              type="button"
                              onClick={() => setRescheduleTask(t)}
                              className={cls + ' hover:text-fg focus-ring rounded-sm'}
                              title="Reagendar"
                            >
                              {inner}
                            </button>
                          ) : (
                            <span className={cls}>{inner}</span>
                          )}
                        </li>
                      );
                    })}
                    {dayTasks.length > (isToday ? 4 : 3) && (
                      <li className="text-body-sm text-fg-muted pl-3.5">+ {dayTasks.length - (isToday ? 4 : 3)}</li>
                    )}
                  </ul>
                )}
              </section>
            );
          })}
        </div>
      )}

      <Fab onClick={() => setCreateOpen(true)} label="Novo" ariaLabel="Criar novo item" />
      <QuickCreateSheet open={createOpen} onClose={() => setCreateOpen(false)} defaultDueDate={today} />
      <RescheduleSheet open={Boolean(rescheduleTask)} task={rescheduleTask} onClose={() => setRescheduleTask(null)} />
    </div>
  );
}
