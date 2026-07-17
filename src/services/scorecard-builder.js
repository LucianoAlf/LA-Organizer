// src/services/scorecard-builder.js — Sprint 29.3
//
// Computa métricas semanais por líder, persiste em leader_scorecards,
// renderiza 2 versões (director consolidado vs líder individual).
//
// Métricas:
//   - closure_rate = closed / (closed + overdue)  ← 0.0-1.0
//   - tasks_closed: completadas na semana
//   - tasks_overdue: ainda abertas + due_date < hoje
//   - tasks_stuck: coordination_request_count >= 3 (cobranças sem efeito)
//   - top_bottlenecks: top 3 categorias dominantes em overdue+stuck
//   - delta_vs_prev: comparativo com semana anterior
//   - insights: 1 frase gerada por LLM (max 18 palavras)

const supabase = require('../supabase/client');
const { resolveLeadersOf } = require('./leader-routing');
// Funções PURAS de renderização vivem em scorecard-render.js (sem require de banco —
// permite testar sem src/supabase/client, que é gitignored e não existe local).
// Re-exportadas abaixo pra nenhum caller (monday-scorecard.js) precisar mudar.
const { renderForDirector, renderForLeader, pctOf, CATEGORY_LABELS } = require('./scorecard-render');
// Mesmo motivo: deltas + insight 💡 não dependem de banco (só de ai/provider) e ficaram
// intestáveis presos aqui. `generateInsight` é re-exportado; `diffMetrics` alimenta o
// computeDelta abaixo (a QUERY da semana anterior é que precisa ficar neste módulo).
const { diffMetrics, generateInsight } = require('./scorecard-metrics');

/**
 * Range YYYY-MM-DD da SEMANA ANTERIOR (segunda a domingo) à data dada.
 * Exemplo: rodando segunda 02/06/2026, retorna seg 26/05 a dom 01/06.
 */
function lastWeekRange(now = new Date()) {
  // Pega segunda da semana atual (corre dom→sáb, semana começa segunda)
  const d = new Date(now);
  const dow = d.getUTCDay();          // 0=dom, 1=seg, ..., 6=sáb
  const offsetToMonday = dow === 0 ? 6 : dow - 1;
  d.setUTCDate(d.getUTCDate() - offsetToMonday);
  d.setUTCHours(0, 0, 0, 0);
  // Volta 7 dias = segunda da semana anterior
  d.setUTCDate(d.getUTCDate() - 7);
  const start = d.toISOString().slice(0, 10);
  const e = new Date(d);
  e.setUTCDate(e.getUTCDate() + 6);
  const end = e.toISOString().slice(0, 10);
  return { weekStart: start, weekEnd: end };
}

/**
 * Computa as métricas pra UM líder em UMA semana, no escopo do CONJUNTO:
 * o líder + as pessoas de quem ele é o líder PRINCIPAL (§3.3 da spec 16/07).
 *
 * Antes media `assigned_to = leaderId` — só o líder como EXECUTOR. O time nunca entrava
 * na conta: as 9 atrasadas do Peterson (collaborator) não pintavam a Juliana, que é a
 * líder dele. Era a informação que faltava no digest inteiro.
 */
