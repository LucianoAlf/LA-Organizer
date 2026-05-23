import { ChevronLeft, ChevronRight } from 'lucide-react';
import { getMonthGrid } from '../lib/monthGrid';

export interface MiniCalendarProps {
  monthDate: Date;
  selectedDay: Date | null;
  daysWithEvents: Set<string>;
  onMonthChange: (next: Date) => void;
  onDayClick: (day: Date) => void;
}

const WEEKDAYS = ['D','S','T','Q','Q','S','S'];

export function MiniCalendar(p: MiniCalendarProps) {
  const grid = getMonthGrid(p.monthDate);
  const today = new Date();
  const monthLabel = p.monthDate.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
  const month = p.monthDate.getMonth();

  return (
    <div className="px-3 py-3">
      <div className="flex items-center justify-between mb-2">
        <button type="button" className="text-fg-muted hover:text-fg focus-ring rounded p-1"
          onClick={() => p.onMonthChange(new Date(p.monthDate.getFullYear(), month - 1, 1))}>
          <ChevronLeft size={14} />
        </button>
        <div className="text-[12px] font-semibold text-fg capitalize">{monthLabel}</div>
        <button type="button" className="text-fg-muted hover:text-fg focus-ring rounded p-1"
          onClick={() => p.onMonthChange(new Date(p.monthDate.getFullYear(), month + 1, 1))}>
          <ChevronRight size={14} />
        </button>
      </div>
      <div className="grid grid-cols-7 gap-0.5 text-center">
        {WEEKDAYS.map((w, i) => (
          <div key={i} className="text-[10px] text-fg-muted">{w}</div>
        ))}
        {grid.map((d) => {
          const iso = d.toISOString().slice(0, 10);
          const isOtherMonth = d.getMonth() !== month;
          const isToday = sameDay(d, today);
          const isSelected = p.selectedDay && sameDay(d, p.selectedDay);
          const hasEvent = p.daysWithEvents.has(iso);
          return (
            <button
              key={iso}
              type="button"
              onClick={() => p.onDayClick(d)}
              className={[
                'h-7 w-7 grid place-items-center rounded text-[11px] relative focus-ring',
                isOtherMonth ? 'opacity-40' : '',
                isToday ? 'bg-tom text-black font-semibold' : 'text-fg hover:bg-bg-elevated',
                isSelected && !isToday ? 'ring-1 ring-tom' : '',
              ].join(' ')}
            >
              {d.getDate()}
              {hasEvent && !isToday && (
                <span className="absolute bottom-0.5 w-1 h-1 rounded-full bg-tom" />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function sameDay(a: Date, b: Date) {
  return a.getFullYear()===b.getFullYear() && a.getMonth()===b.getMonth() && a.getDate()===b.getDate();
}
