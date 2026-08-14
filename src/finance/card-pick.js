'use strict';
// src/finance/card-pick.js
// Payload determinístico pra retomar uma ação de cartão depois de resolver qual cartão a
// pessoa quis dizer, SEM depender do LLM reconstruir o contexto no turno seguinte.
//
// TASK-COMPLETE-ALVO-NAO-ACHADO tem um irmão financeiro (caso Rose, 14/08): pay_invoice,
// query_invoice e card_refund perguntavam "Qual cartão?" com texto solto — nenhum abria
// pending-intent. Cada resposta seguinte exigia que o LLM reconstruísse o alvo do zero a
// partir da conversa em texto puro, e falhava sempre que a resposta não repetia o nome do
// cartão ("Fatura de agosto", "Tom" sozinho). Ela repetiu "Cartão Nubank" 3 vezes e levou a
// mesma pergunta 3 vezes.
//
// card_purchase já resolvia isso com pending-intents (`finance_source`, form:'list') — este
// módulo espelha o mesmo padrão pros três handlers que ficaram de fora.

/**
 * @param {string} action ação a retomar quando o cartão for escolhido (pay_invoice|query_invoice|card_refund)
 * @param {Object} params params já conhecidos do turno original (sem o card resolvido)
 * @param {Array<{id:string, name:string}>} cards candidatos mostrados na pergunta
 * @returns {{form:'card_pick', action:string, params:Object, candidates:Array}}
 */
function payloadCardPick(action, params, cards) {
  return {
    form: 'card_pick',
    action,
    params: { ...(params || {}) },
    candidates: (Array.isArray(cards) ? cards : []).map((c) => ({ kind: 'card', id: c.id, name: c.name })),
  };
}

module.exports = { payloadCardPick };
