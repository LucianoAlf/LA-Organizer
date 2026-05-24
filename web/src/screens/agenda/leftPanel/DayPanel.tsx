import { useMemo } from 'react';
import { Clock, ListTodo, Flame, CheckCheck, AlertTriangle, AlarmClock, Pin } from 'lucide-react';
import { StatCard } from '../../../components/StatCard';
import { CompactEventRow } from './rows/CompactEventRow';
import { CompactTaskRow } from './rows/CompactTaskRow';
import { CollapsibleSection } from './CollapsibleSection';
import type { TaskForPanel } from '../hooks/useAgendaTasks';
import type { EventForGrid } from '../hooks/useAgendaEvents';

interface Habit {
  id: string;
  name: string;
  done_today: boolean;
  current_streak: number;
}

interface Props {
  currentDate: Date;
  tasks: TaskForPanel[];
  events: EventForGrid[];
  habits: Habit[];
  onTaskClick: (t: TaskForPanel) => void;
  onToggleTaskDone: (t: TaskForPanel) => void;
  onEventClick: (e: EventForGrid) => void;
  onToggleEventDone: (e: EventForGrid) => void;
  onToggleHabit: (h: Habit) => void;
}

function classifyOverdue(dueIso: string, todayIso: string): 'plus4' | 'd2_3' | 'd1' | 'today' | 'future' {
  if (dueIso > todayIso) return 'future';
  if (dueIso === todayIso) return 'today';
  const due = new Date(dueIso + 'T00:00:00Z');
  const today = new Date(todayIso + 'T00:00:00Z');
  const diff = Math.round((today.getTime() - due.getTime()) / (1000 * 60 * 60 * 24));
  if (diff >= 4) return 'plus4';
  if (diff >= 2) return 'd2_3';
  return 'd1';
}

function overdueDays(dueIso: string | null | undefined, todayIso: string): number | null {
  if (!dueIso) return null;
  const due = new Date(dueIso.slice(0, 10) + 'T00:00:00Z').getTime();
  const today = new Date(todayIso + 'T00:00:00Z').getTime();
  const d = Math.round((today - due) / 86400000);
  return d > 0 ? d : null;
}

