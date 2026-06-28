import { getMonthGrid } from '../lib/monthGrid';
import { buildMonthDayMap, CHIP_TONE_CLASS } from '../../../lib/monthChips';
import { todaySP } from '../../../utils/date';
import type { TaskForPanel } from '../hooks/useAgendaTasks';
import type { EventForGrid } from '../hooks/useAgendaEvents';

const WEEKDAYS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];

function ymdLocal(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

interface Props {
  monthDate: Date;
  tasks: TaskForPanel[];
  events: EventForGrid[];
  onDayClick: (ymd: string) => void;
}

export function MonthGrid({ monthDate, tasks, events, onDayClick }: Props) {
  const todayYmd = todaySP();
  const grid = getMonthGrid(monthDate);
  const byDay = buildMonthDayMap(tasks, events, todayYmd);
  const curMonth = monthDate.getMonth();

  return (
    <div className="surface overflow-hidden">
      <div className="grid grid-cols-7 border-b border-border">
        {WEEKDAYS.map(w => (
          <div key={w} className="py-2 text-center text-[11px] text-fg-muted">{w}</div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {grid.map(d => {
          const ymd = ymdLocal(d);
          const inMonth = d.getMonth() === curMonth;
          const isToday = ymd === todayYmd;
          const chips = byDay.get(ymd) ?? [];
          return (
            <button
              type="button"
              key={ymd}
              onClick={() => onDayClick(ymd)}
              className="min-h-[74px] p-1 text-left align-top border-b border-r border-border/40 focus-ring"
            >
              <div className="text-center mb-1">
                {isToday ? (
                  <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-tom text-black text-[13px] font-semibold tabular-nums">
                    {d.getDate()}
                  </span>
                ) : (
                  <span className={['text-[13px] tabular-nums', inMonth ? 'text-fg' : 'text-fg-muted/50'].join(' ')}>
                    {d.getDate()}
                  </span>
                )}
              </div>
              <div className="space-y-0.5">
                {chips.slice(0, 3).map(c => (
                  <div key={c.id} className={['text-[11px] leading-tight rounded px-1 truncate', CHIP_TONE_CLASS[c.tone]].join(' ')}>
                    {c.label}
                  </div>
                ))}
                {chips.length > 3 && (
                  <div className="text-[11px] text-fg-muted pl-0.5">+{chips.length - 3}</div>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
