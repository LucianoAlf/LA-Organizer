import { useMemo } from 'react';
import { StatCard } from '../../../components/StatCard';
import { CompactEventRow } from './rows/CompactEventRow';
import { CompactTaskRow } from './rows/CompactTaskRow';
import { CollapsibleSection } from './CollapsibleSection';
import type { TaskForPanel } from '../hooks/useAgendaTasks';
import type { EventForGrid } from '../hooks/useAgendaEvents';

interface Props {
  monthDate: Date;
  tasks: TaskForPanel[];
  events: EventForGrid[];
  onTaskClick: (t: TaskForPanel) => void;
  onToggleTaskDone: (t: TaskForPanel) => void;
  onEventClick: (e: EventForGrid) => void;
  onToggleEventDone: (e: EventForGrid) => void;
}

function isoOf(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function daysSince(dueIso: string, todayIso: string): number {
  const due = new Date(dueIso + 'T00:00:00Z');
  const today = new Date(todayIso + 'T00:00:00Z');
  return Math.round((today.getTime() - due.getTime()) / (1000 * 60 * 60 * 24));
}

function overdueDays(dueIso: string | null | undefined, todayIso: string): number | null {
  if (!dueIso) return null;
  const due = new Date(dueIso.slice(0, 10) + 'T00:00:00Z').getTime();
  const today = new Date(todayIso + 'T00:00:00Z').getTime();
  const d = Math.round((today - due) / 86400000);
  return d > 0 ? d : null;
}

export function MonthPanel(p: Props) {
  const todayIso = new Date().toISOString().slice(0, 10);

  // ── Derived values ────────────────────────────────────────────────────────
  const monthStart = new Date(p.monthDate.getFullYear(), p.monthDate.getMonth(), 1);
  const monthEnd = new Date(p.monthDate.getFullYear(), p.monthDate.getMonth() + 1, 0);
  const startIso = isoOf(monthStart);
  const endIso = isoOf(monthEnd);

  const monthTasks = useMemo(
    () =>
      p.tasks.filter(t => {
        const d = (t.scheduled_date ?? t.due_date ?? '').slice(0, 10);
        return d ? d >= startIso && d <= endIso : false;
      }),
    [p.tasks, startIso, endIso],
  );

  const monthEvents = useMemo(
    () => p.events.filter(e => {
      const d = e.start_at.slice(0, 10);
      return d >= startIso && d <= endIso;
    }),
    [p.events, startIso, endIso],
  );

  const overdueAll = useMemo(
    () =>
      monthTasks.filter(
        t => t.due_date && t.due_date.slice(0, 10) < todayIso && t.status !== 'done',
      ),
    [monthTasks, todayIso],
  );

  const monthDone = useMemo(() => monthTasks.filter(t => t.status === 'done'), [monthTasks]);

  const groups = useMemo(() => {
    const g = { plus15: [] as TaskForPanel[], d5_14: [] as TaskForPanel[] };
    for (const t of overdueAll) {
      if (!t.due_date) continue;
      const diff = daysSince(t.due_date.slice(0, 10), todayIso);
      if (diff >= 15) g.plus15.push(t);
      else if (diff >= 5) g.d5_14.push(t);
    }
    return g;
  }, [overdueAll, todayIso]);

  // ── Render: resumo do mês ─────────────────────────────────────────────────
  const total = monthTasks.length + monthEvents.length;

  return (
    <div className="flex flex-col h-full">
      <header className="px-3 pt-3 pb-2 border-b border-border shrink-0">
        <div className="text-[14px] font-semibold text-fg capitalize">
          {p.monthDate.toLocaleDateString('pt-BR', { month: 'long' })} · resumo
        </div>
        <div className="text-[11px] text-fg-muted">selecione um dia pra ver detalhe</div>
      </header>

      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-2 min-h-0">
        <div className="flex gap-2 mb-3">
          <StatCard label="Total mês" value={total} tone="neutral" className="flex-1" />
          <StatCard
            label="Atrasadas"
            value={overdueAll.length}
            tone={overdueAll.length > 0 ? 'danger' : 'neutral'}
            className="flex-1"
          />
          <StatCard
            label="Feitas"
            value={monthDone.length}
            tone={monthDone.length > 0 ? 'success' : 'neutral'}
            className="flex-1"
          />
        </div>

        {overdueAll.length > 0 && (
          <CollapsibleSection
            storageKey="month.topoverdue"
            title="🚨 Top atrasos"
            meta={overdueAll.length}
          >
            {groups.plus15.length > 0 && (
              <>
                <div className="text-[10px] uppercase tracking-wider text-danger font-semibold py-1 px-1">
                  Parou 15+ dias · {groups.plus15.length}
                </div>
                {groups.plus15.map(t => {
                  const d = overdueDays(t.due_date, todayIso);
                  return (
                    <CompactTaskRow
                      key={t.id}
                      task={t}
                      onToggle={() => p.onToggleTaskDone(t)}
                      onClick={() => p.onTaskClick(t)}
                      trailingBadge={d != null ? { text: `${d}d`, tone: 'danger' } : undefined}
                    />
                  );
                })}
              </>
            )}
            {groups.d5_14.length > 0 && (
              <>
                <div className="text-[10px] uppercase tracking-wider text-warning font-semibold py-1 px-1">
                  Parou 5-14 dias · {groups.d5_14.length}
                </div>
                {groups.d5_14.map(t => {
                  const d = overdueDays(t.due_date, todayIso);
                  return (
                    <CompactTaskRow
                      key={t.id}
                      task={t}
                      onToggle={() => p.onToggleTaskDone(t)}
                      onClick={() => p.onTaskClick(t)}
                      trailingBadge={d != null ? { text: `${d}d`, tone: 'warning' } : undefined}
                    />
                  );
                })}
              </>
            )}
          </CollapsibleSection>
        )}

        <CollapsibleSection
          storageKey="month.tasks"
          title="📋 Tarefas do mês"
          meta={monthTasks.length}
          defaultOpen={false}
        >
          {monthTasks.map(t => (
            <CompactTaskRow
              key={t.id}
              task={t}
              onToggle={() => p.onToggleTaskDone(t)}
              onClick={() => p.onTaskClick(t)}
            />
          ))}
        </CollapsibleSection>

        <CollapsibleSection
          storageKey="month.events"
          title="🕒 Compromissos do mês"
          meta={monthEvents.length}
          defaultOpen={false}
        >
          {monthEvents.map(e => (
            <CompactEventRow key={e.id} event={e} onClick={() => p.onEventClick(e)} onToggleDone={() => p.onToggleEventDone(e)} />
          ))}
        </CollapsibleSection>
      </div>
    </div>
  );
}
