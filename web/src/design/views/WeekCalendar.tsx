import type { ReactNode } from 'react';

export interface WeekItem {
  id: string;
  /** Início em ms (Date.getTime()). */
  start: number;
  /** Fim em ms. */
  end: number;
  label: string;
  color?: string;
}

interface WeekCalendarProps {
  /** Início da semana (segunda-feira) em ms. */
  weekStart: number;
  items: WeekItem[];
  onItemClick?: (item: WeekItem) => void;
  /** Hora inicial visível (0-23). Default: 6. */
  hourStart?: number;
  /** Hora final visível (0-23). Default: 22. */
  hourEnd?: number;
}

const DAY_LABELS = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];
const MS_DAY = 24 * 60 * 60 * 1000;

export function WeekCalendar({
  weekStart,
  items,
  onItemClick,
  hourStart = 6,
  hourEnd = 22,
}: WeekCalendarProps) {
  const hours: number[] = [];
  for (let h = hourStart; h <= hourEnd; h++) hours.push(h);
  const totalHours = hourEnd - hourStart;

  const days = DAY_LABELS.map((label, i) => {
    const dayStart = weekStart + i * MS_DAY;
    const dayEnd = dayStart + MS_DAY;
    const date = new Date(dayStart);
    return {
      label,
      dayNumber: date.getDate(),
      dayStart,
      dayEnd,
      items: items.filter(it => it.start < dayEnd && it.end > dayStart),
    };
  });

  function itemPosition(item: WeekItem, dayStart: number): { top: number; height: number } {
    const itemStart = Math.max(item.start, dayStart);
    const itemEnd = Math.min(item.end, dayStart + MS_DAY);
    const dayStartMs = dayStart + hourStart * 60 * 60 * 1000;
    const dayTotalMs = totalHours * 60 * 60 * 1000;
    const top = Math.max(0, ((itemStart - dayStartMs) / dayTotalMs) * 100);
    const height = Math.max(2, ((itemEnd - itemStart) / dayTotalMs) * 100);
    return { top, height };
  }

  return (
    <div className="border border-border rounded-lg overflow-hidden bg-bg-surface flex flex-col h-full">
      <div className="grid border-b border-border bg-bg-elevated shrink-0" style={{ gridTemplateColumns: '60px repeat(7, 1fr)' }}>
        <div />
        {days.map((d, i) => (
          <div key={i} className="px-2 py-2 text-center border-l border-border/50">
            <div className="text-[10px] uppercase tracking-wider text-fg-muted font-semibold">{d.label}</div>
            <div className="text-[14px] font-bold text-fg tabular-nums">{d.dayNumber}</div>
          </div>
        ))}
      </div>
      <div className="flex-1 overflow-y-auto">
        <div className="grid relative" style={{ gridTemplateColumns: '60px repeat(7, 1fr)', gridAutoRows: '48px' }}>
          {hours.map(h => (
            <div key={`label-${h}`} className="border-r border-b border-border/50 text-[10px] text-fg-muted px-2 py-1 tabular-nums" style={{ gridColumn: 1 }}>
              {String(h).padStart(2, '0')}:00
            </div>
          ))}
          {days.map((d, i) => (
            <div key={`col-${i}`} className="relative border-l border-border/50" style={{ gridColumn: i + 2, gridRow: `1 / span ${hours.length}` }}>
              {hours.map((_, hi) => (
                <div key={hi} className="border-b border-border/50" style={{ height: '48px' }} />
              ))}
              {d.items.map(item => {
                const { top, height } = itemPosition(item, d.dayStart);
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => onItemClick?.(item)}
                    title={item.label}
                    className="absolute left-1 right-1 rounded-md px-2 py-1 text-[10px] font-medium text-white text-left overflow-hidden hover:opacity-90 transition-opacity focus-ring"
                    style={{
                      top: `${top}%`,
                      height: `${height}%`,
                      backgroundColor: item.color ?? '#A3BE50',
                    }}
                  >
                    {item.label}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
