// Sprint 11 F2+ / Sessão B — Streak ring: SVG circle preenchido proporcionalmente
// à aderência do hábito nos últimos 30 dias. Cor varia por faixa de aderência.
// Princípio: visual rápido, sem números poluindo. O número fica no label adjacente.
interface Props {
  /** Aderência 0..1 (proporção de dias completados nos últimos 30). */
  adherence: number;
  /** Streak atual em dias (mostrado no centro). */
  streak?: number | null;
  /** Tamanho do ring em px. Default 56 (cabe ao lado do checkbox). */
  size?: number;
  /** Espessura da linha. Default 5. */
  stroke?: number;
  /** Sprint 22.54 — cor do hábito sobrescreve cor por threshold. */
  color?: string | null;
}

function toneFor(adherence: number): { ring: string; text: string } {
  if (adherence >= 0.7) return { ring: 'stroke-success', text: 'text-success' };
  if (adherence >= 0.4) return { ring: 'stroke-warning', text: 'text-warning' };
  if (adherence > 0)    return { ring: 'stroke-danger',  text: 'text-danger' };
  return                       { ring: 'stroke-fg-muted', text: 'text-fg-muted' };
}

export function StreakRing({ adherence, streak, size = 56, stroke = 5, color }: Props) {
  const clamped = Math.max(0, Math.min(1, adherence));
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const dash = c * clamped;
  const tone = toneFor(clamped);

  return (
    <div
      className="relative shrink-0"
      style={{ width: size, height: size }}
      aria-label={`aderência ${Math.round(clamped * 100)}% nos últimos 30 dias`}
    >
      <svg width={size} height={size} className="-rotate-90">
        {/* trilha */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          strokeWidth={stroke}
          className="stroke-border"
        />
        {/* progresso */}
        {clamped > 0 && (
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={`${dash} ${c - dash}`}
            style={color ? { stroke: color } : undefined}
            className={color ? 'transition-[stroke-dasharray] duration-300' : `${tone.ring} transition-[stroke-dasharray] duration-300`}
          />
        )}
      </svg>
      <div className="absolute inset-0 grid place-items-center">
        <div className="text-center leading-tight">
          <div className={`text-body-sm font-semibold tabular-nums ${tone.text}`}>
            {streak && streak > 0 ? `${streak}` : '—'}
          </div>
          {streak && streak > 0 && (
            <div className="text-[9px] uppercase tracking-wide text-fg-muted">
              {streak === 1 ? 'dia' : 'dias'}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
