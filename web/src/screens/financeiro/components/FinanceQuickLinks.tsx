import { Link } from 'react-router-dom';
import { Banknote, Receipt, Target, Wallet, type LucideIcon } from 'lucide-react';
import { useAccounts, useBills, useGoals, useTransactions } from '../../../hooks/useFinanceiro';
import { deriveBillStatus, type PfBill, type PfGoal } from '../../../lib/financeiro';

function brl(n: number) {
  return n.toLocaleString('pt-BR', { maximumFractionDigits: 0 });
}

// Card de Contas — prioridade: atrasada > a-vencer > paga > vazio.
// Reusa deriveBillStatus EXATAMENTE como ContasFixasPage:29 (sem passar `today`).
// Escopo "a pagar" (type='expense') — alinha com ContasFixasPage:75 (aPagar) e
// o botão "Marcar paga" que só aparece em expense:49. Receivables (income) ficam
// fora do card por enquanto.
function summarizeBills(bills: PfBill[] | undefined): string {
  if (!bills) return 'Carregando…';
  const aPagar = bills.filter((b) => b.type === 'expense');
  if (aPagar.length === 0) return 'Nada a pagar';
  const status = aPagar.map((b) => deriveBillStatus(b));
  const atrasadas = status.filter((s) => s === 'atrasada').length;
  const aVencer = status.filter((s) => s === 'a-vencer').length;
  if (atrasadas > 0) return `🔴 ${atrasadas} atrasada${atrasadas > 1 ? 's' : ''}`;
  if (aVencer > 0) return `⚠️ ${aVencer} a vencer`;
  return '🟢 Tudo em dia';
}

// Card de Metas — meta com maior progresso (%). Guarda ÷0: ignora target inválido.
function summarizeGoals(goals: PfGoal[] | undefined): string {
  if (!goals || goals.length === 0) return 'Sem metas';
  const valid = goals.filter((g) => Number(g.target_amount) > 0);
  if (valid.length === 0) return `${goals.length} meta${goals.length > 1 ? 's' : ''}`;
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
  hint: string;
  Icon: LucideIcon;
}

function QuickLinkCard({ to, label, hint, Icon }: QuickLinkProps) {
  return (
    <Link
      to={to}
      className="flex items-center gap-3 rounded-lg border border-border bg-bg-surface p-md hover:bg-bg-elevated focus-ring transition-colors"
    >
      <span className="shrink-0 w-10 h-10 rounded-full bg-bg-elevated grid place-items-center" aria-hidden>
        <Icon size={20} className="text-tom" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-body-md font-medium text-fg truncate">{label}</span>
        <span className="block text-body-sm text-fg-muted truncate">{hint}</span>
      </span>
    </Link>
  );
}

export function FinanceQuickLinks() {
  // Hooks já cobertos pelo useRealtimeFinance no FinanceiroPage (invalida ['financeiro']).
  // useTransactions() SEM monthYear → financeiro.ts:69 cai em monthBounds() default = mês corrente.
  const txQ = useTransactions();
  const billsQ = useBills();
  const goalsQ = useGoals();
  const accountsQ = useAccounts(); // listAccounts já filtra .eq('is_active', true)

  const txCount = txQ.data?.length ?? 0;
  const txHint = txQ.isLoading ? 'Carregando…' : txCount === 0 ? 'Nada esse mês' : `${txCount} esse mês`;

  const billsHint = billsQ.isLoading ? 'Carregando…' : summarizeBills(billsQ.data);
  const goalsHint = goalsQ.isLoading ? 'Carregando…' : summarizeGoals(goalsQ.data);

  const accountsCount = accountsQ.data?.length ?? 0;
  const accountsTotal = (accountsQ.data ?? []).reduce((s, a) => s + Number(a.balance), 0);
  const accountsHint = accountsQ.isLoading
    ? 'Carregando…'
    : accountsCount === 0
    ? 'Sem carteiras'
    : `R$ ${brl(accountsTotal)} · ${accountsCount} carteira${accountsCount > 1 ? 's' : ''}`;

  return (
    <section className="grid grid-cols-2 md:grid-cols-4 gap-2 md:gap-md" aria-label="Atalhos do módulo financeiro">
      <QuickLinkCard to="/financeiro/transacoes" label="Transações" hint={txHint}      Icon={Receipt} />
      <QuickLinkCard to="/financeiro/contas"     label="Contas"     hint={billsHint}    Icon={Banknote} />
      <QuickLinkCard to="/financeiro/metas"      label="Metas"      hint={goalsHint}    Icon={Target} />
      <QuickLinkCard to="/financeiro/carteiras"  label="Carteiras"  hint={accountsHint} Icon={Wallet} />
    </section>
  );
}
