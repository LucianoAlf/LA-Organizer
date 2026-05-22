import type { ReactNode } from 'react';

export interface CalendarItem {
  id: string;
  /** Data em formato YYYY-MM-DD. */
  date: string;
  label: string;
  color?: string;
}

interface MonthCalendarProps {
  /** Ano. */
  year: number;
  /** Mês (1-12). */
  month: number;
  items: CalendarItem[];
  onDayClick?: (date: string) => void;
  renderItem?: (item: CalendarItem) => ReactNode;
}

const WEEK_LABELS = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];

function formatDate(year: number, month: number, day: number): string {
  const m = String(month).padStart(2, '0');
  const d = String(day).padStart(2, '0');
  return `${year}-${m}-${d}`;
}

export function MonthCalendar({
  year,
  month,
  items,
  onDayClick,
  renderItem,
}: MonthCalendarProps) {
  const firstOfMonth = new Date(year, month - 1, 1);
  const lastOfMonth = new Date(year, month, 0);
  const daysInMonth = lastOfMonth.getDate();

  // JS getDay: 0=Dom..6=Sáb. Convertemos para 0=Seg..6=Dom.
  const firstWeekday = (firstOfMonth.getDay() + 6) % 7;

  const cells: Array<{ date: string; day: number; inMonth: boolean }> = [];
  // Padding inicial
  for (let i = 0; i < firstWeekday; i++) {
    cells.push({ date: '', day: 0, inMonth: false });
  }
  // Dias do mês
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push({ date: formatDate(year, month, d), day: d, inMonth: true });
  }
  // Padding final pra completar última semana
  while (cells.length % 7 !== 0) {
    cells.push({ date: '', day: 0, inMonth: false });
  }

  const itemsByDate = new Map<string, CalendarItem[]>();
  items.forEach(it => {
    const list = itemsByDate.get(it.date) ?? [];
    list.push(it);
    itemsByDate.set(it.date, list);
  });

  return (
    <div className="border border-border rounded-lg overflow-hidden bg-bg-surface flex flex-col h-full">
      <div className="grid grid-cols-7 border-b border-border bg-bg-elevated shrink-0">
        {WEEK_LABELS.map(w => (
          <div
            key={w}
            className="px-2 py-2 text-[10px] uppercase tracking-wider text-fg-muted font-semibold text-center"
          >
            {w}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 grid-rows-[repeat(auto-fill,minmax(100px,1fr))] flex-1 min-h-0">
        {cells.map((cell, i) => (
          <div
            key={i}
            onClick={cell.inMonth && onDayClick ? () => onDayClick(cell.date) : undefined}
            className={[
              'border-r border-b border-border/50 p-2 min-h-[100px] flex flex-col gap-1',
              cell.inMonth ? '' : 'bg-bg-app/40',
              cell.inMonth && onDayClick ? 'cursor-pointer hover:bg-bg-elevated/50 transition-colors' : '',
            ].join(' ')}
          >
            {cell.inMonth && (
              <>
                <span className="text-[11px] font-semibold text-fg-muted tabular-nums">{cell.day}</span>
                <div className="flex-1 space-y-0.5 overflow-hidden">
                  {(itemsByDate.get(cell.date) ?? []).slice(0, 3).map(item => (
                    <div key={item.id}>
                      {renderItem ? (
                        renderItem(item)
                      ) : (
                        <div
                          className="text-[10px] px-1.5 py-0.5 rounded truncate text-white font-medium"
                          style={{ backgroundColor: item.color ?? '#A3BE50' }}
                        >
                          {item.label}
                        </div>
                      )}
                    </div>
                  ))}
                  {(itemsByDate.get(cell.date)?.length ?? 0) > 3 && (
                    <div className="text-[10px] text-fg-muted">
                      +{(itemsByDate.get(cell.date)?.length ?? 0) - 3} mais
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
