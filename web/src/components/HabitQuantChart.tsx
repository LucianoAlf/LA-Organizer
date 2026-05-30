// Gráfico de histórico de hábito QUANTITATIVO — valor por dia vs meta.
// Estilo alinhado ao DS (mesma linha do FinanceCharts): sem grid pesado, tooltip
// discreta com tokens, cor do hábito atravessando o Recharts via hex/string.
import {
  ResponsiveContainer,
  BarChart, Bar, Cell, XAxis, Tooltip, ReferenceLine,
} from 'recharts';

export type HabitQuantPoint = {
  /** Rótulo curto dd/mm. */
  label: string;
  /** Valor registrado no dia. */
  value: number;
  /** Bateu a meta nesse dia? (cor cheia vs esmaecida). */
  hit: boolean;
};

function fmt(n: number) {
  return (Number(n) || 0).toLocaleString('pt-BR', { maximumFractionDigits: 2 });
}

function ChartTooltip(
  { active, payload, target, unit }:
  { active?: boolean; payload?: { payload?: HabitQuantPoint }[]; target: number; unit: string },
) {
  if (!active || !payload || payload.length === 0) return null;
  const d = payload[0].payload;
  if (!d) return null;
  return (
    <div className="rounded-md border border-border bg-bg-surface shadow-card px-2.5 py-1.5 text-body-sm">
      <div className="text-fg-muted mb-0.5">{d.label}</div>
      <div className="tabular-nums">
        <span className={d.hit ? 'text-success font-semibold' : 'text-fg'}>{fmt(d.value)}</span>
        <span className="text-fg-muted"> / {fmt(target)} {unit}</span>
      </div>
    </div>
  );
}

interface Props {
  data: HabitQuantPoint[];
  target: number;
  unit: string;
  color: string;
}

export function HabitQuantChart({ data, target, unit, color }: Props) {
  return (
    <ResponsiveContainer width="100%" height={160}>
      <BarChart data={data} margin={{ top: 8, right: 4, bottom: 0, left: 4 }} barCategoryGap="20%">
        <XAxis
          dataKey="label"
          tickLine={false}
          axisLine={false}
          interval="preserveStartEnd"
          minTickGap={18}
          tick={{ fontSize: 10, fill: '#94a3b8' }}
        />
        {target > 0 && (
          <ReferenceLine
            y={target}
            stroke="#94a3b8"
            strokeDasharray="4 4"
            ifOverflow="extendDomain"
          />
        )}
        <Tooltip
          cursor={{ fill: '#94a3b8', opacity: 0.15 }}
          content={<ChartTooltip target={target} unit={unit} />}
        />
        <Bar dataKey="value" radius={[3, 3, 0, 0]} maxBarSize={28}>
          {data.map((d, i) => (
            <Cell key={i} fill={color} fillOpacity={d.hit ? 1 : 0.45} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
