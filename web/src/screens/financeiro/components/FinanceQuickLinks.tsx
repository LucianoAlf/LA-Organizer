import { Link } from 'react-router-dom';
import { Banknote, CreditCard, Receipt, Target, Wallet, type LucideIcon } from 'lucide-react';
import { useBills, useGoals } from '../../../hooks/useFinanceiro';
import { deriveBillStatus, type PfBill, type PfGoal } from '../../../lib/financeiro';

// Retorna null = sem sinal (não renderiza hint), string = sinal real
// Contas: mostra só quando há atrasada ou a-vencer. "Tudo em dia" / vazio = null.
function billSignal(bills: PfBill[] | undefined): string | null {
  if (!bills) return null;
  const aPagar = bills.filter((b) => b.type === 'expense');
  if (aPagar.length === 0) return null;
  const status = aPagar.map((b) => deriveBillStatus(b));
  const atrasadas = status.filter((s) => s === 'atrasada').length;
  const aVencer  = status.filter((s) => s === 'a-vencer').length;
  if (atrasadas > 0) return `🔴 ${atrasadas} atrasada${atrasadas > 1 ? 's' : ''}`;
  if (aVencer  > 0) return `⚠️ ${aVencer} a vencer`;
  return null; // tudo em dia → sem ruído
}

// Metas: mostra só quando tem progresso real (current_amount > 0).
// Sem progresso = null (meta existe mas está zerada — não é sinal útil).
function goalSignal(goals: PfGoal[] | undefined): string | null {
  if (!goals || goals.length === 0) return null;
  const valid = goals.filter((g) => Number(g.target_amount) > 0 && Number(g.current_amount) > 0);
  if (valid.length === 0) return null;
  const top = valid.reduce((best, g) => {
    const pct = Number(g.current_amount) / Number(g.target_amount);
    const bestPct = Number(best.current_amount) / Number(best.target_amount);
    return pct > bestPct ? g : best;
  });
  const pct = Math.round((Number(top.current_amount) / Number(top.target_amount)) * 100);
  return `${top.name} · ${pct}%`;
}

interface QuickLinkProps {
  to: string;
  label: string;
  hint: string | null; // null = só ícone + label, sem ruído
  Icon: LucideIcon;
}

// Strip horizontal, footprint vertical mínimo.
// Hint renderiza só quando tem sinal real (não é null).
function QuickLinkCard({ to, label, hint, Icon }: QuickLinkProps) {
  return (
    <Link
      to={to}
      className="flex-1 flex flex-col items-center gap-0.5 py-2 px-1 rounded-md bg-bg-elevated hover:bg-bg-surface focus-ring transition-colors border border-border/40 min-w-0"
    >
      <Icon size={15} className="text-tom shrink-0" aria-hidden />
      <span className="text-[11px] font-medium text-fg text-center leading-none truncate w-full">{label}</span>
      {hint && (
        <span className="text-[10px] leading-tight text-fg-muted text-center truncate w-full">{hint}</span>
      )}
    </Link>
  );
}

export function FinanceQuickLinks() {
  // Transações e Carteiras sem hint → hooks não necessários aqui.
  // Realtime já coberto pelo useRealtimeFinance no FinanceiroPage (invalida ['financeiro']).
  const billsQ = useBills();
  const goalsQ = useGoals();

  // Transações: sem hint — contagem não é sinal acionável
  // Carteiras:  sem hint — saldo visível nos chips do dashboard
  const billsHint = billsQ.isLoading ? null : billSignal(billsQ.data);
  const goalsHint = goalsQ.isLoading ? null : goalSignal(goalsQ.data);

  return (
    <section className="flex gap-1.5 md:gap-md" aria-label="Atalhos do módulo financeiro">
      <QuickLinkCard to="/financeiro/transacoes" label="Transações" hint={null}       Icon={Receipt} />
      <QuickLinkCard to="/financeiro/contas"     label="Contas"     hint={billsHint}  Icon={Banknote} />
      <QuickLinkCard to="/financeiro/metas"      label="Metas"      hint={goalsHint}  Icon={Target} />
      <QuickLinkCard to="/financeiro/carteiras"  label="Carteiras"  hint={null}       Icon={Wallet} />
      <QuickLinkCard to="/financeiro/cartoes"    label="Cartões"    hint={null}       Icon={CreditCard} />
    </section>
  );
}