async function computeScorecard(leaderId, weekStart, weekEnd, allCollabs) {
  const weekStartIso = `${weekStart}T00:00:00-03:00`;
  const weekEndIso   = `${weekEnd}T23:59:59-03:00`;

  // Conjunto = ele + quem tem ele como líder PRINCIPAL (1º não-CEO). O principal é
  // determinístico desde o desempate por tier em leader-routing.js.
  const list = Array.isArray(allCollabs) ? allCollabs : [];
  const scope = [leaderId];
  for (const c of list) {
    if (c.id === leaderId) continue;
    const principal = resolveLeadersOf(c, list).find((l) => !l.is_ceo);
    if (principal && principal.id === leaderId) scope.push(c.id);
  }

  // 1. Fechadas na semana (qualquer task fechada com completed_at dentro)
  const { data: closed } = await supabase
    .from('tasks')
    .select('id, title, category')
    .in('assigned_to', scope)
    .eq('status', 'done')
    .gte('completed_at', weekStartIso)
    .lte('completed_at', weekEndIso);

  // 2. Abertas (any time, mas relevante pra calcular overdue/stuck)
  const { data: open } = await supabase
    .from('tasks')
    .select('id, title, due_date, category, coordination_request_count, status')
    .in('assigned_to', scope)
    .eq('data_classification', 'real')
    .in('status', ['pending', 'in_progress', 'awaiting_confirmation']);

  // 3. Overdue: open com due_date <= weekEnd (passou ou vence até fim semana)
  const overdue = (open || []).filter(t => t.due_date && t.due_date <= weekEnd);

  // 4. Stuck: 3+ cobranças sem efeito
  const stuck = (open || []).filter(t => (t.coordination_request_count || 0) >= 3);

  // 5. Closure rate — §7.3: sem denominador NÃO é 100%, é SEM NOTA. `? 1.0` fazia a
  // Rose aparecer 🟢 100% liderando 4 pessoas e sem ter fechado nada.
  const closedCount = closed?.length || 0;
  const denominator = closedCount + overdue.length;
  const closure_rate = denominator === 0 ? null : closedCount / denominator;

  // 6. Top bottlenecks (categorias dominantes em overdue+stuck)
  const catCounts = {};
  for (const t of [...overdue, ...stuck]) {
    const c = t.category || 'sem_categoria';
    catCounts[c] = (catCounts[c] || 0) + 1;
  }
  const top_bottlenecks = Object.entries(catCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([category, count]) => ({ category, count }));

  return {
    tasks_closed: closedCount,
    tasks_overdue: overdue.length,
    tasks_stuck: stuck.length,
    closure_rate: closure_rate === null ? null : Math.round(closure_rate * 100) / 100,
    top_bottlenecks,
  };
}

/**
 * Lê scorecard da semana ANTERIOR à week_start dada e computa deltas.
 */
async function computeDelta(leaderId, weekStart, currentMetrics) {
  const prev = new Date(weekStart + 'T00:00:00Z');
  prev.setUTCDate(prev.getUTCDate() - 7);
  const prevWeekStart = prev.toISOString().slice(0, 10);

  const { data: prevSc } = await supabase
    .from('leader_scorecards')
    .select('closure_rate, tasks_closed, tasks_overdue, tasks_stuck')
    .eq('leader_id', leaderId)
    .eq('week_start', prevWeekStart)
    .maybeSingle();

  if (!prevSc) return { is_first_week: true };

  return diffMetrics(currentMetrics, prevSc);
}

/**
 * Upsert no leader_scorecards (UNIQUE leader_id+week_start garante idempotência).
 */
async function persistScorecard(leaderId, weekStart, weekEnd, metrics, delta, insights) {
  const { data, error } = await supabase
    .from('leader_scorecards')
    .upsert({
      leader_id: leaderId,
      week_start: weekStart,
      week_end: weekEnd,
      closure_rate: metrics.closure_rate,
      tasks_closed: metrics.tasks_closed,
      tasks_overdue: metrics.tasks_overdue,
      tasks_stuck: metrics.tasks_stuck,
      top_bottlenecks: metrics.top_bottlenecks,
      insights,
      delta_vs_prev: delta,
      generated_at: new Date().toISOString(),
    }, { onConflict: 'leader_id,week_start' })
    .select('id')
    .single();
  if (error) {
    console.error('[scorecard-builder] upsert err:', error.message);
    return null;
  }
  return data?.id || null;
}

module.exports = {
  lastWeekRange,
  computeScorecard,
  computeDelta,
  generateInsight,
  persistScorecard,
  renderForDirector,
  renderForLeader,
};
