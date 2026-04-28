import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CalendarDays } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { supabase, supabaseConfigured } from '../lib/supabase';
import { todaySP, workWeekDays, dowShort, brShort } from '../utils/date';
import { LoadingState } from '../components/LoadingState';
import { EmptyState } from '../components/EmptyState';
import type { Task } from '../types';

async function fetchWeekTasks(collabId: string, start: string, end: string): Promise<Task[]> {
  const { data, error } = await supabase
    .from('tasks')
    .select('id, title, status, context, priority, due_date, scheduled_date, remind_at, eisenhower_quadrant, project_id, assigned_to, created_by, projects(name)')
    .eq('assigned_to', collabId)
    .eq('context', 'work')
    .gte('due_date', start)
    .lte('due_date', end)
    .order('due_date', { ascending: true })
    .order('eisenhower_quadrant', { ascending: true, nullsFirst: false });
  if (error) throw error;
  return (data ?? []) as unknown as Task[];
}

function dayCounts(items: Task[], today: string) {
  const total = items.length;
  const done = items.filter(t => t.status === 'done').length;
  const overdue = items.filter(t => t.status === 'overdue' || (t.due_date && t.due_date < today && t.status !== 'done' && t.status !== 'cancelled')).length;
  return { total, done, overdue };
}

export function Semana() {
  const { collaborator } = useAuth();
  const today = todaySP();
  const days = useMemo(() => workWeekDays(today), [today]);
  const start = days[0];
  const end = days[days.length - 1];

  const { data: tasks = [], isLoading, error } = useQuery({
    queryKey: ['tasks', 'semana', collaborator?.id, start, end],
    queryFn: () => collaborator ? fetchWeekTasks(collaborator.id, start, end) : Promise.resolve([]),
    enabled: Boolean(collaborator?.id && supabaseConfigured),
  });

  const byDay = useMemo(() => {
    const map = new Map<string, Task[]>();
    for (const d of days) map.set(d, []);
    for (const t of tasks) {
      if (t.due_date && map.has(t.due_date)) map.get(t.due_date)!.push(t);
    }
    return map;
  }, [tasks, days]);

  const totalWeek = tasks.length;
  const doneWeek = tasks.filter(t => t.status === 'done').length;
  const pct = totalWeek ? Math.round((doneWeek / totalWeek) * 100) : 0;

  return (
    <div className="space-y-md">
      {/* Header — denser, includes week progress */}
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
        {/* progress strip — soft, single line */}
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
            const items = byDay.get(d) ?? [];
            const isToday = d === today;
            const isPast = d < today;
            const { total, done, overdue } = dayCounts(items, today);

            return (
              <section
                key={d}
                aria-label={`${dowShort(d)} ${brShort(d)}`}
                className={[
                  'relative flex flex-col gap-2 p-md md:p-md md:min-h-[180px]',
                  isToday ? 'bg-brand/5' : '',
                ].join(' ')}
              >
                {/* Today accent bar (left edge) */}
                {isToday && <span aria-hidden className="absolute left-0 top-0 bottom-0 w-[3px] bg-brand md:hidden" />}
                {isToday && <span aria-hidden className="hidden md:block absolute left-0 right-0 top-0 h-[3px] bg-brand" />}

                {/* Row header — single line on mobile */}
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

                {/* Items — compact bullet list, max 3 visible (today shows up to 5) */}
                {total > 0 && (
                  <ul className="space-y-1">
                    {items.slice(0, isToday ? 5 : 3).map(t => (
                      <li
                        key={t.id}
                        className={[
                          'text-body-sm truncate flex items-center gap-2',
                          t.status === 'done' ? 'line-through text-fg-muted' : 'text-fg-secondary',
                        ].join(' ')}
                      >
                        <span aria-hidden className={[
                          'inline-block h-1.5 w-1.5 rounded-full shrink-0',
                          t.status === 'done' ? 'bg-success' : t.status === 'overdue' ? 'bg-danger' : 'bg-fg-muted',
                        ].join(' ')} />
                        {t.title}
                      </li>
                    ))}
                    {items.length > (isToday ? 5 : 3) && (
                      <li className="text-body-sm text-fg-muted pl-3.5">+ {items.length - (isToday ? 5 : 3)}</li>
                    )}
                  </ul>
                )}
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
