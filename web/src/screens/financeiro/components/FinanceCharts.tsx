// Recharts customizado pra evitar visual genérico:
// - Sem grid pesado (apenas eixo X e ponteiro de hover)
// - Paleta limitada e harmonizada com o DS (tom + neutros)
// - Tooltip discreta com tipografia consistente
import {
  ResponsiveContainer,
  PieChart, Pie, Cell,
  AreaChart, Area, XAxis, Tooltip,
} from 'recharts';
import type { PfCategory } from '../../../lib/financeiro';
import { useCategoryLookup } from '../../../hooks/useFinanceiro';

function brl(n: number) {
  return n.toLocaleString('pt-BR', { maximumFractionDigits: 0 });
}

// Tooltip discreta usando tokens do DS.
function ChartTooltip({ active, payload }: { active?: boolean; payload?: { name?: string; value?: number; payload?: { category?: PfCategory; label?: string; mes?: string; saldo?: number; receitas?: number; despesas?: number } }[] }) {
  if (!active || !payload || payload.length === 0) return null;
  const p = payload[0];
  const data = p.payload;
  if (data?.category != null) {
    return (
      <div className="rounded-md border border-border bg-bg-surface shadow-card px-2.5 py-1.5 text-body-sm">
        <span className="text-fg">{data.label ?? data.category}</span>
        <span className="ml-2 tabular-nums font-semibold text-fg">R$ {brl(p.value ?? 0)}</span>
      </div>
    );
  }
  if (data?.mes != null) {
    const positivo = (data.saldo ?? 0) >= 0;
    return (
      <div className="rounded-md border border-border bg-bg-surface shadow-card px-2.5 py-1.5 text-body-sm">
        <div className="text-fg-muted mb-0.5">{data.mes}</div>
        <div className="tabular-nums">
          <span className="text-success">+R$ {brl(data.receitas ?? 0)}</span>
          <span className="text-fg-muted"> · </span>
          <span className="text-danger">−R$ {brl(data.despesas ?? 0)}</span>
        </div>
        <div className={`tabular-nums font-semibold ${positivo ? 'text-tom' : 'text-danger'}`}>
          Saldo {positivo ? '+' : '−'}R$ {brl(Math.abs(data.saldo ?? 0))}
        </div>
      </div>
    );
  }
  return null;
}

export function PieByCategory({ data }: { data: { category: PfCategory; value: number }[] }) {
  const catLookup = useCategoryLookup();
  const total = data.reduce((s, d) => s + d.value, 0);
  // enriquece com label/cor da tabela (a tooltip lê data.label do payload).
  const rows = data.map((d) => ({ ...d, label: catLookup.label(d.category), color: catLookup.color(d.category) }));
  return (
    <div className="flex items-center gap-3 md:gap-4">
      {/* Pizza à esquerda — tamanho fixo, com total no centro do donut */}
      <div className="relative w-[104px] h-[104px] shrink-0">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={rows}
              dataKey="value"
              nameKey="category"
              innerRadius={32}
              outerRadius={50}
              paddingAngle={2}
              stroke="var(--color-bg-surface, transparent)"
              strokeWidth={1.5}
            >
              {rows.map((d, i) => (
                <Cell key={i} fill={d.color} />
              ))}
            </Pie>
            <Tooltip content={<ChartTooltip />} />
          </PieChart>
        </ResponsiveContainer>
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
          <span className="text-fg font-bold text-[11px] tabular-nums leading-none">R$ {brl(total)}</span>
          <span className="text-[8px] uppercase tracking-wide text-fg-muted mt-1">Total</span>
        </div>
      </div>

      {/* Legenda à direita — bolinha · categoria · valor (a proporção já é a fatia da pizza) */}
      <ul className="flex-1 min-w-0 flex flex-col gap-1.5">
        {rows.map((d) => (
          <li key={d.category} className="flex items-center gap-2 text-xs">
            <span
              className="w-2 h-2 rounded-full shrink-0"
              style={{ backgroundColor: d.color }}
              aria-hidden
            />
            <span className="text-fg truncate flex-1 min-w-0">{d.label}</span>
            <span className="text-fg font-semibold tabular-nums shrink-0 w-[64px] text-right">R$ {brl(d.value)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function MonthlyBalance({ data }: { data: { mes: string; saldo: number; receitas: number; despesas: number }[] }) {
  // gradiente verde sutil pra área positiva
  return (
    <ResponsiveContainer width="100%" height={220}>
      <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="tomFade" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#10b981" stopOpacity={0.35} />
            <stop offset="100%" stopColor="#10b981" stopOpacity={0} />
          </linearGradient>
        </defs>
        <XAxis
          dataKey="mes"
          tick={{ fontSize: 11, fill: 'currentColor' }}
          className="text-fg-muted"
          axisLine={false}
          tickLine={false}
        />
        <Tooltip content={<ChartTooltip />} cursor={{ stroke: '#9ca3af', strokeDasharray: 3 }} />
        <Area
          type="monotone"
          dataKey="saldo"
          stroke="#10b981"
          strokeWidth={2}
          fill="url(#tomFade)"
          dot={{ r: 2, strokeWidth: 0, fill: '#10b981' }}
          activeDot={{ r: 4, strokeWidth: 0, fill: '#10b981' }}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

