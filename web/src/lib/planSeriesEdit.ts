// Planejador puro da edição de série recorrente (sem I/O). Decide O QUE fazer;
// o executor (editTaskSeries.ts) é quem chama o supabase.
// ESM nativo — antes era um .cjs importado, mas o dev server do Vite (esbuild)
// não sintetiza exports de CJS local de forma confiável. O teste usa vitest.

export type SeriesEditScope = 'only_this' | 'this_and_future';

type Anchor = {
  id: string;
  recurrence_parent_id: string | null;
  due_date: string | null;
};

type PlanArgs = {
  anchor: Anchor;
  scope: SeriesEditScope;
  newRule?: string | null;
  todayYmd: string;
};

export function planSeriesEdit({ anchor, scope, newRule, todayYmd }: PlanArgs) {
  const seriesId = anchor.recurrence_parent_id || anchor.id;
  const scopeOnlyThis = scope === 'only_this';
  const ruleChanged = newRule !== undefined; // null = desligar; string = nova regra
  const disable = ruleChanged && newRule === null;
  return {
    seriesId,
    scopeOnlyThis,
    applyFutureFromYmd: scopeOnlyThis ? null : String(anchor.due_date),
    cancelFuture: !scopeOnlyThis && ruleChanged,
    rematerialize: !scopeOnlyThis && ruleChanged && newRule !== null,
    disable,
    todayYmd,
  };
}
