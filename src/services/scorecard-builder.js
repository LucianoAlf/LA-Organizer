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
const ai = require('../ai/provider');

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
 * Computa as 5 métricas pra UM líder em UMA semana.
 */
async function computeScorecard(leaderId, weekStart, weekEnd) {
  const weekStartIso = `${weekStart}T00:00:00-03:00`;
  const weekEndIso   = `${weekEnd}T23:59:59-03:00`;

  // 1. Fechadas na semana (qualquer task fechada com completed_at dentro)
  const { data: closed } = await supabase
    .from('tasks')
    .select('id, title, category')
    .eq('assigned_to', leaderId)
    .eq('status', 'done')
    .gte('completed_at', weekStartIso)
    .lte('completed_at', weekEndIso);

  // 2. Abertas (any time, mas relevante pra calcular overdue/stuck)
  const { data: open } = await supabase
    .from('tasks')
    .select('id, title, due_date, category, coordination_request_count, status')
    .eq('assigned_to', leaderId)
    .eq('data_classification', 'real')
    .in('status', ['pending', 'in_progress', 'awaiting_confirmation']);

  // 3. Overdue: open com due_date <= weekEnd (passou ou vence até fim semana)
  const overdue = (open || []).filter(t => t.due_date && t.due_date <= weekEnd);

  // 4. Stuck: 3+ cobranças sem efeito
  const stuck = (open || []).filter(t => (t.coordination_request_count || 0) >= 3);

  // 5. Closure rate
  const closedCount = closed?.length || 0;
  const denominator = closedCount + overdue.length;
  const closure_rate = denominator === 0 ? 1.0 : closedCount / denominator;

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
    closure_rate: Math.round(closure_rate * 100) / 100,
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

  return {
    closure_rate_delta: Math.round((currentMetrics.closure_rate - prevSc.closure_rate) * 100) / 100,
    closed_delta: currentMetrics.tasks_closed - prevSc.tasks_closed,
    overdue_delta: currentMetrics.tasks_overdue - prevSc.tasks_overdue,
    stuck_delta: currentMetrics.tasks_stuck - prevSc.tasks_stuck,
  };
}

/**
 * Gera 1 frase de insight via LLM. Fallback determinístico em caso de falha.
 */
