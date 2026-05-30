// Faixa de resumo do financeiro: chips com sinais reais (contas, cartões, metas).
// Horizontal, arrastável, SEM barra de scroll visível (estilo Nubank).
// Só renderiza chips que têm sinal real — se não há nada, não renderiza a faixa.
import { Link } from 'react-router-dom';
import { useBills, useGoals, useCardsWithUsage } from '../../../hooks/useFinanceiro';
import { deriveBillStatus } from '../../../lib/financeiro';

interface Chip { key: string; to: string; label: string; tone: 'danger' | 'warn' | 'muted' | 'tom'; }

const TONE: Record<Chip['tone'], string> = {
  danger: 'text-danger border-danger/40',
  warn: 'text-amber-400 border-amber-400/40',
  muted: 'text-fg-muted border-border',
  tom: 'text-tom border-tom/40',
};

export function FinanceSummaryChips() {
  const billsQ = useBills();
  const goalsQ = useGoals();
  const cardsQ = useCardsWithUsage();

  const chips: Chip[] = [];

  // Contas a pagar (atrasadas / a vencer)
  const aPagar = (billsQ.data ?? []).filter((b) => b.type === 'expense');
  const status = aPagar.map((b) => deriveBillStatus(b));
  const atrasadas = status.filter((s) => s === 'atrasada').length;
  const aVencer = status.filter((s) => s === 'a-vencer').length;
  if (atrasadas > 0) chips.push({ key: 'bills-late', to: '/financeiro/contas', tone: 'danger', label: `🔴 ${atrasadas} atrasada${atrasadas > 1 ? 's' : ''}` });
  else if (aVencer > 0) chips.push({ key: 'bills-due', to: '/financeiro/contas', tone: 'warn', label: `⚠️ ${aVencer} a vencer` });

  // Cartões com uso alto (>= 50%) — mostra do mais alto pro mais baixo
  const cards = [...(cardsQ.data ?? [])]
    .filter((c) => c.usage.pct >= 0.5)
    .sort((a, b) => b.usage.pct - a.usage.pct);
  for (const { card, usage } of cards) {
    const pct = Math.round(usage.pct * 100);
    chips.push({
      key: `card-${card.id}`, to: `/financeiro/cartoes/${card.id}`,
      tone: pct >= 90 ? 'danger' : pct >= 70 ? 'warn' : 'muted',
      label: `${pct >= 90 ? '🚨' : '💳'} ${card.name} ${pct}%`,
    });
  }

  // Top meta com progresso real
  const goals = (goalsQ.data ?? []).filter((g) => Number(g.target_amount) > 0 && Number(g.current_amount) > 0);
  if (goals.length > 0) {
    const top = goals.reduce((best, g) =>
      (Number(g.current_amount) / Number(g.target_amount)) > (Number(best.current_amount) / Number(best.target_amount)) ? g : best);
    const pct = Math.round((Number(top.current_amount) / Number(top.target_amount)) * 100);
    chips.push({ key: 'goal', to: '/financeiro/metas', tone: 'tom', label: `🎯 ${top.name} ${pct}%` });
  }

  if (chips.length === 0) return null;

  return (
    <section
      aria-label="Resumo financeiro"
      className="flex gap-1.5 overflow-x-auto [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
    >
      {chips.map((c) => (
        <Link
          key={c.key}
          to={c.to}
          className={`shrink-0 inline-flex items-center rounded-full border bg-bg-surface px-2.5 py-0.5 text-[11px] font-medium whitespace-nowrap focus-ring ${TONE[c.tone]}`}
        >
          {c.label}
        </Link>
      ))}
    </section>
  );
}
