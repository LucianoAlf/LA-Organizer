import { Link } from 'react-router-dom';
import { Banknote, CreditCard, Receipt, Target, Wallet, type LucideIcon } from 'lucide-react';

// Atalhos do financeiro: 5 tiles confortáveis numa grade par (col-5). "Categorias" saiu daqui
// (2026-06-07): criar categoria já acontece no seletor do lançamento; gerenciar fica em
// Configurações → Categorias + no próprio seletor. 6 tiles apertavam a linha.
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
      className="grid grid-cols-5 gap-1.5"
    >
      {LINKS.map(({ to, label, Icon }) => (
        <Link
          key={to}
          to={to}
          className="flex flex-col items-center gap-1.5 py-3 px-1 rounded-xl bg-bg-elevated border border-border hover:bg-bg-elevated2 hover:border-tom/30 active:border-tom/50 focus-ring transition-colors"
        >
          <Icon size={19} className="text-tom" aria-hidden />
          <span className="text-[10px] font-medium text-fg text-center leading-none whitespace-nowrap">{label}</span>
        </Link>
      ))}
    </section>
  );
}
