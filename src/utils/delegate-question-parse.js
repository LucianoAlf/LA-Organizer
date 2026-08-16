'use strict';
// delegate-question-parse.js — Fatia 5 (confirmação parse-on-open, delegação).
//
// Extrai {task_title, to_name} da pergunta de delegação do TOM, nos 2 templates:
//   A) "Delego pra Mayra … — *'título'*. Confirma?"      (destinatário ANTES do título)
//   B) "Delego a tarefa *título* pro Alf …? Confirma?"    (destinatário DEPOIS do título)
// Puro (sem I/O). A resolução título→short-id (fail-closed) é o complete-titles-resolve.js.
//
// Título = 1º bloco em *negrito* (strip de aspas). Destinatário = nome próprio após pra/pro/para,
// buscado com os blocos em negrito REMOVIDOS (pra não casar nome dentro do título, ex.: "para o
// pai da Amelie"). Fail-closed: faltando título OU destinatário → null.

const NEG_RE = /\bn[ãa]o\s+delego/i;
const ANCHOR_RE = /\bdelego\b/i;
const BOLD_RE = /\*([^*]+)\*/;
const BOLD_GLOBAL = /\*[^*]+\*/g;
const DEST_RE = /\b(?:pra|pro|para)\s+([A-ZÀ-Ú][\p{L}'-]*(?:\s+[A-ZÀ-Ú][\p{L}'-]*)?)/u;

function _stripAspas(s) {
  return String(s).trim().replace(/^["“”'']+/, '').replace(/["“”'']+$/, '').trim();
}

function parseDelegateConfirmQuestion(reply) {
  if (typeof reply !== 'string' || !reply.trim()) return null;
  if (NEG_RE.test(reply)) return null;
  if (!ANCHOR_RE.test(reply)) return null;

  const mT = BOLD_RE.exec(reply);
  if (!mT) return null;
  const task_title = _stripAspas(mT[1]);
  if (!task_title) return null;

  const semNegrito = reply.replace(BOLD_GLOBAL, ' ');
  const mD = DEST_RE.exec(semNegrito);
  if (!mD) return null;
  const to_name = mD[1].trim();
  if (!to_name) return null;

  return { task_title, to_name };
}

module.exports = { parseDelegateConfirmQuestion };
