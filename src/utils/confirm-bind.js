'use strict';
// confirm-bind.js — citation gate do "sim" ancorado (Ana 10/07).
//
// CONFIRM-ANCHOR-WRONGBIND: quando há um pending_intent ANCORADO de complete aberto e o
// user manda uma FRASE-LONGA com um done-verb ("Bombonha Alice - feito ..."), o
// detectUserConfirmation(allowDone) retorna 'yes' (via DONE_ANYWHERE, BATCH-CONFIRM-IMPERATIVE-NUM)
// e o engine confirmava o anchor MESMO quando a frase é sobre OUTRO alvo ("Bombonha Alice"
// ≠ "Falar com a Fefê") → completava a tarefa errada e o log de hábito se perdia.
//
// Regra (ressalva da catraca — NÃO pode quebrar BATCH-CONFIRM-*): a confirmação de frase-longa
// só AMARRA no anchor se mencionar algo DELE — TÍTULO, ou NÚMERO (Rose "conclui as 3"), ou
// "tudo/todas/geral". Só BLOQUEIA (→ cai no LLM, fail-safe) quando não menciona NADA do anchor.
// Confirmação CURTA (≤4 palavras, "feito"/"sim") = genérica → sempre amarra (comportamento atual).
//
// @param {string} userText  — a fala do user (já é uma confirmação: detectUserConfirmation deu 'yes')
// @param {string} anchorTitle — payload.anchor.title do intent ancorado
// @returns {boolean} true = pode confirmar o anchor; false = não amarra (LLM decide)
function confirmationBindOk(userText, anchorTitle) {
  const t = String(userText == null ? '' : userText).toLowerCase();
  const words = t.split(/\s+/).filter(Boolean);
  // Confirmação curta = genérica ("feito", "já fiz", "sim pode fechar") → amarra (atual).
  if (words.length <= 4) return true;
  // Frase-longa: só amarra se mencionar algo do anchor.
  if (/\d+/.test(t)) return true;                          // número (BATCH-CONFIRM-IMPERATIVE-NUM)
  if (/\b(tudo|todas?|td|geral)\b/.test(t)) return true;   // confirmação global
  const title = String(anchorTitle == null ? '' : anchorTitle).toLowerCase();
  const titleWords = title.split(/\s+/).filter((w) => w.length >= 4); // palavras significativas do título
  if (titleWords.length === 0) return true;                // sem título aferível → não dá pra bloquear
  if (titleWords.some((w) => t.includes(w))) return true;  // cita o título
  return false;                                            // frase-longa sem menção ao anchor → LLM
}

module.exports = { confirmationBindOk };
