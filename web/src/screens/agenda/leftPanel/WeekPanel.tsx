import { useMemo } from 'react';
import { StatCard } from '../../../components/StatCard';
import { CompactEventRow } from './rows/CompactEventRow';
import { CompactTaskRow } from './rows/CompactTaskRow';
import { CollapsibleSection } from './CollapsibleSection';
import { HabitWeekHeatmap } from './HabitWeekHeatmap';
import { localYmd, todaySP } from '../../../utils/date';
import type { TaskForPanel } from '../hooks/useAgendaTasks';
import type { EventForGrid } from '../hooks/useAgendaEvents';

interface HabitWithWeek {
  id: string;
  name: string;
  /** boolean[7], índice 0 = Dom, 6 = Sáb. */
  week: boolean[];
  current_streak: number;
}

interface Props {
  weekStart: Date;
  currentDate: Date;
  tasks: TaskForPanel[];
  events: EventForGrid[];
  habits: HabitWithWeek[];
  onTaskClick: (t: TaskForPanel) => void;
  onToggleTaskDone: (t: TaskForPanel) => void;
  onEventClick: (e: EventForGrid) => void;
  onToggleEventDone: (e: EventForGrid) => void;
  onPickDay: (d: Date) => void;
}

const DAY_NAMES = ['DOM', 'SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SÁB'] as const;

/** Gera um array de 7 datas a partir de weekStart. */
function buildWeekDays(weekStart: Date): Date[] {
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + i);
    return d;
  });
}

export function WeekPanel(p: Props) {
  // Hoje REAL em SP — não o dia navegado: o chip "hoje" só aparece na semana atual.
  const todayIso = todaySP();

  const days = useMemo(() => buildWeekDays(p.weekStart), [p.weekStart]);

  const weekStartIso = localYmd(days[0]);
  const weekEndIso = localYmd(days[6]);

  // Totais da semana
  const { totalCount, overdueCount, doneCount } = useMemo(() => {
    let total = 0;
    let overdue = 0;
    let done = 0;
    for (const t of p.tasks) {
      const d = t.scheduled_date ?? t.due_date;
      if (!d) continue;
      const dIso = d.slice(0, 10);
      if (dIso < weekStartIso || dIso > weekEndIso) continue;
      total++;
      if (t.status === 'done') {
        done++;
      } else if (t.due_date && t.due_date.slice(0, 10) < todayIso) {
        overdue++;
      }
    }
    return { totalCount: total, overdueCount: overdue, doneCount: done };
  }, [p.tasks, weekStartIso, weekEndIso, todayIso]);

  // todayIndex: índice do dia atual no array days (0-6), ou null
  const todayIndex = useMemo(() => {
    const idx = days.findIndex(d => localYmd(d) === todayIso);
    return idx >= 0 ? idx : null;
  }, [days, todayIso]);

  // Header meta range
  const rangeLabel = useMemo(() => {
    const fmt = (d: Date) => d.toLocaleDateString('pt-BR', { day: 'numeric', month: 'short' });
    return `${fmt(days[0])} – ${fmt(days[6])}`;
  }, [days]);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-4 pt-4 pb-2 border-b border-border shrink-0">
        <h2 className="text-body-md font-semibold text-fg">Esta semana</h2>
        <p className="text-body-sm text-fg-muted">{rangeLabel}</p>
      </div>

      {/* Body scrollável */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-1 min-h-0">

        {/* Stats — 3 cards em linha */}
        <div className="flex gap-2 mb-3">
          <StatCard
            label="Total semana"
            value={totalCount}
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

        {/* Hábitos da semana */}
        {p.habits.length > 0 && (
          <CollapsibleSection
            storageKey="week.habits"
            title="🔥 Hábitos da semana"
            meta={`${p.habits.length}`}
          >
            <div className="space-y-1">
              {p.habits.map(h => (
                <HabitWeekHeatmap
                  key={h.id}
                  habitName={h.name}
                  week={h.week}
                  todayIndex={todayIndex}
                  streak={h.current_streak}
                />
              ))}
            </div>
          </CollapsibleSection>
        )}

        {/* Por dia */}
        <CollapsibleSection
          storageKey="week.byday"
          title="📅 Por dia"
        >
          {days.map((day, i) => {
            const dayIso = localYmd(day);
            const isToday = dayIso === todayIso;

            const dayEvents = p.events
              .filter(e => e.start_at.slice(0, 10) === dayIso)
              .sort((a, b) => a.start_at.localeCompare(b.start_at));

            const dayTasks = p.tasks.filter(t => {
              const d = t.scheduled_date ?? t.due_date;
              return d ? d.slice(0, 10) === dayIso : false;
            });

            const itemCount = dayEvents.length + dayTasks.length;

            return (
              <div key={dayIso} className="mb-2">
                {/* Day header */}
                <button
                  type="button"
                  onClick={() => p.onPickDay(day)}
                  className={[
                    'w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-left',
                    'hover:bg-bg-elevated transition-colors focus-ring',
                    isToday ? 'text-tom' : 'text-fg',
                  ].join(' ')}
                >
                  <span className="text-body-sm font-semibold uppercase tracking-wide w-8 shrink-0">
                    {DAY_NAMES[i]}
                  </span>
                  <span className={['text-body-md font-semibold', isToday ? 'text-tom' : 'text-fg'].join(' ')}>
                    {day.getDate()}
                  </span>
                  <span className="text-body-sm text-fg-muted ml-auto shrink-0">
                    {isToday ? `hoje · ${itemCount} ite${itemCount === 1 ? 'm' : 'ns'}` : `${itemCount} ite${itemCount === 1 ? 'm' : 'ns'}`}
                  </span>
                </button>

                {/* Conteúdo do dia */}
                {itemCount > 0 && (
                  <div className="pl-2 space-y-0.5 mt-0.5">
                    {dayEvents.map(e => (
                      <CompactEventRow
                        key={e.id}
                        event={e}
                        onClick={() => p.onEventClick(e)}
                        onToggleDone={() => p.onToggleEventDone(e)}
                      />
                    ))}
                    {dayTasks.map(t => (
                      <CompactTaskRow
                        key={t.id}
                        task={t}
                        onToggle={() => p.onToggleTaskDone(t)}
                        onClick={() => p.onTaskClick(t)}
                      />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </CollapsibleSection>

      </div>
    </div>
  );
}
