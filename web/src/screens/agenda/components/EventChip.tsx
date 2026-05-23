import type { EventForGrid } from '../hooks/useAgendaEvents';

const CONTEXT_FALLBACK_COLOR = { work: '#A3BE50', personal: '#64748B' } as const;

export function EventChip({ event, onClick }: {
  event: EventForGrid;
  onClick: (e: EventForGrid) => void;
}) {
  const color = event.category_color ?? CONTEXT_FALLBACK_COLOR[event.context];
  const start = new Date(event.start_at);
  const hh = start.getHours();
  const mm = start.getMinutes();
  const hourLabel = mm === 0 ? `${hh}h` : `${String(hh).padStart(2,'0')}:${String(mm).padStart(2,'0')}`;
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onClick(event); }}
      className="w-full flex items-center gap-1 px-1.5 h-[18px] rounded-sm text-left truncate focus-ring"
      style={{ backgroundColor: `${color}26` }}
    >
      <span className="w-1.5 h-1.5 rounded-sm shrink-0" style={{ backgroundColor: color }} />
      <span className="text-[10px] tabular-nums opacity-80 shrink-0">{hourLabel}</span>
      <span className="text-[11px] truncate">{event.title}</span>
    </button>
  );
}
