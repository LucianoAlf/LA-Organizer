import { useState, useRef, useEffect, type ReactNode } from 'react';
import { MapPin } from 'lucide-react';

// ---- Tooltip custom (substitui title= nativo do OS) ------------------------
// CSS-only via group não cobre todos os casos de posicionamento (pins perto
// do topo clipam). Usamos estado + ref pra calcular se abre pra cima ou baixo.
function Tooltip({
  content,
  children,
  className,
  style,
}: {
  content: ReactNode;
  children: ReactNode;
  className?: string;
  style?: React.CSSProperties;
}) {
  const [open, setOpen] = useState(false);
  const [above, setAbove] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  function handleEnter() {
    if (ref.current) {
      const rect = ref.current.getBoundingClientRect();
      setAbove(rect.top < 80); // abre pra baixo se perto do topo
    }
    setOpen(true);
  }

  // Se o caller ja passa absolute/fixed via className, nao adiciona 'relative'
  // (Tailwind: .relative aparece DEPOIS de .absolute no CSS, entao venceria).
  const hasOwnPosition = !!className && /\b(absolute|fixed|sticky)\b/.test(className);
  const baseCls = hasOwnPosition ? '' : 'relative inline-block';
  return (
    <div
      ref={ref}
      className={[baseCls, className].filter(Boolean).join(' ')}
      style={style}
      onMouseEnter={handleEnter}
      onMouseLeave={() => setOpen(false)}
      onFocus={handleEnter}
      onBlur={() => setOpen(false)}
    >
      {children}
      {open && content && (
        <div
          role="tooltip"
          className={[
            'pointer-events-none absolute z-50 left-1/2 -translate-x-1/2',
            'w-max max-w-[220px] px-2.5 py-1.5 rounded-md',
            'bg-bg-elevated2 border border-border shadow-lg',
            'text-[11px] text-fg leading-snug whitespace-pre-wrap text-center',
            above ? 'top-full mt-2' : 'bottom-full mb-2',
          ].join(' ')}
        >
          {content}
        </div>
      )}
    </div>
  );
}

// ---- Tipos -----------------------------------------------------------------
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
  rangeStart: number;
  rangeEnd: number;
  lanes: Array<{ id: string; label: string; sublabel?: string }>;
  markers?: TimelineMarker[];
  onItemClick?: (item: TimelineItem) => void;
  onMarkerClick?: (marker: TimelineMarker) => void;
  laneLabelWidth?: number;
  renderAxis?: (ticks: number[]) => ReactNode;
}

function pct(value: number, min: number, max: number) {
  return Math.max(0, Math.min(100, ((value - min) / (max - min)) * 100));
}

// ---- Componente principal --------------------------------------------------
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
      <div className="flex border-b border-border shrink-0 bg-bg-elevated">
        <div
          className="shrink-0 px-3 py-2 border-r border-border text-[11px] uppercase tracking-wider text-fg-muted font-semibold"
          style={{ width: laneLabelWidth }}
        >
          Projeto
        </div>
        <div className="flex-1 relative h-9">
          {renderAxis ? renderAxis(ticks) : (
            ticks.map((t, i) => (
              <div
                key={i}
                className="absolute top-0 bottom-0 flex items-center text-[10px] text-fg-muted border-l border-border/40 pl-1.5"
                style={{ left: `${pct(t, rangeStart, rangeEnd)}%` }}
              >
                {new Date(t).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })}
              </div>
            ))
          )}
        </div>
      </div>

      {/* Lanes */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {lanes.map((lane, laneIdx) => {
          const laneItems = items.filter(it => (it.lane ?? 'default') === lane.id);
          const laneMarkers = markers.filter(m => m.lane === lane.id);
          const isLast = laneIdx === lanes.length - 1;
          return (
            <div
              key={lane.id}
              className={[
                'flex',
                isLast ? 'border-b border-border' : 'border-b border-border/50',
                laneIdx % 2 === 1 ? 'bg-bg-elevated/30' : '',
              ].join(' ')}
            >
              {/* Label da lane */}
              <div
                className="shrink-0 px-3 py-3 border-r border-border"
                style={{ width: laneLabelWidth }}
              >
                <div className="text-[12px] font-semibold text-fg truncate">{lane.label}</div>
                {lane.sublabel && (
                  <div className="text-[10px] text-fg-muted truncate mt-0.5">{lane.sublabel}</div>
                )}
              </div>

              {/* Área de barras + pins. Sem overflow-hidden — o tooltip dos pins
                  precisa transbordar verticalmente, e o filtro de range ja garante
                  que pins fora do periodo nao renderizam (evita stack no left=0). */}
              <div className="flex-1 relative h-16">
                {/* Grid lines verticais alinhadas aos ticks */}
                {ticks.map((t, i) => (
                  <div
                    key={i}
                    className="absolute top-0 bottom-0 border-l border-border/25 pointer-events-none"
                    style={{ left: `${pct(t, rangeStart, rangeEnd)}%` }}
                  />
                ))}

                {/* Barras de items */}
                {laneItems.map(item => {
                  const left = pct(item.start, rangeStart, rangeEnd);
                  const right = pct(item.end, rangeStart, rangeEnd);
                  const width = Math.max(2, right - left);
                  return (
                    <Tooltip
                      key={item.id}
                      content={item.label}
                      className="absolute top-1/2 -translate-y-1/2"
                      style={{ left: `${left}%`, width: `${width}%` }}
                    >
                      <button
                        type="button"
                        onClick={() => onItemClick?.(item)}
                        className="block w-full h-7 rounded-md px-2 text-[11px] font-semibold text-white truncate text-left hover:opacity-85 transition-opacity focus-ring"
                        style={{ backgroundColor: item.color ?? '#A3BE50' }}
                      >
                        {item.label}
                      </button>
                    </Tooltip>
                  );
                })}

                {/* Markers (pins de checkpoint) — so renderiza pins dentro do range visivel.
                    Pins com data fora do range nao aparecem (evita stack no left=0 ou right=100%). */}
                {laneMarkers
                  .filter(m => m.date >= rangeStart && m.date <= rangeEnd)
                  .map(m => {
                  const tooltipText = m.label
                    ? `${m.label}\n${new Date(m.date).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: '2-digit' })}`
                    : new Date(m.date).toLocaleDateString('pt-BR');
                  return (
                    <Tooltip
                      key={m.id}
                      content={tooltipText}
                      className="absolute z-20"
                      style={{
                        left: `${pct(m.date, rangeStart, rangeEnd)}%`,
                        top: '50%',
                        transform: 'translate(-50%, calc(-50% - 18px))',
                      }}
                    >
                      <button
                        type="button"
                        onClick={() => onMarkerClick?.(m)}
                        className="grid place-items-center hover:scale-110 transition-transform focus-ring rounded"
                        style={{ filter: 'drop-shadow(0 1px 3px rgba(0,0,0,0.55))' }}
                      >
                        <MapPin
                          size={18}
                          strokeWidth={2.4}
                          fill={m.done ? '#22C55E' : '#EF4444'}
                          className={m.done ? 'text-success' : 'text-danger'}
                        />
                      </button>
                    </Tooltip>
                  );
                })}
              </div>
            </div>
          );
        })}

        {/* Linha de fechamento no fundo + espaço respirável */}
        {lanes.length === 0 && (
          <div className="flex items-center justify-center h-32 text-fg-muted text-body-sm">
            Nenhum projeto com datas definidas.
          </div>
        )}
      </div>
    </div>
  );
}
