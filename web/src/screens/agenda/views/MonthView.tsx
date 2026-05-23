import { useMemo } from 'react';
import { getMonthGrid } from '../lib/monthGrid';
import { EventChip } from '../components/EventChip';
import type { EventForGrid } from '../hooks/useAgendaEvents';

const WEEKDAYS = ['DOM','SEG','TER','QUA','QUI','SEX','SÁB'];

export interface MonthViewProps {
  monthDate: Date;
  events: EventForGrid[];
  selectedDay: Date | null;
  onDayClick: (date: Date) => void;
  onDayDoubleClick: (date: Date) => void;
  onEventClick: (event: EventForGrid) => void;
  onEmptyAreaClick: (date: Date) => void;
}

export function MonthView(p: MonthViewProps) {
  const grid = useMemo(() => getMonthGrid(p.monthDate), [p.monthDate]);
  const month = p.monthDate.getMonth();
  const today = new Date();
  const byDay = useMemo(() => {
    const map = new Map<string, EventForGrid[]>();
    for (const ev of p.events) {
      const key = new Date(ev.start_at).toISOString().slice(0, 10);
      const existing = map.get(key);
      if (existing) existing.push(ev);
      else map.set(key, [ev]);
    }
    return map;
  }, [p.events]);

  return (
    <div className="flex flex-col h-full bg-bg-surface">
      <div className="grid grid-cols-7 border-b border-border sticky top-0 bg-bg-elevated z-10">
        {WEEKDAYS.map(w => (
          <div key={w} className="text-[10px] uppercase tracking-wider text-fg-muted text-center py-2">{w}</div>
        ))}
      </div>
      <div className="grid grid-cols-7 grid-rows-6 flex-1 min-h-0">
        {grid.map((d) => {
          const iso = d.toISOString().slice(0, 10);
          const events = byDay.get(iso) ?? [];
          const isOther = d.getMonth() !== month;
          const isToday = sameDay(d, today);
          const isSelected = p.selectedDay && sameDay(d, p.selectedDay);
          const visibleCap = 3;
          const visible = events.slice(0, visibleCap);
          const overflow = events.length - visible.length;
          return (
            <div
              key={iso}
              className={[
                'border-r border-b border-border/40 p-1 flex flex-col gap-0.5 min-h-[100px] cursor-pointer',
                isOther ? 'opacity-40' : '',
                isSelected ? 'bg-tom/5 ring-1 ring-tom/40 ring-inset' : '',
              ].join(' ')}
              onClick={(e) => {
                if (e.target === e.currentTarget) p.onEmptyAreaClick(d);
              }}
              onDoubleClick={() => p.onDayDoubleClick(d)}
            >
              <button
                type="button"
                className={[
                  'self-start w-6 h-6 grid place-items-center text-[11px] tabular-nums rounded-full focus-ring',
                  isToday ? 'bg-tom text-black font-semibold' : 'text-fg hover:bg-bg-elevated',
                ].join(' ')}
                onClick={(e) => { e.stopPropagation(); p.onDayClick(d); }}
              >
                {d.getDate()}
              </button>
              {visible.map(ev => (
                <EventChip key={ev.id} event={ev} onClick={p.onEventClick} />
              ))}
              {overflow > 0 && (
                <button
                  type="button"
                  className="text-[10px] text-fg-muted text-left px-1 hover:text-fg focus-ring rounded"
                  onClick={(e) => { e.stopPropagation(); p.onDayClick(d); }}
                >
                  +{overflow} mais
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function sameDay(a: Date, b: Date) {
  return a.getFullYear()===b.getFullYear() && a.getMonth()===b.getMonth() && a.getDate()===b.getDate();
}
