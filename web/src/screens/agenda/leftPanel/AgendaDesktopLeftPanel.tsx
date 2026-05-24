import { DayPanel } from './DayPanel';
import { WeekPanel } from './WeekPanel';
import { MonthPanel } from './MonthPanel';
import type { TaskForPanel } from '../hooks/useAgendaTasks';
import type { EventForGrid } from '../hooks/useAgendaEvents';

interface Habit { id: string; name: string; done_today: boolean; current_streak: number; }
interface HabitWithWeek { id: string; name: string; week: boolean[]; current_streak: number; }

interface Props {
  view: 'day' | 'week' | 'month';
  currentDate: Date;
  weekStart: Date;
  monthDate: Date;
  selectedMonthDay: Date | null;

  tasks: TaskForPanel[];
  events: EventForGrid[];
  habitsDay: Habit[];
  habitsWeek: HabitWithWeek[];

  onTaskClick: (t: TaskForPanel) => void;
  onToggleTaskDone: (t: TaskForPanel) => void;
  onEventClick: (e: EventForGrid) => void;
  onToggleEventDone: (e: EventForGrid) => void;
  onToggleHabit: (h: Habit) => void;

  onPickDay: (d: Date) => void;
  onClearSelectedDay: () => void;
  onOpenDayView: (d: Date) => void;
}

export function AgendaDesktopLeftPanel(p: Props) {
  return (
    <aside className="w-[400px] shrink-0 border-r border-border bg-bg-surface flex flex-col min-h-0 max-md:hidden">
      {p.view === 'day' && (
        <DayPanel
          currentDate={p.currentDate}
          tasks={p.tasks}
          events={p.events}
          habits={p.habitsDay}
          onTaskClick={p.onTaskClick}
          onToggleTaskDone={p.onToggleTaskDone}
          onEventClick={p.onEventClick}
          onToggleEventDone={p.onToggleEventDone}
          onToggleHabit={p.onToggleHabit}
        />
      )}
      {p.view === 'week' && (
        <WeekPanel
          weekStart={p.weekStart}
          currentDate={p.currentDate}
          tasks={p.tasks}
          events={p.events}
          habits={p.habitsWeek}
          onTaskClick={p.onTaskClick}
          onToggleTaskDone={p.onToggleTaskDone}
          onEventClick={p.onEventClick}
          onToggleEventDone={p.onToggleEventDone}
          onPickDay={p.onPickDay}
        />
      )}
      {p.view === 'month' && (
        <MonthPanel
          monthDate={p.monthDate}
          selectedDay={p.selectedMonthDay}
          tasks={p.tasks}
          events={p.events}
          onTaskClick={p.onTaskClick}
          onToggleTaskDone={p.onToggleTaskDone}
          onEventClick={p.onEventClick}
          onToggleEventDone={p.onToggleEventDone}
          onClearSelectedDay={p.onClearSelectedDay}
          onOpenDayView={p.onOpenDayView}
        />
      )}
    </aside>
  );
}
