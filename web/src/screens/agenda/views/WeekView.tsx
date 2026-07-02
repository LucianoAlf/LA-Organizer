import { TimeGrid } from '../components/TimeGrid';
import type { EventForGrid } from '../hooks/useAgendaEvents';
import type { TaskForPanel } from '../hooks/useAgendaTasks';

export interface WeekViewProps {
  weekStart: Date;
  events: EventForGrid[];
  tasks?: TaskForPanel[];
  onSlotClick: (date: Date) => void;
  onEventClick: (event: EventForGrid) => void;
  onEventDrop: (event: EventForGrid, newStart: Date) => void;
  onEventResize: (event: EventForGrid, newDurationMs: number) => void;
  onTaskClick?: (task: TaskForPanel) => void;
}

export function WeekView(p: WeekViewProps) {
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(p.weekStart); d.setDate(p.weekStart.getDate() + i); return d;
  });
  return (
    <div className="flex flex-col h-full bg-bg-surface">
      <TimeGrid
        days={days} events={p.events} tasks={p.tasks}
        onSlotClick={p.onSlotClick} onEventClick={p.onEventClick}
        onEventDrop={p.onEventDrop} onEventResize={p.onEventResize}
        onTaskClick={p.onTaskClick}
      />
    </div>
  );
}