async function generateInsight(leader, metrics, delta) {
  const closurePct = Math.round(metrics.closure_rate * 100);
  const deltaTxt = delta.is_first_week
    ? '(primeira semana)'
    : `(${delta.closure_rate_delta >= 0 ? '+' : ''}${Math.round(delta.closure_rate_delta * 100)}pp vs anterior)`;

  const sys = `Você é analista de operações. Gere UMA frase em PT-BR (max 18 palavras) que resume o desempenho semanal e indica tendência. SEM emoji. SEM aspas. SEM começar com "Resumo". Direto ao ponto.`;
  const userMsg = `Líder: ${leader.full_name}
Fechamento: ${closurePct}% ${deltaTxt}
Fechou: ${metrics.tasks_closed} | Atrasadas: ${metrics.tasks_overdue} | Travadas 3+: ${metrics.tasks_stuck}
Bottleneck principal: ${metrics.top_bottlenecks[0]?.category || 'nenhum claro'}`;

  try {
    const r = await ai.chat(sys, [{ role: 'user', content: userMsg }]);
    const txt = String(r?.text || r?.reply || r?.content || '').trim();
    if (txt && txt.length > 8 && txt.length < 250) return txt;
  } catch (err) {
    console.warn('[scorecard-builder] insight LLM err:', err.message);
  }
  // Fallback
  if (metrics.tasks_stuck >= 3) return `Travamentos crônicos em ${metrics.tasks_stuck} itens — recomendo 1:1 dirigido.`;
  if (closurePct >= 80) return `Semana sólida (${closurePct}% fechamento). Manter o ritmo.`;
  if (closurePct < 50) return `Fechamento baixo (${closurePct}%) — investigar carga ou bloqueios.`;
  return `Fechamento razoável (${closurePct}%). ${metrics.tasks_overdue} atrasadas pra destravar.`;
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

const CATEGORY_LABELS = {
  la_music: 'LA Music', mentoria: 'Mentoria', pedagogico: 'Pedagógico',
  operacional: 'Operacional', operational: 'Operacional', comercial: 'Comercial',
  acolhimento: 'Acolhimento', marketing: 'Marketing', sem_categoria: 'Sem categoria',
  pessoal: 'Pessoal',
};

/**
 * Renderiza versão CONSOLIDADA pro director (todos líderes).
 */
function renderForDirector(scorecards, leadersById) {
  if (!scorecards || scorecards.length === 0) return null;
  const lines = ['📊 *Scorecard semanal — seus líderes*\n'];

  // Ordena: pior closure_rate primeiro (precisa atenção)
  const sorted = [...scorecards].sort((a, b) => a.closure_rate - b.closure_rate);

  for (const sc of sorted) {
    const leader = leadersById.get(sc.leader_id);
    if (!leader) continue;
    const pct = Math.round(sc.closure_rate * 100);
    const delta = sc.delta_vs_prev || {};
    const arrow = delta.is_first_week
      ? '🆕'
      : (delta.closure_rate_delta > 0.05 ? '↑' : delta.closure_rate_delta < -0.05 ? '↓' : '→');
    const deltaTxt = delta.is_first_week
      ? '(1ª semana)'
      : ` (${delta.closure_rate_delta >= 0 ? '+' : ''}${Math.round(delta.closure_rate_delta * 100)}pp)`;
    const firstName = (leader.preferred_name || leader.full_name || '').split(' ')[0];

    lines.push(`*${firstName}* ${arrow} ${pct}%${deltaTxt}`);
    lines.push(`  ✅ fechou ${sc.tasks_closed} • ⚠️ ${sc.tasks_overdue} atrasadas • 🔒 ${sc.tasks_stuck} travadas 3+`);
    if (sc.insights) lines.push(`  _${sc.insights}_`);
    if (sc.top_bottlenecks?.[0]) {
      const b = sc.top_bottlenecks[0];
      lines.push(`  🎯 bottleneck: *${CATEGORY_LABELS[b.category] || b.category}* (${b.count})`);
    }
    lines.push('');
  }

  lines.push('_Versão individual de cada líder vai chegar 9h._');
  return lines.join('\n').trim();
}

/**
 * Renderiza versão INDIVIDUAL pro próprio líder (sem comparar com outros).
 */
function renderForLeader(scorecard, leader) {
  const pct = Math.round(scorecard.closure_rate * 100);
  const firstName = (leader.preferred_name || leader.full_name || '').split(' ')[0];
  const lines = [`📊 *Sua semana, ${firstName}*\n`];

  lines.push(`✅ Fechou *${scorecard.tasks_closed}* tarefas (${pct}% de fechamento)`);
  if (scorecard.tasks_overdue > 0) {
    lines.push(`⚠️ *${scorecard.tasks_overdue}* ainda abertas/atrasadas`);
  }
  if (scorecard.tasks_stuck > 0) {
    lines.push(`🔒 *${scorecard.tasks_stuck}* travadas com 3+ cobranças — vamos destravar?`);
  }

  if (scorecard.top_bottlenecks?.[0]) {
    const b = scorecard.top_bottlenecks[0];
    lines.push('');
    lines.push(`Padrão da semana: *${CATEGORY_LABELS[b.category] || b.category}* concentrou ${b.count} pendências.`);
  }

  const delta = scorecard.delta_vs_prev || {};
  if (!delta.is_first_week && delta.closure_rate_delta != null) {
    lines.push('');
    if (delta.closure_rate_delta >= 0.10) {
      lines.push(`🏆 Bora! Semana melhor que a anterior (+${Math.round(delta.closure_rate_delta * 100)}pp).`);
    } else if (delta.closure_rate_delta <= -0.10) {
      lines.push(`👀 Semana ${Math.round(delta.closure_rate_delta * 100)}pp abaixo da anterior. Me chama se quiser destravar.`);
    } else {
      lines.push(`📊 Estável vs semana anterior.`);
    }
  }

  lines.push('');
  lines.push(`_Quer puxar isso no seu time? Posso te ajudar a montar a conversa._`);
  return lines.join('\n');
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
