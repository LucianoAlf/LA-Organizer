import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '../../components/Button';
import { Fab } from '../../components/Fab';
import { useAddToGoal, useFinanceiroAuth, useGoals } from '../../hooks/useFinanceiro';
import { useRealtimeFinance } from '../../hooks/useRealtimeFinance';
import { MONTHLY_RATE_ESTIMATE, formatMonths, monthsToGoalSimple, monthsToGoalWithInterest } from '../../lib/finance-utils';
import type { PfGoal } from '../../lib/financeiro';
import { CompoundInterestSimulator } from './components/CompoundInterestSimulator';
import { FinanceTabs } from './components/FinanceTabs';
import { GoalSheet } from './components/GoalSheet';

function brl(n: number) {
  return n.toLocaleString('pt-BR', { maximumFractionDigits: 0 });
}

function GoalCard({ goal, onContribute }: { goal: PfGoal; onContribute: (goal: PfGoal) => void }) {
  const current = Number(goal.current_amount);
  const target = Number(goal.target_amount);
  const monthly = goal.monthly_contribution ? Number(goal.monthly_contribution) : 0;
  const pct = target > 0 ? Math.min(100, Math.round((current / target) * 100)) : 0;

  let simpleLabel = '';
  let interestLabel = '';
  if (monthly > 0) {
    simpleLabel = formatMonths(monthsToGoalSimple(target, current, monthly));
    interestLabel = formatMonths(monthsToGoalWithInterest(target, current, monthly, MONTHLY_RATE_ESTIMATE));
  }

  return (
    <article className="rounded-lg border border-border bg-bg-surface p-md">
      <header className="flex items-center justify-between gap-3 mb-3">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-2xl shrink-0" aria-hidden>{goal.icon || '🎯'}</span>
          <h3 className="text-body-lg font-semibold text-fg truncate">{goal.name}</h3>
        </div>
        <span className="text-body-sm tabular-nums text-fg-muted">{pct}%</span>
      </header>

      <div className="relative h-2 rounded-full bg-bg-elevated overflow-hidden mb-2">
        <div
          className="absolute inset-y-0 left-0 bg-tom transition-[width] duration-500 ease-out"
          style={{ width: `${pct}%` }}
        />
      </div>

      <div className="flex items-baseline justify-between tabular-nums text-body-sm text-fg-muted mb-3">
        <span>
          R$ <span className="text-fg font-semibold">{brl(current)}</span>
        </span>
        <span>
          de R$ {brl(target)}
        </span>
      </div>

      {monthly > 0 && current < target && (
        <div className="rounded-md bg-bg-elevated border border-border px-3 py-2 mb-3">
          <div className="text-label text-fg-muted uppercase tracking-wide mb-1">Nesse ritmo</div>
          <div className="flex flex-col gap-0.5 text-body-sm">
            <div className="flex items-baseline justify-between">
              <span className="text-fg-muted">guardando</span>
              <span className="text-fg tabular-nums">{simpleLabel}</span>
            </div>
            <div className="flex items-baseline justify-between">
              <span className="text-tom">investindo (~10,5%/ano)</span>
              <span className="text-tom font-semibold tabular-nums">{interestLabel}</span>
            </div>
          </div>
        </div>
      )}

      <div className="flex items-center justify-end">
        <Button size="sm" variant="secondary" onClick={() => onContribute(goal)}>
          + Adicionar contribuição
        </Button>
      </div>
    </article>
  );
}

export function MetasPage() {
  const cid = useFinanceiroAuth();
  useRealtimeFinance(['pf_goals'], cid);
  const goalsQ = useGoals();
  const addMut = useAddToGoal();
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);

  async function contribute(goal: PfGoal) {
    const raw = prompt(`Quanto você está guardando agora pra "${goal.name}"?`, '0');
    if (raw == null) return;
    const amount = Number(String(raw).replace(',', '.'));
    if (!isFinite(amount) || amount <= 0) {
      alert('Valor inválido.');
      return;
    }
    try {
      // D7: atualiza só a meta — NÃO cria transação.
      await addMut.mutateAsync({ goal, amount });
    } catch (e) {
      alert((e as Error).message);
    }
  }

  const goals = goalsQ.data ?? [];
  const empty = !goalsQ.isLoading && goals.length === 0;

  return (
    <div className="flex flex-col gap-md p-md pb-32 md:pb-md md:max-w-5xl md:mx-auto">
      <header className="flex items-baseline justify-between gap-3">
        <h2 className="text-section-title">Finanças</h2>
        <button
          type="button"
          onClick={() => navigate('/financeiro')}
          className="text-body-sm text-fg-muted hover:text-fg focus-ring rounded"
        >
          ← Voltar
        </button>
      </header>
      <FinanceTabs current="metas" />

      {empty && (
        <section className="rounded-lg border border-dashed border-border bg-bg-surface px-md py-lg text-center">
          <div className="text-[44px] leading-none mb-2" aria-hidden>🎯</div>
          <p className="text-body-md text-fg mb-1">Bora pensar num sonho.</p>
          <p className="text-body-sm text-fg-muted mb-md max-w-md mx-auto">
            Cria uma meta pelo + ou manda um zap: <em>“quero comprar um carro de 20 mil em 2 anos guardando 500 por mês”</em>.
            O TOM te lembra todo mês.
          </p>
        </section>
      )}

      {goals.length > 0 && (
        <section className="grid grid-cols-1 md:grid-cols-2 gap-md">
          {goals.map((g) => (
            <GoalCard key={g.id} goal={g} onContribute={contribute} />
          ))}
        </section>
      )}

      <CompoundInterestSimulator />

      <GoalSheet open={creating} onClose={() => setCreating(false)} />
      <Fab label="Nova meta" ariaLabel="Criar meta" onClick={() => setCreating(true)} />
    </div>
  );
}
