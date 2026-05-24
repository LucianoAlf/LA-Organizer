import { TimeGrid } from '../components/TimeGrid';
import type { EventForGrid } from '../hooks/useAgendaEvents';

export interface DayViewProps {
  date: Date;
  events: EventForGrid[];
  onSlotClick: (date: Date) => void;
  onEventClick: (event: EventForGrid) => void;
  onEventDrop: (event: EventForGrid, newStart: Date) => void;
  onEventResize: (event: EventForGrid, newDurationMs: number) => void;
}

export function DayView(p: DayViewProps) {
  return (
    <div className="flex flex-col h-full bg-bg-surface">
      <TimeGrid
        days={[p.date]} events={p.events}
        onSlotClick={p.onSlotClick} onEventClick={p.onEventClick}
        onEventDrop={p.onEventDrop} onEventResize={p.onEventResize}
      />
    </div>
  );
}
