import { useMemo } from 'react';
import { StatCard } from '../../../components/StatCard';
import { EventRow } from '../../../components/EventRow';
import { TaskRow } from '../../../components/TaskRow';
import { CollapsibleSection } from './CollapsibleSection';
import type { TaskForPanel } from '../hooks/useAgendaTasks';
import type { EventForGrid } from '../hooks/useAgendaEvents';
import type { Task, CalendarEvent } from '../../../types';

interface Props {
  monthDate: Date;
  selectedDay: Date | null;
  tasks: TaskForPanel[];
  events: EventForGrid[];
  onTaskClick: (t: TaskForPanel) => void;
  onToggleTaskDone: (t: TaskForPanel) => void;
  onEventClick: (e: EventForGrid) => void;
  onClearSelectedDay: () => void;
  onOpenDayView: (d: Date) => void;
}

function isoOf(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function daysSince(dueIso: string, todayIso: string): number {
  const due = new Date(dueIso + 'T00:00:00Z');
  const today = new Date(todayIso + 'T00:00:00Z');
  return Math.round((today.getTime() - due.getTime()) / (1000 * 60 * 60 * 24));
}

/** Constrói um objeto Task mínimo compatível com TaskRow a partir de TaskForPanel. */
function toTask(t: TaskForPanel): Task {
  return {
    id: t.id,
    title: t.title,
    status: t.status,
    context: t.context,
    priority: 'medium',
    due_date: t.due_date,
    scheduled_date: t.scheduled_date ?? null,
    remind_at: null,
    eisenhower_quadrant: null,
    project_id: null,
    assigned_to: '',
    created_by: '',
  };
}

/** Constrói um CalendarEvent mínimo a partir de EventForGrid para o EventRow. */
function toCalendarEvent(e: EventForGrid): CalendarEvent {
  return {
    id: e.id,
    collaborator_id: '',
    title: e.title,
    description: null,
    context: e.context,
    category_id: '',
    category: {
      id: '',
      collaborator_id: null,
      slug: e.category,
      label: e.category,
      context: e.context,
      icon: null,
      is_system: true,
      sort_order: 0,
    },
    start_at: e.start_at,
    end_at: e.end_at,
    modality: e.modality,
    location_text: e.location_text,
    meeting_url: e.meeting_url,
    project_id: e.project_id,
    status: e.status,
    eisenhower_quadrant: null,
    created_by: null,
    source: e.source,
    remind_at: null,
    created_at: '',
    updated_at: '',
    event_reminders: [],
  };
}

export function MonthPanel(p: Props) {
  const todayIso = new Date().toISOString().slice(0, 10);

  // ── Derived values for selected-day mode ──────────────────────────────────
  const selectedIso = p.selectedDay ? isoOf(p.selectedDay) : null;

  const dayEvents = useMemo(() => {
    if (!selectedIso) return [];
    return p.events
      .filter(e => e.start_at.slice(0, 10) === selectedIso)
      .sort((a, b) => a.start_at.localeCompare(b.start_at));
  }, [p.events, selectedIso]);

  const dayTasks = useMemo(() => {
    if (!selectedIso) return [];
    return p.tasks.filter(
      t => (t.scheduled_date ?? t.due_date ?? '').slice(0, 10) === selectedIso,
    );
  }, [p.tasks, selectedIso]);

  // ── Derived values for month-summary mode ─────────────────────────────────
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

  // ── Render: dia selecionado ───────────────────────────────────────────────
  if (p.selectedDay) {
    const pending = dayTasks.filter(t => t.status !== 'done');
    const overdue = dayTasks.filter(
      t => t.due_date && t.due_date.slice(0, 10) < todayIso && t.status !== 'done',
    );
    const done = dayTasks.filter(t => t.status === 'done');

    return (
      <div className="flex flex-col h-full">
        <header className="px-3 pt-3 pb-2 border-b border-border flex items-start justify-between shrink-0">
          <div>
            <div className="text-[14px] font-semibold text-fg capitalize">
              {p.selectedDay.toLocaleDateString('pt-BR', {
                weekday: 'long',
                day: '2-digit',
                month: '2-digit',
              })}
            </div>
            <div className="text-[11px] text-fg-muted">dia selecionado</div>
          </div>
          <button
            type="button"
            onClick={p.onClearSelectedDay}
            className="text-[11px] text-tom hover:underline focus-ring rounded px-1"
          >
            ← voltar
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-3 py-3 space-y-2 min-h-0">
          <div className="flex gap-2 mb-3">
            <StatCard
              label={`Pra ${p.selectedDay.getDate()}`}
              value={pending.length}
              tone="neutral"
              className="flex-1"
            />
            <StatCard
              label="Atrasadas"
              value={overdue.length}
              tone={overdue.length > 0 ? 'danger' : 'neutral'}
              className="flex-1"
            />
            <StatCard
              label="Feitas"
              value={done.length}
              tone={done.length > 0 ? 'success' : 'neutral'}
              className="flex-1"
            />
          </div>

          <CollapsibleSection
            storageKey="month.day.events"
            title="🕒 Compromissos"
            meta={dayEvents.length}
          >
            {dayEvents.length === 0 ? (
              <div className="px-2 py-2 text-[11px] text-fg-muted italic">Sem compromissos</div>
            ) : (
              dayEvents.map(e => (
                <EventRow
                  key={e.id}
                  event={toCalendarEvent(e)}
                  onClick={() => p.onEventClick(e)}
                />
              ))
            )}
          </CollapsibleSection>

          <CollapsibleSection
            storageKey="month.day.tasks"
            title="📋 Tarefas"
            meta={dayTasks.length}
          >
            {dayTasks.length === 0 ? (
              <div className="px-2 py-2 text-[11px] text-fg-muted italic">Sem tarefas</div>
            ) : (
              dayTasks.map(t => (
                <TaskRow
                  key={t.id}
                  task={toTask(t)}
                  onToggle={() => p.onToggleTaskDone(t)}
                  onEdit={() => p.onTaskClick(t)}
                />
              ))
            )}
          </CollapsibleSection>

          <button
            type="button"
            onClick={() => p.onOpenDayView(p.selectedDay!)}
            className="w-full mt-3 px-3 py-2 rounded-md bg-bg-elevated border border-border text-[12px] text-tom hover:bg-bg-elevated2 focus-ring"
          >
            Abrir dia {p.selectedDay.getDate()} em Day view →
          </button>
        </div>
      </div>
    );
  }

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
                {groups.plus15.map(t => (
                  <TaskRow
                    key={t.id}
                    task={toTask(t)}
                    onToggle={() => p.onToggleTaskDone(t)}
                    onEdit={() => p.onTaskClick(t)}
                  />
                ))}
              </>
            )}
            {groups.d5_14.length > 0 && (
              <>
                <div className="text-[10px] uppercase tracking-wider text-warning font-semibold py-1 px-1">
                  Parou 5-14 dias · {groups.d5_14.length}
                </div>
                {groups.d5_14.map(t => (
                  <TaskRow
                    key={t.id}
                    task={toTask(t)}
                    onToggle={() => p.onToggleTaskDone(t)}
                    onEdit={() => p.onTaskClick(t)}
                  />
                ))}
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
            <TaskRow
              key={t.id}
              task={toTask(t)}
              onToggle={() => p.onToggleTaskDone(t)}
              onEdit={() => p.onTaskClick(t)}
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
            <EventRow key={e.id} event={toCalendarEvent(e)} onClick={() => p.onEventClick(e)} />
          ))}
        </CollapsibleSection>
      </div>
    </div>
  );
}
