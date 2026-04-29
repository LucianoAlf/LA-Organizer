// Sprint 11 F2+ / Sessão B — Heatmap GitHub-style dos hábitos.
// Mostra ritmo agregado dos últimos 30 dias: cada cell = 1 dia, cor por
// intensidade (quantos hábitos do total foram completados nesse dia).
// Layout: 7 colunas (uma por dia da semana, dom-sáb), N linhas (semanas).

interface HeatmapDay {
  ymd: string;          // 'YYYY-MM-DD' BRT
  count: number;        // hábitos done nesse dia
  total: number;        // total de hábitos ativos do user
}

interface Props {
  days: HeatmapDay[];
  /** Tamanho de cada cell em px. Default 14. */
  cellSize?: number;
}

// Intensidade 0..4 baseada em count/total (igual ao GitHub: 5 níveis).
function levelFor(d: HeatmapDay): 0 | 1 | 2 | 3 | 4 {
  if (d.total <= 0 || d.count <= 0) return 0;
  const ratio = d.count / d.total;
  if (ratio >= 1.0) return 4;
  if (ratio >= 0.66) return 3;
  if (ratio >= 0.34) return 2;
  return 1;
}

const LEVEL_CLASS: Record<0 | 1 | 2 | 3 | 4, string> = {
  0: 'bg-bg-elevated border border-border',
  1: 'bg-success/20',
  2: 'bg-success/40',
  3: 'bg-success/70',
  4: 'bg-success',
};

// Day-of-week 0..6 (sun..sat) em America/Sao_Paulo a partir de YMD.
function dowOf(ymd: string): number {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12)).getUTCDay();
}

export function HabitsHeatmap({ days, cellSize = 14 }: Props) {
  if (!days.length) return null;

  // Reorganiza em colunas semanais. Primeira coluna pode ter pad inicial até o dow do primeiro dia.
  // Ordem: do mais antigo pro mais recente, top→bottom é dow (0=dom,6=sáb), left→right é semana.
  const sorted = [...days].sort((a, b) => a.ymd.localeCompare(b.ymd));
  const firstDow = dowOf(sorted[0].ymd);
  const cells: (HeatmapDay | null)[] = Array(firstDow).fill(null).concat(sorted);
  // Padding final pra completar última semana (não-essencial, mas estética).
  while (cells.length % 7 !== 0) cells.push(null);

  const weeks: (HeatmapDay | null)[][] = [];
  for (let w = 0; w < cells.length; w += 7) {
    weeks.push(cells.slice(w, w + 7));
  }

  const total = sorted.reduce((acc, d) => acc + d.count, 0);
  const totalPossible = sorted.reduce((acc, d) => acc + d.total, 0);
  const pct = totalPossible > 0 ? Math.round((total / totalPossible) * 100) : 0;

  return (
    <section className="surface p-md space-y-sm">
      <div className="flex items-baseline justify-between">
        <div className="text-label uppercase tracking-wide text-fg-muted">
          Ritmo · últimos {sorted.length} dias
        </div>
        <div className="text-body-sm tabular-nums">
          <span className="font-semibold">{pct}%</span>
          <span className="text-fg-muted"> aderência</span>
        </div>
      </div>

      <div className="flex gap-1 overflow-x-auto no-scrollbar pb-1">
        {weeks.map((week, wi) => (
          <div key={wi} className="flex flex-col gap-1">
            {week.map((cell, ci) => {
              if (!cell) {
                return (
                  <div
                    key={ci}
                    style={{ width: cellSize, height: cellSize }}
                    className="opacity-0"
                    aria-hidden
                  />
                );
              }
              const lvl = levelFor(cell);
              return (
                <div
                  key={ci}
                  style={{ width: cellSize, height: cellSize }}
                  className={[`rounded-sm`, LEVEL_CLASS[lvl]].join(' ')}
                  title={`${cell.ymd}: ${cell.count}/${cell.total} hábitos`}
                />
              );
            })}
          </div>
        ))}
      </div>

      {/* Legenda */}
      <div className="flex items-center gap-2 text-label uppercase tracking-wide text-fg-muted">
        <span>menos</span>
        {[0, 1, 2, 3, 4].map(l => (
          <div
            key={l}
            style={{ width: 12, height: 12 }}
            className={['rounded-sm', LEVEL_CLASS[l as 0 | 1 | 2 | 3 | 4]].join(' ')}
            aria-hidden
          />
        ))}
        <span>mais</span>
      </div>
    </section>
  );
}
