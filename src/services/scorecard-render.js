// src/services/scorecard-render.js — Sprint 29.3 / Task 5 (redesign digest governança, 16/07)
//
// Funções PURAS de renderização do scorecard semanal — sem I/O, sem `await`, sem
// require de supabase. Extraídas de scorecard-builder.js porque esse módulo faz
// `require('../supabase/client')` no topo (linha 15), e `src/supabase/` é gitignored
// (tem chaves) — não existe fora da VPS. Isso impedia rodar QUALQUER teste local de
// scorecard-builder.js, mesmo pra funções que não tocam banco. renderForDirector e
// renderForLeader nunca tiveram teste por essa razão.
//
// scorecard-builder.js importa e RE-EXPORTA renderForDirector/renderForLeader — nenhum
// caller externo muda (só src/rituals/monday-scorecard.js usa, via `builder.*`).
//
// Rodar: node --test src/services/scorecard-render.test.js

'use strict';

const CATEGORY_LABELS = {
  la_music: 'LA Music', mentoria: 'Mentoria', pedagogico: 'Pedagógico',
  operacional: 'Operacional', operational: 'Operacional', comercial: 'Comercial',
  acolhimento: 'Acolhimento', marketing: 'Marketing', sem_categoria: 'Sem categoria',
  pessoal: 'Pessoal',
};

// Primeiro nome de exibição — preferred_name > full_name.
const _name = (l) => (l.preferred_name || l.full_name || '').split(' ')[0];

// Sem nota (§7.3 da spec 16/07) não imprime 0% — não imprime nada. `Math.round(null * 100)`
// dá 0 (null coage pra 0 em aritmética JS): sem este helper, quem não tem nota apareceria
// com "0% de fechamento" — o bug OPOSTO ao "100% de zero" que a Task 5 veio consertar.
// Guard é `=== null || === undefined`, NUNCA `??`/`||` — 0 é nota real e tem que passar.
const pctOf = (rate) => (rate === null || rate === undefined) ? null : Math.round(rate * 100);

// Desempate DETERMINÍSTICO — o loader não tem ORDER BY em nenhuma query, então a ordem
// de entrada é a do heap do Postgres e muda sozinha após UPDATE/VACUUM (mesma doença que
// as Tasks 1 e 2 curaram). `.sort()` é estável, o que só PRESERVA essa ordem instável.
const byNameThenId = (a, b) =>
  String(a.leader.full_name || '').localeCompare(String(b.leader.full_name || ''), 'pt-BR') ||
  String(a.leader.id).localeCompare(String(b.leader.id));

