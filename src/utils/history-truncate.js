'use strict';

// Trunca mensagens longas do HISTÓRICO (cards, listas) pra carregar mais turnos sem inflar
// o custo de cada chamada — MAS preserva INTEIROS os blocos estruturados (fatura), senão o
// TOM fica cego ao resto. Regressão TOM-SHORT-MEMORY-HISTORY5 (14/06): o _trunc de 1000 chars
// decapitava o [FATURA_JSON] (3376 chars, 31 itens) → TOM não via o resto da fatura (Rose 15/06).
// A mensagem ATUAL nunca passa por aqui (só o histórico).

const HIST_MSG_MAX = 1000;

// Blocos estruturados que NÃO podem ser cortados no meio (perde itens da fatura).
const KEEP_WHOLE = /\[FATURA/i; // [FATURA_JSON], [FATURA_TEXTO], etc.

/**
 * @param {string} content  conteúdo da mensagem do histórico
 * @param {number} [max]    teto (default HIST_MSG_MAX)
 * @returns {string}
 */
function truncateHistoryMsg(content, max = HIST_MSG_MAX) {
  const str = String(content || '');
  if (str.length <= max) return str;
  if (KEEP_WHOLE.test(str)) return str; // bloco estruturado: preserva inteiro
  return str.slice(0, max) + ' …[mensagem longa truncada no histórico]';
}

module.exports = { truncateHistoryMsg, HIST_MSG_MAX };
