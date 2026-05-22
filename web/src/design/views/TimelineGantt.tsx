import type { ReactNode } from 'react';

export interface TimelineItem {
  id: string;
  label: string;
  /** Início em ms (Date.getTime()). */
  start: number;
  /** Fim em ms. */
  end: number;
  /** Lane (linha) — se omitido, usa 'default'. */
  lane?: string;
  /** Cor de destaque da barra (hex/rgb). Default: tom. */
  color?: string;
}

interface TimelineGanttProps {
  items: TimelineItem[];
  /** Início do range visível em ms. */
  rangeStart: number;
  /** Fim do range visível em ms. */
  rangeEnd: number;
  /** Ordem das lanes. */
  lanes: Array<{ id: string; label: string }>;
  /** Callback ao clicar em um item. */
  onItemClick?: (item: TimelineItem) => void;
  /** Renderiza markers do eixo X. Recebe array de timestamps. */
  renderAxis?: (ticks: number[]) => ReactNode;
}

function pct(value: number, min: number, max: number) {
  return Math.max(0, Math.min(100, ((value - min) / (max - min)) * 100));
}

export function TimelineGantt({
  items,
  rangeStart,
  rangeEnd,
  lanes,
  onItemClick,
  renderAxis,
}: TimelineGanttProps) {
  const ticks: number[] = [];
  const step = (rangeEnd - rangeStart) / 6;
  for (let i = 0; i <= 6; i++) ticks.push(rangeStart + step * i);

  return (
    <div className="flex flex-col h-full border border-border rounded-lg overflow-hidden bg-bg-surface">
      {/* Axis header */}
      <div className="flex border-b border-border shrink-0">
        <div className="w-40 shrink-0 px-3 py-2 border-r border-border text-[11px] uppercase tracking-wider text-fg-muted font-semibold">
          Lane
        </div>
        <div className="flex-1 relative h-9">
          {renderAxis ? (
            renderAxis(ticks)
          ) : (
            ticks.map((t, i) => (
              <div
                key={i}
                className="absolute top-0 bottom-0 flex items-center text-[10px] text-fg-muted border-l border-border/50 pl-1"
                style={{ left: `${pct(t, rangeStart, rangeEnd)}%` }}
              >
                {new Date(t).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })}
              </div>
            ))
          )}
        </div>
      </div>
      {/* Lanes */}
      <div className="flex-1 overflow-y-auto">
        {lanes.map(lane => {
          const laneItems = items.filter(it => (it.lane ?? 'default') === lane.id);
          return (
            <div key={lane.id} className="flex border-b border-border/50 last:border-b-0">
              <div className="w-40 shrink-0 px-3 py-3 border-r border-border text-[12px] font-medium text-fg-secondary truncate">
                {lane.label}
              </div>
              <div className="flex-1 relative h-12">
                {laneItems.map(item => {
                  const left = pct(item.start, rangeStart, rangeEnd);
                  const right = pct(item.end, rangeStart, rangeEnd);
                  const width = Math.max(2, right - left);
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => onItemClick?.(item)}
                      title={item.label}
                      className="absolute top-1/2 -translate-y-1/2 h-7 rounded-md px-2 text-[11px] font-medium text-white truncate text-left hover:opacity-90 transition-opacity focus-ring"
                      style={{
                        left: `${left}%`,
                        width: `${width}%`,
                        backgroundColor: item.color ?? '#A3BE50',
                      }}
                    >
                      {item.label}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
