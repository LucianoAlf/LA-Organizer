interface Props {
  habitName: string;
  /** 7 valores Dom→Sáb indicando se o hábito foi marcado naquele dia. */
  week: boolean[];
  /** Índice 0-6 do dia "hoje" (pra destacar). null se a semana atual não contém hoje. */
  todayIndex: number | null;
  streak?: number;
}

const DAY_LABELS = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'] as const;

export function HabitWeekHeatmap({ habitName, week, todayIndex, streak }: Props) {
  return (
    <div className="flex items-center gap-2 py-1 text-[11px]">
      <span className="flex-1 text-fg truncate">{habitName}</span>
      <div className="flex gap-[3px]">
        {week.map((done, i) => {
          const isToday = i === todayIndex;
          const base = 'w-[14px] h-[14px] rounded-[3px] grid place-items-center text-[8px] font-medium';
          const fill = done ? 'bg-tom text-black' : 'bg-bg-elevated text-fg-muted/50';
          const ring = isToday ? ' outline outline-[1.5px] outline-tom outline-offset-[1px]' : '';
          return (
            <span key={i} className={`${base} ${fill}${ring}`}>{DAY_LABELS[i]}</span>
          );
        })}
      </div>
      {streak != null && streak > 0 && (
        <span className="text-[11px] text-warning font-semibold tabular-nums">🔥 {streak}</span>
      )}
    </div>
  );
}
