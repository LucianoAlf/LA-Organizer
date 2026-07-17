// web/src/components/team/YouCard.tsx
// Card "Você" da view do líder (Fase 3). Mostra o desempenho DO PRÓPRIO líder
// a partir do scorecard self (RLS scorecard_select_self libera a própria linha):
// fechamento, atrasadas, insight + badge de reconhecimento (semente de gamificação).
// Tom motivacional, mas honesto — sem scorecard ainda → card neutro.
import { Award } from 'lucide-react';
import type { LeaderScorecard } from '../../hooks/useLeaderScorecards';
import { classifyScorecard, BUCKET_META, pctOf } from '../../lib/scorecard-classify';

interface Props {
  scorecard: LeaderScorecard | null;
  name: string;
}

// Badge de reconhecimento por faixa — semente da gamificação (spec §6).
function badgeFor(sc: LeaderScorecard): { emoji: string; label: string } {
  const bucket = classifyScorecard(sc);
  if (bucket === 'ritmo') return { emoji: '🥇', label: 'No ritmo' };
  if (bucket === 'olhar') return { emoji: '👀', label: 'Quase lá' };
  return { emoji: '🎯', label: 'Hora de atacar' };
}

export function YouCard({ scorecard, name }: Props) {
  if (!scorecard) {
    return (
      <section className="surface p-md space-y-2">
        <div className="flex items-center gap-2 text-label uppercase tracking-wide text-fg-muted">
          <Award size={14} /> Você
        </div>
        <p className="text-body-sm text-fg-muted">Sem scorecard fechado esta semana ainda.</p>
      </section>
    );
  }

  // Sem nota (denominador 0: nada fechado, nada atrasado) NÃO é 0% — 0% seria dizer à
  // própria pessoa avaliada, no card dela, o oposto da verdade. Ver pctOf.
  const pct = pctOf(scorecard.closure_rate);
  const badge = badgeFor(scorecard);
  const dot = BUCKET_META[classifyScorecard(scorecard)].dot;

  return (
    <section className="surface p-md space-y-md">
      <div className="flex items-center gap-2 text-label uppercase tracking-wide text-fg-muted">
        <Award size={14} /> Você · {name}
      </div>

      <div className="flex items-center gap-md">
        <span className="h-3 w-3 rounded-full shrink-0" style={{ backgroundColor: dot }} aria-hidden />
        {pct === null ? (
          <span className="text-body-sm text-fg-muted">Sem nota esta semana</span>
        ) : (
          <>
            <span className="text-screen-title font-black text-fg tabular-nums leading-none">{pct}%</span>
            <span className="text-body-sm text-fg-muted">fechamento</span>
          </>
        )}
        <span className="ml-auto inline-flex items-center gap-1 rounded-full border border-tom/30 bg-tom/10 px-2.5 py-1 text-body-sm text-fg-secondary">
          <span aria-hidden>{badge.emoji}</span> {badge.label}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-x-md gap-y-1 text-body-sm">
        <span className="tabular-nums">
          <span className={scorecard.tasks_overdue ? 'text-danger font-semibold' : 'text-fg-muted'}>
            {scorecard.tasks_overdue}
          </span>
          <span className="text-fg-muted"> atrasadas</span>
        </span>
        <span className="tabular-nums">
          <span className="text-success font-semibold">{scorecard.tasks_closed}</span>
          <span className="text-fg-muted"> fechadas</span>
        </span>
        {scorecard.tasks_stuck > 0 && (
          <span className="tabular-nums">
            <span className="text-warning font-semibold">{scorecard.tasks_stuck}</span>
            <span className="text-fg-muted"> travadas</span>
          </span>
        )}
      </div>

      {scorecard.insights && (
        <p className="rounded-md border border-tom/30 bg-tom/10 px-3 py-2 text-body-sm text-fg-secondary">
          {scorecard.insights}
        </p>
      )}
    </section>
  );
}
