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

  return (
    <div className="space-y-lg">
      <header>
        <h2 className="text-section-title">Semana de {brShort(start)} a {brShort(end)}</h2>
        <p className="text-body-sm text-fg-muted mt-1">Trabalho · seg a sex</p>
      </header>

      {!supabaseConfigured ? (
        <EmptyState icon={<CalendarDays size={32} />} title="Configure Supabase" description="Defina VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY." />
      ) : isLoading ? (
        <LoadingState rows={5} />
      ) : error ? (
        <EmptyState title="Erro" description={(error as Error).message} />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-5 gap-md">
          {days.map(d => {
            const items = byDay.get(d) ?? [];
            const isToday = d === today;
            const overdue = items.filter(t => t.status === 'overdue' || (t.due_date && t.due_date < today && t.status !== 'done')).length;
            const done = items.filter(t => t.status === 'done').length;
            return (
              <section
                key={d}
                aria-label={`${dowShort(d)} ${brShort(d)}`}
                className={[
                  'rounded-md border bg-bg-surface p-md min-h-[120px]',
                  isToday ? 'border-brand' : 'border-border',
                ].join(' ')}
              >
                <div className="flex items-center justify-between">
                  <div>
                    <div className={['text-label uppercase tracking-wide', isToday ? 'text-brand' : 'text-fg-muted'].join(' ')}>
                      {dowShort(d)}
                    </div>
                    <div className="text-card-title tabular-nums">{brShort(d)}</div>
                  </div>
                  <div className="text-body-sm text-fg-muted tabular-nums">
                    {items.length === 0 ? '—' : `${done}/${items.length}`}
                    {overdue > 0 && <span className="ml-2 text-danger">⚠ {overdue}</span>}
                  </div>
                </div>
                {items.length > 0 && (
                  <ul className="mt-md space-y-2">
                    {items.slice(0, 5).map(t => (
                      <li
                        key={t.id}
                        className={[
                          'text-body-sm truncate',
                          t.status === 'done' ? 'line-through text-fg-muted' : 'text-fg-secondary',
                        ].join(' ')}
                      >
                        • {t.title}
                      </li>
                    ))}
                    {items.length > 5 && (
                      <li className="text-body-sm text-fg-muted">+ {items.length - 5} mais</li>
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
