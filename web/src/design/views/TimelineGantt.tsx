import type { ReactNode } from 'react';
import { MapPin } from 'lucide-react';

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

export interface TimelineMarker {
  id: string;
  /** Lane onde o marker aparece. */
  lane: string;
  /** Data do marker em ms. */
  date: number;
  /** Tooltip ao hover. */
  label?: string;
  /** True = concluído (verde); false = pendente (vermelho). */
  done?: boolean;
}

interface TimelineGanttProps {
  items: TimelineItem[];
  /** Início do range visível em ms. */
  rangeStart: number;
  /** Fim do range visível em ms. */
  rangeEnd: number;
  /** Ordem das lanes. */
  lanes: Array<{ id: string; label: string; sublabel?: string }>;
  /** Markers/pins ao longo das lanes (ex: checkpoints, prazos). */
  markers?: TimelineMarker[];
  /** Callback ao clicar em uma barra de item. */
  onItemClick?: (item: TimelineItem) => void;
  /** Callback ao clicar em um marker. */
  onMarkerClick?: (marker: TimelineMarker) => void;
  /** Largura da coluna de labels das lanes. */
  laneLabelWidth?: number;
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
  markers = [],
  onItemClick,
  onMarkerClick,
  laneLabelWidth = 224,
  renderAxis,
}: TimelineGanttProps) {
  const ticks: number[] = [];
  const step = (rangeEnd - rangeStart) / 6;
  for (let i = 0; i <= 6; i++) ticks.push(rangeStart + step * i);

  return (
    <div className="flex flex-col h-full border border-border rounded-lg overflow-hidden bg-bg-surface">
      {/* Axis header */}
      <div className="flex border-b border-border shrink-0">
        <div
          className="shrink-0 px-3 py-2 border-r border-border text-[11px] uppercase tracking-wider text-fg-muted font-semibold"
          style={{ width: laneLabelWidth }}
        >
          Projeto
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
          const laneMarkers = markers.filter(m => m.lane === lane.id);
          return (
            <div key={lane.id} className="flex border-b border-border/50 last:border-b-0">
              <div
                className="shrink-0 px-3 py-3 border-r border-border text-[12px] font-medium text-fg-secondary"
                style={{ width: laneLabelWidth }}
              >
                <div className="truncate text-fg">{lane.label}</div>
                {lane.sublabel && (
                  <div className="text-[10px] text-fg-muted truncate mt-0.5">{lane.sublabel}</div>
                )}
              </div>
              <div className="flex-1 relative h-14">
                {/* Barras de items */}
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
                {/* Markers (pins/checkpoints) — espetados acima da barra. A ponta
                    do pin (parte de baixo do ícone) toca o topo da barra. */}
                {laneMarkers.map(m => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => onMarkerClick?.(m)}
                    title={
                      m.label
                        ? `${m.label} · ${new Date(m.date).toLocaleDateString('pt-BR')}`
                        : new Date(m.date).toLocaleDateString('pt-BR')
                    }
                    className="absolute z-20 grid place-items-center hover:scale-110 transition-transform focus-ring rounded"
                    style={{
                      left: `${pct(m.date, rangeStart, rangeEnd)}%`,
                      top: '50%',
                      transform: 'translate(-50%, calc(-50% - 18px))',
                      filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.6))',
                    }}
                  >
                    <MapPin
                      size={18}
                      strokeWidth={2.4}
                      fill={m.done ? '#22C55E' : '#EF4444'}
                      className={m.done ? 'text-success' : 'text-danger'}
                    />
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
