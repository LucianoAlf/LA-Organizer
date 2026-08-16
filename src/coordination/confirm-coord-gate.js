'use strict';
// confirm-coord-gate.js — Fatia 8. Decide se uma pergunta de confirmação SEM payload executável é
// uma proposta de RECADO — então o "sim" pode instruir o LLM a compor+emitir COORDINATION_REQUEST
// (despacho direto, pré-confirmado) em vez de cair no ramo "desiste e pede pra repetir". Espelha o
// confirm-create-gate: FAIL-CLOSED, e veta se a pergunta mexe em item existente. PURO.
//
// A Fatia 3 cobre recado com TEXTO explícito (parse-on-open). O implícito ("Mando um agradecimento
// pro X?") não tem texto extraível — quem compõe é o LLM, sob a intenção que o próprio TOM propôs
// e o usuário aprovou. O bypass do estágio é seguro porque a confirmação JÁ aconteceu (turno anterior).

// Reusa o veto de "ação sobre item existente" do create-gate (deleg/fecha/cancel/apaga/reagenda…).
const { ACAO_SOBRE_EXISTENTE } = require('../utils/confirm-create-gate');

// Sinal de que o TOM está PROPONDO mandar um recado/aviso a alguém.
const PROPOE_RECADO = new RegExp([
  '\\bavis(?:o|ar)\\s+(?:o|a|os|as|\\d|pra|pro|para)\\b',
  '\\baviso\\s+\\d+\\s+pessoa',
  '\\bmand(?:o|ar)\\s+(?:um[a]?\\s+)?(?:recado|mensagem|aviso|agradecimento)',
  '\\bmand(?:o|ar)\\s+(?:pra|pro|para)\\b',
  '\\bpasso?\\s+o\\s+recado', '\\brepass(?:o|ar)\\s+(?:o\\s+)?(?:recado|agradecimento|mensagem)',
  '\\bfal(?:o|ar)\\s+com\\b', '\\bagrade[çc](?:o|er)\\b',
].join('|'), 'iu');

/**
 * A pergunta de confirmação pode liberar despacho de RECADO (COORDINATION_REQUEST)?
 * @param {string} perguntaDoTom  question_text da intent
 * @returns {boolean} true só quando é proposta de recado sem menção a ação sobre item existente
 */
function podeLiberarRecado(perguntaDoTom) {
  if (typeof perguntaDoTom !== 'string') return false;
  const t = perguntaDoTom.trim();
  if (!t) return false;
  if (ACAO_SOBRE_EXISTENTE.test(t)) return false;  // veta primeiro (fail-closed)
  return PROPOE_RECADO.test(t);
}

module.exports = { podeLiberarRecado, PROPOE_RECADO };
