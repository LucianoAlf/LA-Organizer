'use strict';
// complete-question-parse.js — Fatia 4 (confirmação parse-on-open, complete/fechamento).
//
// Extrai os TÍTULOS (em *negrito*) da pergunta de fechamento do TOM ("Confirma o fechamento
// destas 2 tarefas: *X*, *Y*?") pra o hook resolver título→id e estagiar batch_complete — assim
// o "sim" fecha determinístico em vez de o LLM desistir ("perdi o fio"). Puro (sem I/O).
//
// FAIL-CLOSED no parse: sem títulos EM NEGRITO → null (não adivinha por split de vírgula, que
// quebraria em título com vírgula). A resolução título→id (fail-closed em ambiguidade) é o
// módulo complete-titles-resolve.js. Títulos crus (inclusive "(2×)") — a resolução decide.

const NEG_RE = /\bn[ãa]o\s+confirm/i;
// Âncora: "...fechamento (desta tarefa | destas N tarefas):" + tudo depois (dotall).
const ANCHOR_RE = /fechamento\s+(?:desta\s+tarefa|destas?\s+\d+\s+tarefas?)\s*:(.*)$/is;
const BOLD_RE = /\*([^*]+)\*/g;

function parseCompleteConfirmQuestion(reply) {
  if (typeof reply !== 'string' || !reply.trim()) return null;
  if (NEG_RE.test(reply)) return null;

  const m = ANCHOR_RE.exec(reply);
  if (!m) return null;

  const titles = [];
  let b;
  BOLD_RE.lastIndex = 0;
  while ((b = BOLD_RE.exec(m[1])) !== null) {
    const t = b[1].trim();
    if (t) titles.push(t);
  }
  return titles.length ? { titles } : null;
}

module.exports = { parseCompleteConfirmQuestion };