// Pior nota primeiro, SEM NOTA por último — explicitamente. `a.closure_rate - b.closure_rate`
// coagia `null` pra 0, empatando "sem nota" com "0% real", que são OPOSTOS: 0% é o pior
// desempenho possível (fechou 0 de 3); sem nota é ausência do que medir. Comparar por
// Infinity resolveria o lado errado e ainda daria `Infinity - Infinity = NaN` entre dois
// sem-nota (comparator inválido = ordem indefinida). O tiebreak fecha o bloco de empates
// que este próprio fix cria: todos os sem-nota agora empatam entre si.
const byRateNoScoreLast = (a, b) => {
  const ra = a.sc.closure_rate, rb = b.sc.closure_rate;
  const na = ra === null || ra === undefined;
  const nb = rb === null || rb === undefined;
  if (na !== nb) return na ? 1 : -1;      // quem não tem nota vai depois de quem tem
  if (!na && ra !== rb) return ra - rb;   // ambos com nota: pior primeiro (régua de hoje)
  return byNameThenId(a, b);              // empate real (inclusive 2 sem-nota)
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
    // Guard de null OBRIGATÓRIO: `null < 0.60` é `true` em JS (null coage pra 0).
    const badPct = sc.closure_rate !== null && sc.closure_rate !== undefined && sc.closure_rate < 0.60;
    const midPct = sc.closure_rate !== null && sc.closure_rate !== undefined && sc.closure_rate < 0.85;
    if (!hasNoTasks && (badPct || sc.tasks_overdue >= 3 || sc.tasks_stuck >= 2)) {
      atencao.push({ sc, leader });
    } else if (!hasNoTasks && (midPct || sc.tasks_overdue >= 1)) {
      olhar.push({ sc, leader });
    } else {
      ritmo.push({ sc, leader });
    }
  }

  // Ordena grupos: pior primeiro em atenção/olhar, mais tarefas primeiro em ritmo
  atencao.sort(byRateNoScoreLast);
  olhar.sort(byRateNoScoreLast);
  // Mais fechadas primeiro; o tiebreak fecha o empate (comum: vários líderes com o mesmo
  // tasks_closed). Sem ele o bloco 🟢 — que imprime os nomes em LINHA — reembaralhava
  // sozinho na cara do CEO, sem nenhum dado ter mudado: `.sort()` é estável e preservava
  // a ordem de entrada, que é a do heap do Postgres. Mesma doença da #9 (Tasks 1 e 2).
  ritmo.sort((a, b) => (b.sc.tasks_closed - a.sc.tasks_closed) || byNameThenId(a, b));

  const lines = [];
  lines.push('📊 *Scorecard semanal — seus líderes*');
  lines.push(SEP2);
  lines.push('');

  // --- 🔴 ATENÇÃO ---
  if (atencao.length > 0) {
    lines.push(`🔴 *Atenção — ${atencao.length} líder${atencao.length > 1 ? 'es' : ''}*`);
    for (const { sc, leader } of atencao) {
      const pct = pctOf(sc.closure_rate);
      const bot = sc.top_bottlenecks?.[0];
      const botTxt = bot ? ` • ${CATEGORY_LABELS[bot.category] || bot.category}` : '';
      const stuck = sc.tasks_stuck >= 2 ? ` • ${sc.tasks_stuck} travadas 3+` : '';
      const pctTxt = pct === null ? '' : `${pct}% fechamento, `;
      lines.push(`• *${_name(leader)}* — ${pctTxt}${sc.tasks_overdue} atrasada${sc.tasks_overdue !== 1 ? 's' : ''}${stuck}${botTxt}`);
      if (sc.insights) lines.push(`  _${sc.insights}_`);
    }
    lines.push('');
  }

  // --- 🟡 OLHAR ---
  if (olhar.length > 0) {
    lines.push(SEP);
    lines.push(`🟡 *Olhar de perto — ${olhar.length} líder${olhar.length > 1 ? 'es' : ''}*`);
    for (const { sc, leader } of olhar) {
      const pct = pctOf(sc.closure_rate);
      const bot = sc.top_bottlenecks?.[0];
      const botTxt = bot ? ` • ${CATEGORY_LABELS[bot.category] || bot.category}` : '';
      const pctTxt = pct === null ? '' : `${pct}%, `;
      lines.push(`• *${_name(leader)}* — ${pctTxt}${sc.tasks_overdue} atrasada${sc.tasks_overdue !== 1 ? 's' : ''}${botTxt}`);
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
  const pct = pctOf(scorecard.closure_rate);
  const SEP = '─────────────────────';

  const lines = [`📊 *Sua semana, ${firstName}*`, SEP, ''];

  if (hasNoTasks) {
    lines.push('Nenhuma tarefa registrada esta semana.');
    lines.push('_Quer começar a registrar? É só me mandar o que tá no seu radar._');
    return lines.join('\n');
  }

  // Métricas principais
  lines.push(`✅ *${scorecard.tasks_closed}* fechada${scorecard.tasks_closed !== 1 ? 's' : ''}${pct === null ? '' : ` — *${pct}% de fechamento*`}`);
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

module.exports = { renderForDirector, renderForLeader, pctOf, CATEGORY_LABELS };
