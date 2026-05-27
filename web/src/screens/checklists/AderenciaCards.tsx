// Sprint 23 — AderenciaCards: visão de gestão em grid de cards

import type { TemplateAderencia } from './hooks/useAderencia';

export function AderenciaCards({ data }: { data: TemplateAderencia[] }) {
  if (data.length === 0) {
    return (
      <div className="text-fg/40 text-sm py-8 text-center">
        Sem dados pra este período.
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
      {data.map((t) => (
        <TemplateCard key={t.template_id} t={t} />
      ))}
    </div>
  );
}

function TemplateCard({ t }: { t: TemplateAderencia }) {
  return (
    <div className="bg-bg-surface border border-border rounded-md p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="font-semibold text-fg text-sm truncate">
            {t.template_name}
          </div>
          <div className="text-xs text-fg/60">
            {t.dispatch_time ? t.dispatch_time.slice(0, 5) : '—'} ·{' '}
            {t.totalInstancias} instância{t.totalInstancias !== 1 ? 's' : ''}
          </div>
        </div>
        <Donut pct={t.pctCompletion} />
      </div>
      <div className="mt-2 flex items-center gap-1 flex-wrap">
        {t.responsaveis.slice(0, 5).map((r, idx) => (
          <Avatar key={`${r.id}-${idx}`} name={r.name} status={r.status} />
        ))}
        {t.responsaveis.length > 5 && (
          <span className="text-xs text-fg/40 ml-1">
            +{t.responsaveis.length - 5}
          </span>
        )}
      </div>
    </div>
  );
}

function Donut({ pct }: { pct: number }) {
  const r = 14;
  const c = 2 * Math.PI * r;
  const offset = c - (pct / 100) * c;
  const color = pct === 100 ? '#d6f76d' : pct < 50 ? '#ff8a8a' : '#ffc26d';
  return (
    <div className="relative w-10 h-10 flex-shrink-0">
      <svg viewBox="0 0 36 36" className="w-full h-full -rotate-90">
        <circle cx="18" cy="18" r={r} fill="none" stroke="#2a2f3a" strokeWidth="3" />
        <circle
          cx="18"
          cy="18"
          r={r}
          fill="none"
          stroke={color}
          strokeWidth="3"
          strokeDasharray={c}
          strokeDashoffset={offset}
          strokeLinecap="round"
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center text-[10px] font-bold text-fg">
        {pct}%
      </div>
    </div>
  );
}

function Avatar({
  name,
  status,
}: {
  name: string;
  status: 'done' | 'late' | 'pending';
}) {
  const initial = name.charAt(0).toUpperCase();
  const bg =
    status === 'done'
      ? 'bg-tom text-bg-app'
      : status === 'late'
      ? 'bg-danger text-white'
      : 'bg-bg-app text-fg/60 border border-border';
  return (
    <div
      className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold ${bg}`}
      title={`${name} (${
        status === 'done' ? 'feito' : status === 'late' ? 'atrasou' : 'pendente'
      })`}
    >
      {initial}
    </div>
  );
}
