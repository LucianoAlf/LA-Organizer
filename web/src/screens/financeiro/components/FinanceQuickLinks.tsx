import { Link } from 'react-router-dom';
import { Banknote, CreditCard, Receipt, Target, Wallet, type LucideIcon } from 'lucide-react';

// Atalhos do financeiro: UMA linha, arrastável pro lado (estilo Nubank), SEM barra de
// scroll visível. Label inteiro (sem abreviar). Sinais/alertas ficam na faixa de resumo
// (FinanceSummaryChips), não dentro destes tiles.
interface QuickLink { to: string; label: string; Icon: LucideIcon; }

const LINKS: QuickLink[] = [
  { to: '/financeiro/transacoes', label: 'Transações', Icon: Receipt },
  { to: '/financeiro/contas',     label: 'Contas',     Icon: Banknote },
  { to: '/financeiro/metas',      label: 'Metas',      Icon: Target },
  { to: '/financeiro/carteiras',  label: 'Carteiras',  Icon: Wallet },
  { to: '/financeiro/cartoes',    label: 'Cartões',    Icon: CreditCard },
];

export function FinanceQuickLinks() {
  return (
    <section
      aria-label="Atalhos do módulo financeiro"
      className="flex gap-2 overflow-x-auto -mx-md px-md [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
    >
      {LINKS.map(({ to, label, Icon }) => (
        <Link
          key={to}
          to={to}
          className="shrink-0 w-[88px] flex flex-col items-center gap-1.5 py-3 px-1 rounded-md bg-bg-elevated hover:bg-bg-surface focus-ring transition-colors border border-border/40"
        >
          <Icon size={18} className="text-tom" aria-hidden />
          <span className="text-[12px] font-medium text-fg text-center leading-none">{label}</span>
        </Link>
      ))}
    </section>
  );
}
