// web/src/components/team/LeaderSemaphoreRow.tsx
// 1 linha do semáforo de líderes (Fase 2 — Task 6). Clicável → seleciona o líder
// e abre o time dele no painel de drill à direita.
import { ArrowUpRight, ArrowDownRight } from 'lucide-react';
import type { LeaderScorecard } from '../../hooks/useLeaderScorecards';
import { classifyScorecard, BUCKET_META } from '../../lib/scorecard-classify';

interface Props {
  sc: LeaderScorecard;
  selected: boolean;
  onSelect: (leaderId: string) => void;
}

function firstName(sc: LeaderScorecard): string {
  const full = sc.leader?.preferred_name || sc.leader?.full_name || '';
  return full.split(' ')[0] || sc.leader_id.slice(0, 6);
}

// delta_vs_prev é Record<string, unknown> — extrai o número com segurança.
function closureDelta(sc: LeaderScorecard): number | null {
  const dv = sc.delta_vs_prev;
  if (!dv || typeof dv !== 'object') return null;
  if ((dv as Record<string, unknown>).is_first_week) return null;
  const raw = (dv as Record<string, unknown>).closure_rate_delta;
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : null;
}

export function LeaderSemaphoreRow({ sc, selected, onSelect }: Props) {
  const bucket = classifyScorecard(sc);
  const meta = BUCKET_META[bucket];
  const pct = Math.round((sc.closure_rate ?? 0) * 100);
  const delta = closureDelta(sc);
  const deltaPct = delta != null ? Math.round(delta * 100) : null;

  return (
    <button
      type="button"
      onClick={() => onSelect(sc.leader_id)}
      aria-pressed={selected}
      className={[
        'w-full text-left flex items-center gap-md rounded-md border px-3 py-2.5 transition-colors focus-ring',
        selected
          ? 'border-tom bg-tom/10'
          : 'border-border bg-bg-surface hover:bg-bg-elevated',
      ].join(' ')}
    >
      <span
        className="h-2.5 w-2.5 rounded-full shrink-0"
        style={{ backgroundColor: meta.dot }}
        aria-hidden
      />
      <span className="font-semibold text-fg shrink-0 w-24 truncate">{firstName(sc)}</span>

      <span className="tabular-nums text-fg-secondary shrink-0 w-12 text-right">{pct}%</span>

      {sc.tasks_overdue > 0 ? (
        <span className="tabular-nums text-danger text-body-sm shrink-0">{sc.tasks_overdue} atr.</span>
      ) : (
        <span className="text-body-sm text-fg-muted shrink-0">—</span>
      )}

      {deltaPct != null && deltaPct !== 0 && (
        <span
          className={[
            'inline-flex items-center gap-0.5 text-body-sm tabular-nums shrink-0',
            deltaPct > 0 ? 'text-success' : 'text-danger',
          ].join(' ')}
        >
          {deltaPct > 0 ? <ArrowUpRight size={13} /> : <ArrowDownRight size={13} />}
          {Math.abs(deltaPct)}
        </span>
      )}

      {sc.insights && (
        <span className="text-body-sm text-fg-muted truncate flex-1 min-w-0">{sc.insights}</span>
      )}
    </button>
  );
}
