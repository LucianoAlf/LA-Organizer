import type { PfCategory } from '../../../lib/financeiro';
import { useCategoryLookup } from '../../../hooks/useFinanceiro';

export interface BudgetBarProps {
  category: PfCategory;
  spent: number;
  limit: number;
}

// Cor por threshold (D3 da spec): verde<70 / âmbar 70-80 / vermelho ≥80.
function toneClass(pct: number): { fill: string; text: string } {
  if (pct >= 100) return { fill: 'bg-danger', text: 'text-danger' };
  if (pct >= 80) return { fill: 'bg-danger/80', text: 'text-danger' };
  if (pct >= 70) return { fill: 'bg-amber-500', text: 'text-amber-500' };
  return { fill: 'bg-tom', text: 'text-tom' };
}

export function BudgetBar({ category, spent, limit }: BudgetBarProps) {
  const catLookup = useCategoryLookup();
  const meta = { emoji: catLookup.emoji(category), label: catLookup.label(category) };
  const pct = limit > 0 ? Math.round((spent / limit) * 100) : 0;
  const clampedPct = Math.min(100, pct);
  const { fill, text } = toneClass(pct);
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span aria-hidden="true" className="text-base leading-none">{meta.emoji}</span>
          <span className="text-body-md text-fg truncate">{meta.label}</span>
        </div>
        <div className="flex items-baseline gap-1.5 shrink-0 tabular-nums">
          <span className={`text-body-sm font-semibold ${text}`}>{pct}%</span>
          <span className="text-body-sm text-fg-muted">
            R${spent.toLocaleString('pt-BR')}<span className="text-fg-muted/60"> / R${limit.toLocaleString('pt-BR')}</span>
          </span>
        </div>
      </div>
      <div className="relative h-1.5 rounded-full bg-bg-elevated overflow-hidden">
        <div
          className={`absolute inset-y-0 left-0 ${fill} transition-[width] duration-500 ease-out`}
          style={{ width: `${clampedPct}%` }}
        />
        {/* Sobre-marker quando estoura: tracinho à direita pra indicar "passou de 100%" */}
        {pct > 100 && (
          <div className="absolute inset-y-0 right-0 w-0.5 bg-danger" aria-hidden="true" />
        )}
      </div>
    </div>
  );
}
