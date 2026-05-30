import { lazy, Suspense, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { StatCard } from '../../components/StatCard';
import { Fab } from '../../components/Fab';
import { useAccounts, useBudgets, useFinanceiroAuth, useSummary, useTransactions, useTransactionsRange } from '../../hooks/useFinanceiro';
import { useRealtimeFinance } from '../../hooks/useRealtimeFinance';
import type { PfCategory, PfTransaction } from '../../lib/financeiro';
import { monthBounds } from '../../lib/financeiro';
import { BudgetBar } from './components/BudgetBar';
import { FinanceTabs } from './components/FinanceTabs';

// Recharts lazy: 2 componentes, cada um chunk próprio
const PieByCategory   = lazy(() => import('./components/FinanceCharts').then(m => ({ default: m.PieByCategory })));
const MonthlyBalance  = lazy(() => import('./components/FinanceCharts').then(m => ({ default: m.MonthlyBalance })));

const PT_MONTHS = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
const CAT_EMOJI: Record<PfCategory, string> = {
  salario: '💼', comissao: '💰', extra: '💵',
  moradia: '🏠', alimentacao: '🍔', transporte: '🚗',
  saude: '🏥', educacao: '📚', lazer: '🎮', outros: '📦',
};

function brl(n: number) {
  return n.toLocaleString('pt-BR', { maximumFractionDigits: 0 });
}

function rangeLast6Months() {
  const now = new Date();
  const startD = new Date(Date.UTC(now.getFullYear(), now.getMonth() - 5, 1));
  const endD = new Date(Date.UTC(now.getFullYear(), now.getMonth() + 1, 1));
  return { start: startD.toISOString().slice(0, 10), end: endD.toISOString().slice(0, 10), startD, endD };
}

function aggregateByMonth(txs: { type: 'income'|'expense'; amount: number; transaction_date: string }[]) {
  const buckets: Record<string, { income: number; expense: number }> = {};
  for (const t of txs) {
    const ym = t.transaction_date.slice(0, 7);
    buckets[ym] = buckets[ym] || { income: 0, expense: 0 };
    buckets[ym][t.type] += Number(t.amount);
  }
  return buckets;
}

export function FinanceiroPage() {
  const cid = useFinanceiroAuth();
  useRealtimeFinance(['pf_transactions', 'pf_bills', 'pf_accounts', 'pf_budgets', 'pf_goals'], cid);

  const accountsQ = useAccounts();
  const budgetsQ = useBudgets();
  const lastTxsQ = useTransactions({ limit: 5 });
  const summaryQ = useSummary();

  // 6 meses pra a linha
  const r6 = useMemo(rangeLast6Months, []);
  const txRangeQ = useTransactionsRange(r6.start, r6.end);

  const navigate = useNavigate();
  const summary = summaryQ.summary;
  const now = new Date();
  const monthLabel = `${PT_MONTHS[now.getMonth()]} de ${now.getFullYear()}`;

  // Linha mensal (6 buckets, oldest → newest)
  const monthlySeries = useMemo(() => {
    if (!txRangeQ.data) return [];
    const buckets = aggregateByMonth(txRangeQ.data);
    const arr: { mes: string; saldo: number; receitas: number; despesas: number }[] = [];
    for (let i = 0; i < 6; i++) {
      const d = new Date(Date.UTC(r6.startD.getUTCFullYear(), r6.startD.getUTCMonth() + i, 1));
      const ym = d.toISOString().slice(0, 7);
      const b = buckets[ym] || { income: 0, expense: 0 };
      arr.push({
        mes: PT_MONTHS[d.getUTCMonth()],
        receitas: b.income,
        despesas: b.expense,
        saldo: b.income - b.expense,
      });
    }
    return arr;
  }, [txRangeQ.data, r6.startD]);

  // Pizza: gastos do mês corrente por categoria
  const pieData = useMemo(() => {
    if (!summary) return [];
    return Object.entries(summary.porCat)
      .map(([category, value]) => ({ category: category as PfCategory, value }))
      .sort((a, b) => b.value - a.value);
  }, [summary]);

  // Orçamento × gasto
  const budgetRows = useMemo(() => {
    if (!budgetsQ.data || !summary) return [];
    return budgetsQ.data.map((b) => ({
      category: b.category,
      limit: Number(b.monthly_limit),
      spent: Number(summary.porCat[b.category] || 0),
    }));
  }, [budgetsQ.data, summary]);

  const isLoading = summaryQ.isLoading || budgetsQ.isLoading || accountsQ.isLoading;
  const hasAnyData =
    (summary && (summary.receitas + summary.despesas) > 0) ||
    (accountsQ.data && accountsQ.data.length > 0) ||
    (budgetRows.length > 0);

  return (
    <div className="flex flex-col gap-md p-md pb-32 md:pb-md md:max-w-5xl md:mx-auto">
      {/* Header */}
      <header className="flex items-baseline justify-between gap-3">
        <h2 className="text-section-title">Finanças</h2>
        <span className="text-body-sm text-fg-muted tabular-nums">{monthLabel}</span>
      </header>

      <FinanceTabs current="dashboard" />

      {/* StatCards — Saldo é o herói */}
      <section className="grid grid-cols-3 gap-2 md:gap-md">
        <StatCard
          label="Receitas"
          tone="success"
          value={<>R$ {brl(summary?.receitas ?? 0)}</>}
        />
        <StatCard
          label="Despesas"
          tone="danger"
          value={<>R$ {brl(summary?.despesas ?? 0)}</>}
        />
        <StatCard
          label="Saldo"
          tone={summary && summary.saldo < 0 ? 'danger' : 'tom'}
          value={<>{summary && summary.saldo < 0 ? '−' : '+'}R$ {brl(Math.abs(summary?.saldo ?? 0))}</>}
        />
      </section>

      {/* Empty state — só quando NÃO há absolutamente nada */}
      {!isLoading && !hasAnyData && (
        <section className="rounded-lg border border-dashed border-border bg-bg-surface px-md py-lg text-center">
          <div className="text-[44px] leading-none mb-2" aria-hidden="true">👽💰</div>
          <p className="text-body-md text-fg mb-1">Pronto pra começar.</p>
          <p className="text-body-sm text-fg-muted mb-md max-w-sm mx-auto">
            Manda um zap pro TOM (<em>“gastei 45 no iFood”</em>) ou registra direto pelo <strong>+</strong> abaixo.
            Tua conta vai aparecer aqui na hora.
          </p>
        </section>
      )}

      {/* Carteiras (chips) */}
      {accountsQ.data && accountsQ.data.length > 0 && (
        <section>
          <h3 className="text-label text-fg-muted uppercase tracking-wide mb-2">Carteiras</h3>
          <div className="flex flex-wrap gap-2">
            {accountsQ.data.map((a) => (
              <div key={a.id} className="rounded-full border border-border bg-bg-surface px-3 py-1.5 flex items-center gap-2">
                <span aria-hidden="true">{a.icon || '🏦'}</span>
                <span className="text-body-sm text-fg">{a.name}</span>
                <span className={`text-body-sm tabular-nums font-semibold ${Number(a.balance) < 0 ? 'text-danger' : 'text-fg'}`}>
                  R$ {brl(Number(a.balance))}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Orçamento por categoria */}
      <section className="rounded-lg border border-border bg-bg-surface p-md">
        <div className="flex items-baseline justify-between mb-3">
          <h3 className="text-label text-fg-muted uppercase tracking-wide">Orçamento</h3>
          {budgetRows.length > 0 && (
            <span className="text-body-sm text-fg-muted tabular-nums">{budgetRows.length} categoria{budgetRows.length > 1 ? 's' : ''}</span>
          )}
        </div>
        {budgetRows.length === 0 ? (
          <p className="text-body-sm text-fg-muted">
            Define um limite por categoria pelo TOM: <em>“define orçamento de alimentação 500”</em>.
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            {budgetRows.map((b) => (
              <BudgetBar key={b.category} category={b.category} spent={b.spent} limit={b.limit} />
            ))}
          </div>
        )}
      </section>

      {/* Pizza + Linha — lazy load Recharts */}
      <section className="grid grid-cols-1 md:grid-cols-2 gap-md">
        <div className="rounded-lg border border-border bg-bg-surface p-md min-h-[260px]">
          <h3 className="text-label text-fg-muted uppercase tracking-wide mb-3">Gastos por categoria</h3>
          {pieData.length === 0 ? (
            <p className="text-body-sm text-fg-muted">Sem despesas neste mês ainda.</p>
          ) : (
            <Suspense fallback={<div className="text-body-sm text-fg-muted">Carregando gráfico…</div>}>
              <PieByCategory data={pieData} />
            </Suspense>
          )}
        </div>
        <div className="rounded-lg border border-border bg-bg-surface p-md min-h-[260px]">
          <h3 className="text-label text-fg-muted uppercase tracking-wide mb-3">Saldo últimos 6 meses</h3>
          {monthlySeries.length === 0 ? (
            <p className="text-body-sm text-fg-muted">Carregando histórico…</p>
          ) : (
            <Suspense fallback={<div className="text-body-sm text-fg-muted">Carregando gráfico…</div>}>
              <MonthlyBalance data={monthlySeries} />
            </Suspense>
          )}
        </div>
      </section>

      {/* Últimas transações */}
      {lastTxsQ.data && lastTxsQ.data.length > 0 && (
        <section className="rounded-lg border border-border bg-bg-surface">
          <div className="flex items-baseline justify-between px-md pt-md pb-2">
            <h3 className="text-label text-fg-muted uppercase tracking-wide">Últimas transações</h3>
            <button
              type="button"
              onClick={() => navigate('/financeiro/transacoes')}
              className="text-body-sm text-tom hover:underline focus-ring rounded"
            >
              Ver todas →
            </button>
          </div>
          <ul className="divide-y divide-border">
            {lastTxsQ.data.map((t: PfTransaction) => (
              <li key={t.id} className="px-md py-2.5 flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <span aria-hidden="true" className="text-base shrink-0">{CAT_EMOJI[t.category]}</span>
                  <div className="min-w-0">
                    <div className="text-body-md text-fg truncate">{t.description || t.category}</div>
                    <div className="text-body-sm text-fg-muted tabular-nums">{t.transaction_date}</div>
                  </div>
                </div>
                <span className={`text-body-md tabular-nums font-semibold shrink-0 ${t.type === 'income' ? 'text-success' : 'text-danger'}`}>
                  {t.type === 'income' ? '+' : '−'}R$ {brl(Number(t.amount))}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <Fab
        label="Registrar"
        ariaLabel="Registrar transação"
        onClick={() => navigate('/financeiro/transacoes?new=1')}
      />
    </div>
  );
}
