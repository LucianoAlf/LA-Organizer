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
 * Renderiza versão CONSOLIDADA pro director — hierarquia CEO-first.
 * CEO deve conseguir escanear em <10s: quem precisa de ação vs quem está bem.
 *
 * Classificação:
 *   🔴 Atenção: closure < 60% OU 3+ atrasadas OU 2+ travadas (precisa ter tarefas)
 *   🟡 Olhar:   closure < 85% OU 1+ atrasadas (precisa ter tarefas)
 *   🟢 Ritmo:   todos os demais (incluindo sem tarefas registradas)
 */
function renderForDirector(scorecards, leadersById) {
  if (!scorecards || scorecards.length === 0) return null;

  const SEP  = '─────────────────────';
  const SEP2 = '━━━━━━━━━━━━━━━━━━━━━';

  // Classificar cada líder por urgência
  const atencao = [], olhar = [], ritmo = [];
  for (const sc of scorecards) {
    const leader = leadersById.get(sc.leader_id);
    if (!leader) continue;
    const hasNoTasks = sc.tasks_closed === 0 && sc.tasks_overdue === 0 && sc.tasks_stuck === 0;
    if (!hasNoTasks && (sc.closure_rate < 0.60 || sc.tasks_overdue >= 3 || sc.tasks_stuck >= 2)) {
      atencao.push({ sc, leader });
    } else if (!hasNoTasks && (sc.closure_rate < 0.85 || sc.tasks_overdue >= 1)) {
      olhar.push({ sc, leader });
    } else {
      ritmo.push({ sc, leader });
    }
  }

  // Ordena grupos: pior primeiro em atenção/olhar, mais tarefas primeiro em ritmo
  atencao.sort((a, b) => a.sc.closure_rate - b.sc.closure_rate);
  olhar.sort((a, b) => a.sc.closure_rate - b.sc.closure_rate);
  ritmo.sort((a, b) => b.sc.tasks_closed - a.sc.tasks_closed);

  const _name = l => (l.preferred_name || l.full_name || '').split(' ')[0];

  const lines = [];
  lines.push('📊 *Scorecard semanal — seus líderes*');
  lines.push(SEP2);
  lines.push('');

  // --- 🔴 ATENÇÃO ---
  if (atencao.length > 0) {
    lines.push(`🔴 *Atenção — ${atencao.length} líder${atencao.length > 1 ? 'es' : ''}*`);
    for (const { sc, leader } of atencao) {
      const pct = Math.round(sc.closure_rate * 100);
      const bot = sc.top_bottlenecks?.[0];
      const botTxt = bot ? ` • ${CATEGORY_LABELS[bot.category] || bot.category}` : '';
      const stuck = sc.tasks_stuck >= 2 ? ` • ${sc.tasks_stuck} travadas 3+` : '';
      lines.push(`• *${_name(leader)}* — ${pct}% fechamento, ${sc.tasks_overdue} atrasada${sc.tasks_overdue !== 1 ? 's' : ''}${stuck}${botTxt}`);
      if (sc.insights) lines.push(`  _${sc.insights}_`);
    }
    lines.push('');
  }

  // --- 🟡 OLHAR ---
  if (olhar.length > 0) {
    lines.push(SEP);
    lines.push(`🟡 *Olhar de perto — ${olhar.length} líder${olhar.length > 1 ? 'es' : ''}*`);
    for (const { sc, leader } of olhar) {
      const pct = Math.round(sc.closure_rate * 100);
      const bot = sc.top_bottlenecks?.[0];
      const botTxt = bot ? ` • ${CATEGORY_LABELS[bot.category] || bot.category}` : '';
      lines.push(`• *${_name(leader)}* — ${pct}%, ${sc.tasks_overdue} atrasada${sc.tasks_overdue !== 1 ? 's' : ''}${botTxt}`);
    }
    lines.push('');
  }

  // --- 🟢 NO RITMO ---
  lines.push(SEP);
  const ritmoLabel = `🟢 *No ritmo — ${ritmo.length} líder${ritmo.length > 1 ? 'es' : ''}*`;
  lines.push(ritmoLabel);

  // Destaca quem mais fechou; colapsa o resto numa linha
  const comTarefas = ritmo.filter(r => r.sc.tasks_closed > 0).slice(0, 5);
  const resto = ritmo.length - comTarefas.length;
  if (comTarefas.length > 0) {
    const inline = comTarefas.map(r => `${_name(r.leader)} ${r.sc.tasks_closed}✅`).join(' · ');
    lines.push(inline + (resto > 0 ? ` · _+${resto} estáveis_` : ''));
  } else if (ritmo.length > 0) {
    lines.push(ritmo.map(r => _name(r.leader)).join(', '));
  }

  lines.push('');
  lines.push(SEP2);
  lines.push('_Versão individual de cada líder: enviada às 9h_');

  return lines.join('\n').trim();
}

