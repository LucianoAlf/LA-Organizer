'use strict';

// Detector determinístico de intenção de MUDAR STATUS DE PROJETO por chat (fechar/cancelar).
// Irmão de src/events/detect-approval-reply.js. Lê a fala REAL via stripReplyScaffold
// (família FINEDIT-QUOTE-SCAFFOLD-MISROUTE: nunca casar no texto cru com a citação).
// KRISSYA-PROJECT-CLOSE-NO-HANDLER (auditoria 30/06).
const { stripReplyScaffold } = require('../events/detect-approval-reply');

const COMPLETE_RE = /\b(fech(?:a|ar|o|ei|ando)|conclu[ií](?:r|ndo|do|da|o|i)?|encerr(?:a|ar|o|ando)|finaliz(?:a|ar|o|ando))\b/i;
const CANCEL_RE = /\b(cancel(?:a|ar|o|ando))\b/i;
const PROJECT_RE = /\bprojetos?\b/i;
const ARTICLES = new Set(['o', 'a', 'os', 'as', 'esse', 'essa', 'este', 'esta', 'esses', 'essas', 'um', 'uma', 'meu', 'minha']);

// Extrai o nome após o token "projeto". Retorna string (>=2 chars) ou null.
function _extractNameAfterProjeto(text) {
  const m = text.match(/\bprojetos?\b\s*[:\-–]?\s*(.+)$/i);
  if (!m || !m[1]) return null;
  let name = m[1].trim()
    .replace(/^["'“”]+|["'“”]+$/g, '')
    .replace(/[?!.…]+$/g, '')
    .trim();
  const words = name.split(/\s+/);
  if (words.length && ARTICLES.has(words[0].toLowerCase())) words.shift();
  name = words.join(' ').trim();
  return name.length >= 2 ? name : null;
}

function detectProjectStatusIntent(rawText) {
  const { userText, quotedText } = stripReplyScaffold(String(rawText || ''));
  const text = (userText || '').trim();
  if (!text) return null;
  if (/\?\s*$/.test(text)) return null; // pergunta não é comando (lição EVENT-CONFAB)

  const hasCancel = CANCEL_RE.test(text);
  const hasComplete = COMPLETE_RE.test(text);
  if (!hasCancel && !hasComplete) return null;
  const action = hasCancel ? 'cancel' : 'complete'; // cancel é mais específico → precedência

  const q = quotedText || null;
  // Via 1: token "projeto" presente na fala real (intenção EXPLÍCITA — pode consumir o turno
  // mesmo que não ache o projeto, pois o usuário citou "projeto" de propósito).
  if (PROJECT_RE.test(text)) {
    return { action, nameHint: _extractNameAfterProjeto(text), quotedText: q, viaProjectToken: true };
  }
  // Via 2: reply-bare (verbo + scaffold, sem token projeto) → resolve por quote depois.
  // viaProjectToken=false: se não casar um projeto, o engine NÃO consome o turno (cai no LLM),
  // pra "fecha isso" respondendo a uma TAREFA não virar "não achei um projeto".
  if (q != null) {
    return { action, nameHint: null, quotedText: q, viaProjectToken: false };
  }
  // Sem token projeto e sem reply → null (colisão com complete de tarefa)
  return null;
}

module.exports = { detectProjectStatusIntent, _extractNameAfterProjeto };
