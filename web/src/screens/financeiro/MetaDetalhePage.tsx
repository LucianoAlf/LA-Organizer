// Detalhe da meta ("entrar na meta"): herói (ícone/nome/barra/projeção), aporte,
// timeline de aportes (apagável) e ações editar/arquivar.
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Button } from '../../components/Button';
import {
  useDeactivateGoal, useDeleteGoalContribution, useFinanceiroAuth, useGoalContributions, useGoals,
} from '../../hooks/useFinanceiro';
import { useRealtimeFinance } from '../../hooks/useRealtimeFinance';
import { MONTHLY_RATE_ESTIMATE, formatMonths, monthsToGoalSimple, monthsToGoalWithInterest } from '../../lib/finance-utils';
import { ContributionSheet } from './components/ContributionSheet';
import { GoalSheet } from './components/GoalSheet';

function brl(n: number) {
  return n.toLocaleString('pt-BR', { maximumFractionDigits: 0 });
}

function fmtData(ymd: string) {
  // contributed_at vem como YYYY-MM-DD (ou ISO); pega só a parte da data.
  const d = ymd.slice(0, 10);
  return `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;
}

export function MetaDetalhePage() {
  const { id = '' } = useParams();
  const cid = useFinanceiroAuth();
  useRealtimeFinance(['pf_goals', 'pf_goal_contributions'], cid);

  const goalsQ = useGoals();
  const goal = goalsQ.data?.find((g) => g.id === id);
  const contribsQ = useGoalContributions(id);
  const delContrib = useDeleteGoalContribution();
  const deactivate = useDeactivateGoal();
  const navigate = useNavigate();

  const [contribOpen, setContribOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);

  if (!goal) {
    return (
      <div className="p-md md:max-w-3xl md:mx-auto">
        <Link to="/financeiro/metas" className="text-label text-fg-muted">← Metas</Link>
        <p className="text-fg-muted mt-4">{goalsQ.isLoading ? 'Carregando…' : 'Meta não encontrada.'}</p>
      </div>
    );
  }

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

  async function archive() {
    if (!confirm(`Arquivar a meta "${goal!.name}"? Ela some da lista.`)) return;
    try {
      await deactivate.mutateAsync(goal!.id);
      navigate('/financeiro/metas');
    } catch (e) {
      alert((e as Error).message);
    }
  }

  async function removeContrib(cId: string) {
    if (!confirm('Apagar este aporte? O valor volta da meta.')) return;
    try {
      await delContrib.mutateAsync(cId);
    } catch (e) {
      alert((e as Error).message);
    }
  }

  const contribs = contribsQ.data ?? [];

  return (
    <div className="flex flex-col gap-md p-md pb-32 md:pb-md md:max-w-3xl md:mx-auto">
      <header className="flex items-center justify-between gap-3">
        <Link to="/financeiro/metas" className="text-label text-fg-muted">← Voltar</Link>
        <div className="flex items-center gap-1">
          <Button size="sm" variant="ghost" onClick={() => setEditOpen(true)}>✏️ Editar</Button>
          <Button size="sm" variant="ghost" onClick={archive} disabled={deactivate.isPending}>🗄️ Arquivar</Button>
        </div>
      </header>

      {/* Herói */}
      <section className="rounded-lg border border-border bg-bg-surface p-md">
        <div className="flex items-center gap-2 mb-3">
          <span className="text-3xl shrink-0" aria-hidden>{goal.icon || '🎯'}</span>
          <h1 className="text-xl font-bold text-fg truncate">{goal.name}</h1>
          <span className="ml-auto text-body-sm tabular-nums text-fg-muted">{pct}%</span>
        </div>

        <div className="relative h-2 rounded-full bg-bg-elevated overflow-hidden mb-2">
          <div
            className="absolute inset-y-0 left-0 bg-tom transition-[width] duration-500 ease-out"
            style={{ width: `${pct}%` }}
          />
        </div>

        <div className="flex items-baseline justify-between tabular-nums text-body-sm text-fg-muted mb-3">
          <span>R$ <span className="text-fg font-semibold">{brl(current)}</span></span>
          <span>de R$ {brl(target)}</span>
        </div>

        {monthly > 0 && current < target && (
          <div className="rounded-md bg-bg-elevated border border-border px-3 py-2">
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
      </section>

      <Button variant="primary" fullWidth onClick={() => setContribOpen(true)}>
        + Adicionar contribuição
      </Button>

      {/* Timeline de aportes */}
      <section className="flex flex-col gap-2">
        <h2 className="text-label uppercase tracking-wide text-fg-muted font-bold">Aportes</h2>
        {!contribsQ.isLoading && contribs.length === 0 && (
          <p className="text-fg-muted text-body-sm">Nenhum aporte ainda.</p>
        )}
        {contribs.map((c) => (
          <div key={c.id} className="flex items-center gap-3 p-3 rounded-md bg-bg-surface border border-border">
            <div className="flex-1 min-w-0">
              <div className="font-semibold text-tom tabular-nums">+ R$ {brl(Number(c.amount))}</div>
              {c.note && <div className="text-body-sm text-fg truncate">{c.note}</div>}
              <div className="text-label text-fg-muted">{fmtData(c.contributed_at)}</div>
            </div>
            <Button
              size="sm"
              variant="ghost"
              aria-label="Apagar aporte"
              onClick={() => removeContrib(c.id)}
              disabled={delContrib.isPending}
            >
              🗑️
            </Button>
          </div>
        ))}
      </section>

      <ContributionSheet open={contribOpen} goal={goal} onClose={() => setContribOpen(false)} />
      <GoalSheet open={editOpen} initial={goal} onClose={() => setEditOpen(false)} />
    </div>
  );
}