/**
 * Renderiza versão INDIVIDUAL pro próprio líder (sem comparar com outros).
 */
function renderForLeader(scorecard, leader) {
  const firstName = (leader.preferred_name || leader.full_name || '').split(' ')[0];
  const hasNoTasks = scorecard.tasks_closed === 0 && scorecard.tasks_overdue === 0 && scorecard.tasks_stuck === 0;
  const pct = Math.round(scorecard.closure_rate * 100);
  const SEP = '─────────────────────';

  const lines = [`📊 *Sua semana, ${firstName}*`, SEP, ''];

  if (hasNoTasks) {
    lines.push('Nenhuma tarefa registrada esta semana.');
    lines.push('_Quer começar a registrar? É só me mandar o que tá no seu radar._');
    return lines.join('\n');
  }

  // Métricas principais
  lines.push(`✅ *${scorecard.tasks_closed}* fechada${scorecard.tasks_closed !== 1 ? 's' : ''} — *${pct}% de fechamento*`);
  if (scorecard.tasks_overdue > 0) {
    lines.push(`⚠️ *${scorecard.tasks_overdue}* ainda abert${scorecard.tasks_overdue !== 1 ? 'as' : 'a'}/atrasada${scorecard.tasks_overdue !== 1 ? 's' : ''}`);
  }
  if (scorecard.tasks_stuck > 0) {
    lines.push(`🔒 *${scorecard.tasks_stuck}* travada${scorecard.tasks_stuck !== 1 ? 's' : ''} com 3+ cobranças — vamos destravar?`);
  }

  // Bottleneck
  if (scorecard.top_bottlenecks?.[0]) {
    const b = scorecard.top_bottlenecks[0];
    lines.push('');
    lines.push(`🎯 Padrão: *${CATEGORY_LABELS[b.category] || b.category}* concentrou ${b.count} pendência${b.count !== 1 ? 's' : ''}.`);
  }

  // Delta vs semana anterior
  const delta = scorecard.delta_vs_prev || {};
  if (!delta.is_first_week && delta.closure_rate_delta != null) {
    lines.push('');
    if (delta.closure_rate_delta >= 0.10) {
      lines.push(`📈 Semana melhor que a anterior (+${Math.round(delta.closure_rate_delta * 100)}pp). Bora manter!`);
    } else if (delta.closure_rate_delta <= -0.10) {
      lines.push(`📉 ${Math.round(Math.abs(delta.closure_rate_delta * 100))}pp abaixo da semana anterior. Me chama se precisar destravar.`);
    } else {
      lines.push(`➡️ Estável vs semana anterior.`);
    }
  }

  // Insight LLM (apenas se existir e for diferente do óbvio)
  if (scorecard.insights && !scorecard.delta_vs_prev?.is_first_week) {
    lines.push('');
    lines.push(`_${scorecard.insights}_`);
  }

  lines.push('');
  lines.push(SEP);
  lines.push('_Quer conversar sobre essa semana? Me chama._');
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
