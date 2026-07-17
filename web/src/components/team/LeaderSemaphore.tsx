// web/src/components/team/LeaderSemaphore.tsx
// Semáforo de líderes do CEO desktop (Fase 2 — Task 6). Agrupa por bucket:
//   🔴 atenção (ordena por closure asc — pior 1º) → 🟡 olhar → 🟢 ritmo (colapsado).
// O verde colapsa em "+N no ritmo" pra manter o foco em quem precisa de atenção,
// com um toggle pra expandir quando o CEO quiser ver todo mundo.
import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import type { LeaderScorecard } from '../../hooks/useLeaderScorecards';
import {
  classifyScorecard, BUCKET_META, byRateNoScoreLast, byClosedThenName, type ScoreBucket,
} from '../../lib/scorecard-classify';
import { LeaderSemaphoreRow } from './LeaderSemaphoreRow';

interface Props {
  scorecards: LeaderScorecard[];
  selected: string | null;
  onSelect: (id: string) => void;
}

const ORDER: ScoreBucket[] = ['atencao', 'olhar', 'ritmo'];

export function LeaderSemaphore({ scorecards, selected, onSelect }: Props) {
  const [showRitmo, setShowRitmo] = useState(false);

  const buckets: Record<ScoreBucket, LeaderScorecard[]> = { atencao: [], olhar: [], ritmo: [] };
  for (const sc of scorecards) buckets[classifyScorecard(sc)].push(sc);
  // Os TRÊS baldes ordenam — paridade com scorecard-render.js:89-95 (lado Node). Ordenar
  // só um seria o pior dos mundos: meio determinístico faz o próximo leitor achar que está
  // tudo ordenado. Sem sort, a ordem de entrada é a ordem FÍSICA do heap do Postgres (o
  // loader não tem ORDER BY em query nenhuma) e muda sozinha após UPDATE/VACUUM.
  // `.sort()` seguro: os 3 são arrays NOVOS (montados no push acima), não o prop.
  // Em atencao/olhar o comparator manda "sem nota" pro fim em vez de empatá-lo com 0% real
  // — um líder sem nota entra nesses baldes pela via `tasks_overdue`/`tasks_stuck` (nunca
  // por badPct, que o guard de null barra), então os dois convivem MESMO ali.
  buckets.atencao.sort(byRateNoScoreLast);
  buckets.olhar.sort(byRateNoScoreLast);
  buckets.ritmo.sort(byClosedThenName);

  if (scorecards.length === 0) {
    return (
      <section className="surface p-md">
        <p className="text-body-sm text-fg-muted">
          Sem scorecards de líderes nesta semana. O resumo é gerado pelo TOM toda segunda.
        </p>
      </section>
    );
  }

  return (
    <section className="surface p-md space-y-md">
      <div className="text-label uppercase tracking-wide text-fg-muted">Líderes</div>

      {ORDER.map(bucket => {
        const rows = buckets[bucket];
        if (rows.length === 0) return null;

        // O verde colapsa por padrão.
        if (bucket === 'ritmo' && !showRitmo) {
          return (
            <button
              key={bucket}
              type="button"
              onClick={() => setShowRitmo(true)}
              className="flex items-center gap-2 text-body-sm text-fg-muted hover:text-fg transition-colors focus-ring rounded-md"
            >
              <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: BUCKET_META.ritmo.dot }} aria-hidden />
              +{rows.length} no ritmo
              <ChevronDown size={14} />
            </button>
          );
        }

        return (
          <div key={bucket} className="space-y-2">
            <div className="flex items-center gap-2 text-[11px] uppercase tracking-wide text-fg-muted">
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: BUCKET_META[bucket].dot }} aria-hidden />
              {BUCKET_META[bucket].label} · {rows.length}
            </div>
            <div className="space-y-1.5">
              {rows.map(sc => (
                <LeaderSemaphoreRow
                  key={sc.leader_id}
                  sc={sc}
                  selected={selected === sc.leader_id}
                  onSelect={onSelect}
                />
              ))}
            </div>
          </div>
        );
      })}
    </section>
  );
}