export function DayPanel(p: Props) {
  const todayIso = p.currentDate.toISOString().slice(0, 10);

  const inWindow = useMemo(() => p.tasks.filter(t => {
    const d = t.scheduled_date ?? t.due_date;
    if (!d) return false;
    return d.slice(0, 10) <= todayIso;
  }), [p.tasks, todayIso]);

  const pending = inWindow.filter(t => t.status !== 'done');
  const overdue = pending.filter(t => t.due_date && t.due_date.slice(0, 10) < todayIso);
  // Inclui tarefas onde scheduled_date OU due_date = hoje (sem scheduled_date definido).
  const todayTasks = pending.filter(
    t => (t.scheduled_date ?? t.due_date ?? '').slice(0, 10) === todayIso && !(t.due_date && t.due_date.slice(0, 10) < todayIso)
  );
  const done = inWindow.filter(t => t.status === 'done');

  const groups = useMemo(() => {
    const g = { plus4: [] as TaskForPanel[], d2_3: [] as TaskForPanel[], d1: [] as TaskForPanel[] };
    for (const t of overdue) {
      if (!t.due_date) continue;
      const c = classifyOverdue(t.due_date.slice(0, 10), todayIso);
      if (c === 'plus4') g.plus4.push(t);
      else if (c === 'd2_3') g.d2_3.push(t);
      else if (c === 'd1') g.d1.push(t);
    }
    return g;
  }, [overdue, todayIso]);

  const dayEvents = useMemo(() =>
    p.events
      .filter(e => e.start_at.slice(0, 10) === todayIso)
      .sort((a, b) => a.start_at.localeCompare(b.start_at)),
  [p.events, todayIso]);

  const habitsDoneCount = p.habits.filter(h => h.done_today).length;
  const avgStreak = p.habits.length > 0
    ? Math.round(p.habits.reduce((s, h) => s + (h.current_streak || 0), 0) / p.habits.length)
    : 0;

  const overdueCount = overdue.length;
  const todayCount = todayTasks.length;
  const doneCount = done.length;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-4 pt-4 pb-2 border-b border-border shrink-0">
        <h2 className="text-body-md font-semibold text-fg">
          {p.currentDate.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })}
        </h2>
      </div>

      {/* Body scrollável */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-1 min-h-0">

        {/* Stats — 3 cards em linha */}
        <div className="flex gap-2 mb-3">
          <StatCard
            label="Pra hoje"
            value={todayCount}
            tone="neutral"
            className="flex-1"
          />
          <StatCard
            label="Atrasadas"
            value={overdueCount}
            tone={overdueCount > 0 ? 'danger' : 'neutral'}
            className="flex-1"
          />
          <StatCard
            label="Feitas"
            value={doneCount}
            tone={doneCount > 0 ? 'success' : 'neutral'}
            className="flex-1"
          />
        </div>

        {/* Hábitos */}
        {p.habits.length > 0 && (
          <CollapsibleSection
            storageKey="day.habits"
            icon={<Flame size={12} />}
            title="Hábitos hoje"
            meta={`${habitsDoneCount}/${p.habits.length}`}
          >
            <div className="space-y-1">
              {p.habits.map(h => (
                <button
                  key={h.id}
                  type="button"
                  onClick={() => p.onToggleHabit(h)}
                  className={[
                    'w-full flex items-center gap-3 px-3 py-2 rounded-md text-left',
                    'surface transition-opacity hover:opacity-90 focus-ring',
                    h.done_today ? 'opacity-60' : '',
                  ].join(' ')}
                >
                  <span
                    className={[
                      'h-5 w-5 rounded-full border-2 shrink-0 flex items-center justify-center',
                      h.done_today
                        ? 'border-success bg-success text-white'
                        : 'border-border bg-transparent',
                    ].join(' ')}
                    aria-label={h.done_today ? 'Concluído' : 'Pendente'}
                  >
                    {h.done_today && (
                      <svg width="10" height="8" viewBox="0 0 10 8" fill="none">
                        <path d="M1 4l3 3 5-6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    )}
                  </span>
                  <span className={['text-body-md flex-1', h.done_today ? 'line-through text-fg-muted' : 'text-fg'].join(' ')}>
                    {h.name}
                  </span>
                  {h.current_streak > 0 && (
                    <span className="text-body-sm text-fg-muted shrink-0">
                      🔥 {h.current_streak}d
                    </span>
                  )}
                </button>
              ))}
            </div>
          </CollapsibleSection>
        )}

        {/* Compromissos */}
        <CollapsibleSection
          storageKey="day.events"
          icon={<Clock size={12} />}
          title="Compromissos"
          meta={dayEvents.length > 0 ? String(dayEvents.length) : undefined}
        >
          {dayEvents.length === 0 ? (
            <p className="text-body-sm text-fg-muted px-1 py-2">Sem compromissos hoje.</p>
          ) : (
            dayEvents.map(e => (
              <CompactEventRow
                key={e.id}
                event={e}
                onClick={() => p.onEventClick(e)}
                onToggleDone={() => p.onToggleEventDone(e)}
              />
            ))
          )}
        </CollapsibleSection>

        {/* Tarefas */}
        <CollapsibleSection
          storageKey="day.tasks"
          icon={<ListTodo size={12} />}
          title="Tarefas"
          meta={pending.length > 0 ? String(pending.length) : undefined}
        >
          {/* Grupo: +4 dias atrasadas */}
          {groups.plus4.length > 0 && (
            <>
              <div className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-danger font-semibold px-1 pt-2 pb-1">
                <AlertTriangle size={10} /><span>+4 dias atrasadas</span>
              </div>
              {groups.plus4.map(t => {
                const d = overdueDays(t.due_date, todayIso);
                return (
                  <CompactTaskRow
                    key={t.id}
                    task={t}
                    onToggle={() => p.onToggleTaskDone(t)}
                    onClick={() => p.onTaskClick(t)}
                    trailingBadge={d != null ? { text: `${d}d`, tone: d >= 4 ? 'danger' : 'warning' } : undefined}
                  />
                );
              })}
            </>
          )}

          {/* Grupo: 2-3 dias atrasadas */}
          {groups.d2_3.length > 0 && (
            <>
              <div className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-warning font-semibold px-1 pt-2 pb-1">
                <AlarmClock size={10} /><span>2–3 dias atrasadas</span>
              </div>
              {groups.d2_3.map(t => {
                const d = overdueDays(t.due_date, todayIso);
                return (
                  <CompactTaskRow
                    key={t.id}
                    task={t}
                    onToggle={() => p.onToggleTaskDone(t)}
                    onClick={() => p.onTaskClick(t)}
                    trailingBadge={d != null ? { text: `${d}d`, tone: d >= 4 ? 'danger' : 'warning' } : undefined}
                  />
                );
              })}
            </>
          )}

          {/* Grupo: 1 dia atrasadas */}
          {groups.d1.length > 0 && (
            <>
              <div className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-warning/80 font-semibold px-1 pt-2 pb-1">
                <Pin size={10} /><span>Ontem</span>
              </div>
              {groups.d1.map(t => {
                const d = overdueDays(t.due_date, todayIso);
                return (
                  <CompactTaskRow
                    key={t.id}
                    task={t}
                    onToggle={() => p.onToggleTaskDone(t)}
                    onClick={() => p.onTaskClick(t)}
                    trailingBadge={d != null ? { text: `${d}d`, tone: d >= 4 ? 'danger' : 'warning' } : undefined}
                  />
                );
              })}
            </>
          )}

          {/* Tarefas de hoje */}
          {todayTasks.length > 0 && (
            <>
              {overdue.length > 0 && (
                <div className="text-[10px] uppercase tracking-wider text-fg-muted font-semibold px-1 pt-2 pb-1">
                  Hoje
                </div>
              )}
              {todayTasks.map(t => (
                <CompactTaskRow
                  key={t.id}
                  task={t}
                  onToggle={() => p.onToggleTaskDone(t)}
                  onClick={() => p.onTaskClick(t)}
                />
              ))}
            </>
          )}

          {pending.length === 0 && (
            <p className="text-body-sm text-fg-muted px-1 py-2">Nenhuma tarefa pendente.</p>
          )}
        </CollapsibleSection>

        {/* Concluídas */}
        {done.length > 0 && (
          <CollapsibleSection
            storageKey="day.done"
            icon={<CheckCheck size={12} />}
            title="Concluídas"
            meta={String(done.length)}
            defaultOpen={false}
          >
            {done.map(t => (
              <CompactTaskRow
                key={t.id}
                task={t}
                onToggle={() => p.onToggleTaskDone(t)}
                onClick={() => p.onTaskClick(t)}
              />
            ))}
          </CollapsibleSection>
        )}

      </div>
    </div>
  );
}
