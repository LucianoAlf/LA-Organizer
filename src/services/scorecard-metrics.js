// src/services/scorecard-metrics.js — Task 5 (redesign digest governança, 16/07)
//
// Cálculo de deltas + geração do insight 💡 — SEM require de banco. Extraído de
// scorecard-builder.js (que faz `require('../supabase/client')` no topo, módulo
// gitignored que não existe fora da VPS) pelo mesmo motivo de scorecard-render.js:
// era impossível testar local. `computeDelta` continua no builder (ele FAZ a query da
// semana anterior); só a aritmética pura dos deltas mora aqui, em `diffMetrics`.
//
// `generateInsight` veio INTEIRO: ele só depende de `ai/provider` (nunca de supabase).
// O caminho "sem nota" retorna antes de chamar o LLM, então é testável local sem mock.
// O prompt, o tom e o tamanho das frases estão VERBATIM como estavam — a voz do TOM não
// muda aqui; o que muda é não inventar número pra quem não tem nota.
//
// scorecard-builder.js importa e RE-EXPORTA `generateInsight` — nenhum caller muda.
//
// Rodar: node --test src/services/scorecard-metrics.test.js

'use strict';

const ai = require('../ai/provider');

// Tem nota? §7.3: `closure_rate` é nullable desde a Task 5 (sem denominador não é 100%,
// é SEM NOTA). Guard explícito `=== null || === undefined`, NUNCA `!rate`/`??`/`||` —
// 0 é nota REAL (fechou 0 de 3) e não pode ser confundido com ausência de nota.
const hasScore = (rate) => rate !== null && rate !== undefined;

/**
 * Deltas entre a semana atual e a anterior. PURA.
 *
 * `closure_rate_delta` é `null` se QUALQUER das duas semanas não tiver nota: sem os dois
 * termos não existe variação. Sem este guard, `null - 0.5` é `-0.5` em JS (null coage pra
 * 0, sem NaN pra denunciar) e o líder recebia "📉 50pp abaixo da semana anterior" — uma
 * queda FABRICADA, quando o real é que não houve sinal medível. O guard de quem consome
 * (`delta.closure_rate_delta != null`) não salvava: o delta não era null, era ERRADO.
 * As outras 3 são deltas de CONTAGEM (nunca nulas) e seguem normalmente.
 */
function diffMetrics(currentMetrics, prevSc) {
  const bothScored = hasScore(currentMetrics.closure_rate) && hasScore(prevSc.closure_rate);
  return {
    closure_rate_delta: bothScored
      ? Math.round((currentMetrics.closure_rate - prevSc.closure_rate) * 100) / 100
      : null,
    closed_delta: currentMetrics.tasks_closed - prevSc.tasks_closed,
    overdue_delta: currentMetrics.tasks_overdue - prevSc.tasks_overdue,
    stuck_delta: currentMetrics.tasks_stuck - prevSc.tasks_stuck,
  };
}

// A ÚNICA frase do fallback que é verdadeira SEM número: lê `coordination_request_count >= 3`
// e não toca em `closure_rate`. É o "cobrar mais não resolve, muda de tática" — a mais
// acionável do relatório. Helper único pros dois caminhos (com e sem nota) pra voz não divergir.
const stuckInsight = (metrics) => `Travamentos crônicos em ${metrics.tasks_stuck} itens — recomendo 1:1 dirigido.`;

/**
 * Gera 1 frase de insight via LLM. Fallback determinístico em caso de falha.
 * Sem nota → só o que é verdadeiro sem número (travamento), senão `null`.
 */
async function generateInsight(leader, metrics, delta) {
  // §7.3 — sem nota não se INVENTA número, mas o que é verdadeiro SEM número continua sendo
  // dito. `Math.round(null * 100)` é 0 (não NaN, sem nada pra denunciar): sem este guard o
  // prompt dizia "Fechamento: 0%" e o fallback cuspia "Fechamento baixo (0%) — investigar
  // carga ou bloqueios" pra quem não tem nota nenhuma — mesma classe do "100% de zero" que a
  // Task 5 veio matar, só que na frase do 💡.
  //   • LLM: NUNCA, sem nota (o prompt carregaria o 0% fabricado). Economiza a chamada.
  //   • Travamento: SIM — não depende de nota; matá-lo junto perderia informação boa.
  //   • Senão: null. Os consumidores já tratam a ausência: `if (sc.insights)` (render:86)
  //     e `if (scorecard.insights && ...)` (render:174).
  if (!hasScore(metrics.closure_rate)) {
    return metrics.tasks_stuck >= 3 ? stuckInsight(metrics) : null;
  }

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
  if (metrics.tasks_stuck >= 3) return stuckInsight(metrics);
  if (closurePct >= 80) return `Semana sólida (${closurePct}% fechamento). Manter o ritmo.`;
  if (closurePct < 50) return `Fechamento baixo (${closurePct}%) — investigar carga ou bloqueios.`;
  return `Fechamento razoável (${closurePct}%). ${metrics.tasks_overdue} atrasadas pra destravar.`;
}

module.exports = { diffMetrics, generateInsight };
