'use strict';

// Trunca mensagens longas do HISTÓRICO (cards, listas) pra carregar mais turnos sem inflar
// o custo de cada chamada — MAS preserva INTEIROS os blocos estruturados (fatura), senão o
// TOM fica cego ao resto. Regressão TOM-SHORT-MEMORY-HISTORY5 (14/06): o _trunc de 1000 chars
// decapitava o [FATURA_JSON] (3376 chars, 31 itens) → TOM não via o resto da fatura (Rose 15/06).
// A mensagem ATUAL nunca passa por aqui (só o histórico).

const HIST_MSG_MAX = 1000;
// Teto para LISTAS multi-linha (item-bearing, como fatura): preserva inteira até aqui.
// ~1 mensagem de WhatsApp. Acima disso corta em fronteira de linha, com marcador honesto.
const HIST_LIST_MAX = 4000;
// A partir de quantas quebras de linha o conteúdo conta como "lista" (colagem enumerada).
const LIST_MIN_LINES = 8;

// Blocos estruturados que NÃO podem ser cortados no meio (perde itens da fatura).
const KEEP_WHOLE = /\[FATURA/i; // [FATURA_JSON], [FATURA_TEXTO], etc.

/**
 * @param {string} content  conteúdo da mensagem do histórico
 * @param {number} [max]    teto de PROSA (default HIST_MSG_MAX)
 * @returns {string}
 */
function truncateHistoryMsg(content, max = HIST_MSG_MAX) {
  const str = String(content || '');
  if (str.length <= max) return str;
  if (KEEP_WHOLE.test(str)) return str; // bloco estruturado: preserva inteiro
  // HIST-TRUNC-LIST-BLIND (Leo 18/06, finding 29b8751b): uma LISTA colada (90 itens de
  // inventário, 95 quebras) era decapitada em 1000 chars → turnos depois o TOM ficava cego ao
  // rabo e CONFABULAVA que "a lista chegou cortada, só vejo até o item 38". Lista é item-bearing
  // igual à fatura → preserva inteira até HIST_LIST_MAX; acima disso corta em fronteira de linha.
  const newlines = (str.match(/\n/g) || []).length;
  if (newlines >= LIST_MIN_LINES) {
    if (str.length <= HIST_LIST_MAX) return str;
    const head = str.slice(0, HIST_LIST_MAX);
    const cut = head.lastIndexOf('\n');
    return (cut > 0 ? head.slice(0, cut) : head) + '\n…[lista longa truncada no histórico]';
  }
  return str.slice(0, max) + ' …[mensagem longa truncada no histórico]';
}

module.exports = { truncateHistoryMsg, HIST_MSG_MAX, HIST_LIST_MAX };
