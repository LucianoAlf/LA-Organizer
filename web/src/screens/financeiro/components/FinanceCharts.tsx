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

// Paleta sólida e harmoniosa (não arco-íris). Hex direto pra atravessar o Recharts.
const CATEGORY_COLOR: Record<PfCategory, string> = {
  salario:     '#10b981', // emerald — só aparece se misturar income
  comissao:    '#10b981',
  extra:       '#10b981',
  alimentacao: '#f59e0b', // amber
  moradia:     '#64748b', // slate (sólido)
  transporte:  '#0ea5e9', // sky
  saude:       '#f43f5e', // rose
  educacao:    '#8b5cf6', // violet
  lazer:       '#06b6d4', // cyan
  outros:      '#a8a29e', // stone
};
const CATEGORY_LABEL: Record<PfCategory, string> = {
  salario:'Salário', comissao:'Comissão', extra:'Extra',
  moradia:'Moradia', alimentacao:'Alimentação', transporte:'Transporte',
  saude:'Saúde', educacao:'Educação', lazer:'Lazer', outros:'Outros',
};

function brl(n: number) {
  return n.toLocaleString('pt-BR', { maximumFractionDigits: 0 });
}

// Tooltip discreta usando tokens do DS.
function ChartTooltip({ active, payload }: { active?: boolean; payload?: { name?: string; value?: number; payload?: { category?: PfCategory; mes?: string; saldo?: number; receitas?: number; despesas?: number } }[] }) {
  if (!active || !payload || payload.length === 0) return null;
  const p = payload[0];
  const data = p.payload;
  if (data?.category != null) {
    return (
      <div className="rounded-md border border-border bg-bg-surface shadow-card px-2.5 py-1.5 text-body-sm">
        <span className="text-fg">{CATEGORY_LABEL[data.category]}</span>
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
  return (
    <ResponsiveContainer width="100%" height={220}>
      <PieChart>
        <Pie
          data={data}
          dataKey="value"
          nameKey="category"
          innerRadius={45}
          outerRadius={85}
          paddingAngle={2}
          stroke="var(--color-bg-surface, transparent)"
          strokeWidth={1.5}
        >
          {data.map((d, i) => (
            <Cell key={i} fill={CATEGORY_COLOR[d.category]} />
          ))}
        </Pie>
        <Tooltip content={<ChartTooltip />} />
      </PieChart>
    </ResponsiveContainer>
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

