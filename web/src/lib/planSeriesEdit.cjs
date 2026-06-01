// Planejador puro da edição de série recorrente (sem I/O). Decide O QUE fazer;
// o executor (editTaskSeries.ts) é quem chama o supabase.
function planSeriesEdit({ anchor, scope, newRule, todayYmd }) {
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
module.exports = { planSeriesEdit };
