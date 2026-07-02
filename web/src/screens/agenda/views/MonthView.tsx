import { useMemo } from 'react';
import { getMonthGrid } from '../lib/monthGrid';
import { buildMonthDayMap, CHIP_TONE_CLASS } from '../../../lib/monthChips';
import { localYmd, todaySP } from '../../../utils/date';
import type { EventForGrid } from '../hooks/useAgendaEvents';
import type { TaskForPanel } from '../hooks/useAgendaTasks';

const WEEKDAYS = ['DOM','SEG','TER','QUA','QUI','SEX','SÁB'];

export interface MonthViewProps {
  monthDate: Date;
  events: EventForGrid[];
  tasks: TaskForPanel[];
  onDayClick: (date: Date) => void;
  onEventClick: (event: EventForGrid) => void;
  onTaskClick: (task: TaskForPanel) => void;
}

export function MonthView(p: MonthViewProps) {
  const grid = useMemo(() => getMonthGrid(p.monthDate), [p.monthDate]);
  const month = p.monthDate.getMonth();
  const today = new Date();
  // Paridade com o mobile (MonthGrid): tarefas + eventos no MESMO mapa de chips,
  // bucketizado no fuso de SP (buildMonthDayMap → ymdInSP) — sem o shift de UTC que o
  // toISOString().slice(0,10) causava (evento pós-21h BRT caía no dia seguinte da grade).
  const byDay = useMemo(() => buildMonthDayMap(p.tasks, p.events, todaySP()), [p.tasks, p.events]);
  const eventById = useMemo(() => new Map(p.events.map(e => [e.id, e])), [p.events]);
  const taskById = useMemo(() => new Map(p.tasks.map(t => [t.id, t])), [p.tasks]);

  return (
    <div className="flex flex-col h-full bg-bg-surface">
      <div className="grid grid-cols-7 border-b border-border sticky top-0 bg-bg-elevated z-10">
        {WEEKDAYS.map(w => (
          <div key={w} className="text-[10px] uppercase tracking-wider text-fg-muted text-center py-2">{w}</div>
        ))}
      </div>
      <div className="grid grid-cols-7 grid-rows-6 flex-1 min-h-0">
        {grid.map((d) => {
          const iso = localYmd(d);
          const chips = byDay.get(iso) ?? [];
          const isOther = d.getMonth() !== month;
          const isToday = sameDay(d, today);
          const visibleCap = 3;
          const visible = chips.slice(0, visibleCap);
          const overflow = chips.length - visible.length;
          return (
            <div
              key={iso}
              className={[
                'border-r border-b border-border/40 p-1 flex flex-col gap-0.5 min-h-[100px] overflow-hidden cursor-pointer',
                isOther ? 'opacity-40' : '',
              ].join(' ')}
              onClick={(e) => {
                if (e.target === e.currentTarget) p.onDayClick(d);
              }}
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
              {visible.map(chip => (
                <button
                  key={chip.id}
                  type="button"
                  title={chip.label}
                  className={['text-[11px] leading-tight rounded px-1 truncate text-left focus-ring', CHIP_TONE_CLASS[chip.tone]].join(' ')}
                  onClick={(e) => {
                    e.stopPropagation();
                    // chip.id = `e-<uuid>` (evento) ou `t-<uuid>` (tarefa) — desprefixa e roteia.
                    const rawId = chip.id.slice(2);
                    if (chip.kind === 'event') {
                      const ev = eventById.get(rawId);
                      if (ev) p.onEventClick(ev);
                    } else {
                      const t = taskById.get(rawId);
                      if (t) p.onTaskClick(t);
                    }
                  }}
                >
                  {chip.label}
                </button>
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
