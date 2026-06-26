'use strict';
// Caminho 2 / Fatia 1 — Modelo α: o ENGINE escreve a linha honesta de "não dá pelo chat".
// Caloroso, na voz do TOM (referência de tom = launch_confirm). NUNCA robótico:
// "Operação fora da janela permitida" é a LINHA VERMELHA — mata a voz e reprova no DoD.

/**
 * @param {{reason?:string, redirect?:{app_path?:string, why?:string}}} verdict  saída de resolveFinanceCapability
 * @returns {string} a LINHA do fato (o LLM só põe carinho em volta, nunca dentro)
 */
function buildHonestRedirect(verdict = {}) {
  const r = verdict.redirect || {};
  const path = r.app_path || 'Finanças → Transações → toque no lançamento';
  const why = r.why || 'fora do que eu alcanço pelo chat';
  if (verdict.reason === 'ambiguous_target') {
    return `Achei mais de um lançamento parecido — pra eu não mexer no errado, me diz qual (o valor ou a data). Ou, se preferir, ajusta rapidinho no app: *${path}*. 👍`;
  }
  return `Esse lançamento já tá ${why} — mas no app você resolve em segundos: *${path}* → toca no lançamento e edita. Qualquer coisa me chama! 👍`;
}

module.exports = { buildHonestRedirect };
