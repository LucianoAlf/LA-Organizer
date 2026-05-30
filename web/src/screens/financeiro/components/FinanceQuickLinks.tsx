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
      className="flex gap-1"
    >
      {LINKS.map(({ to, label, Icon }) => (
        <Link
          key={to}
          to={to}
          className="flex-1 min-w-0 flex flex-col items-center gap-1.5 py-2.5 px-0.5 rounded-lg bg-bg-elevated border border-border hover:bg-bg-elevated2 hover:border-tom/30 active:border-tom/50 focus-ring transition-colors"
        >
          <Icon size={17} className="text-tom" aria-hidden />
          <span className="text-[9px] font-medium text-fg text-center leading-none whitespace-nowrap">{label}</span>
        </Link>
      ))}
    </section>
  );
}
