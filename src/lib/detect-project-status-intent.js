'use strict';

// Detector determinístico de intenção de MUDAR STATUS DE PROJETO por chat (fechar/cancelar).
// Irmão de src/events/detect-approval-reply.js. Lê a fala REAL via stripReplyScaffold
// (família FINEDIT-QUOTE-SCAFFOLD-MISROUTE: nunca casar no texto cru com a citação).
// KRISSYA-PROJECT-CLOSE-NO-HANDLER (auditoria 30/06).
const { stripReplyScaffold } = require('../events/detect-approval-reply');

const COMPLETE_RE = /\b(fech(?:a|ar|o|ei|ando)|conclu[ií](?:r|ndo|do|da|o|i)?|encerr(?:a|ar|o|ando)|finaliz(?:a|ar|o|ando))\b/i;
const CANCEL_RE = /\b(cancel(?:a|ar|o|ando))\b/i;
const PROJECT_RE = /\bprojetos?\b/i;
// KRISSYA-PROJECT-SYSTEM-REMOVE-NO-TOKEN (07/07): "L.A teclas concluido, pode tirar do
// sistema" — o "concluido" já casava COMPLETE_RE, mas sem o token "projeto" e sem quote
// o detector devolvia null (anti-colisão com tarefas) → caía no LLM → nenhum marker →
// chokepoint "não consegui". O idioma "tirar/remover/... do sistema/app" é sinal
// administrativo tão explícito quanto o token "projeto" → Via 3, SEMPRE com
// viaProjectToken=false: o engine só consome o turno se o nome casar um projeto VIVO
// (senão cai no LLM como hoje — "tira o leite da lista" não muda).
const REMOVE_RE = /\b(tir(?:a|ar|o|e|em|ando)|remov(?:e|er|o|a|am|endo)|exclu(?:i|ir|o|a|am|indo)|apag(?:a|ar|o|ue|uem|ando)|delet(?:a|ar|o|e|em|ando))\b/i;
const SYSTEM_RE = /\bd[oe]\s+(?:sistema|app|aplicativo|organizer)\b/i;
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

// Nome pro caso "system removal" (Via 3), bidirecional:
//   B: nome ENTRE o verbo e o alvo — "tira o LA Teclas do sistema"
//   A: nome ANTES do verbo — "L.A teclas concluido, pode tirar do sistema"
// Preserva pontuação interna do nome ("L.A"); remove verbos de status e ruído.
function _extractNameFromSystemRemoval(text) {
  const b = text.match(/\b(?:tir|remov|exclu|apag|delet)\w*\s+(.+?)\s+d[oe]\s+(?:sistema|app|aplicativo|organizer)\b/i);
  let name = b && b[1] ? b[1] : null;
  if (!name) {
    const a = text.match(/^(.*?)\b(?:tir|remov|exclu|apag|delet)\w*/i);
    name = a && a[1] ? a[1] : null;
  }
  if (!name) return null;
  name = name
    .replace(COMPLETE_RE, ' ')
    .replace(CANCEL_RE, ' ')
    .replace(/\b(j[áa]|est[áa]|t[áa]|foi|pode(?:m|s)?|favor|por)\b/gi, ' ')
    .replace(/["'“”]+/g, ' ')
    .replace(/[,;:!?…]+/g, ' ')
    .replace(/\.+\s*$/, '')
    .replace(/\s+/g, ' ')
    .trim();
  const words = name.split(/\s+/).filter(Boolean);
  while (words.length && ARTICLES.has(words[0].toLowerCase())) words.shift();
  name = words.join(' ').trim();
  return name.length >= 2 ? name : null;
}

function detectProjectStatusIntent(rawText) {
  const { userText, quotedText } = stripReplyScaffold(String(rawText || ''));
  const text = (userText || '').trim();
  if (!text) return null;
  // PROJECT-INTENT-TRANSCRIPT-HIJACK (Luciano 08/07): transcrição de reunião colada no
  // chat (multi-linha, centenas de chars) continha "projeto"+"fechar" em falas → a Via 1
  // consumia o turno e respondia "Não achei um projeto com esse nome" em 0.8s. Comando
  // real é CURTO e direto (1-2 linhas): texto longo/muitas linhas → null (cai no LLM).
  if (text.length > 280 || (text.match(/\n/g) || []).length >= 5) return null;
  if (/\?\s*$/.test(text)) return null; // pergunta não é comando (lição EVENT-CONFAB)

  const hasCancel = CANCEL_RE.test(text);
  const hasComplete = COMPLETE_RE.test(text);
  // Via 3 (KRISSYA-PROJECT-SYSTEM-REMOVE-NO-TOKEN): remover + "do sistema/app".
  const hasSystemRemoval = REMOVE_RE.test(text) && SYSTEM_RE.test(text);
  if (!hasCancel && !hasComplete && !hasSystemRemoval) return null;
  // cancel explícito > complete > remoção pura (= cancelar/arquivar; o confirm-first
  // pergunta antes de agir de qualquer forma). "concluido, tira do sistema" → complete.
  const action = hasCancel ? 'cancel' : (hasComplete ? 'complete' : 'cancel');

  const q = quotedText || null;
  // Via 1: token "projeto" presente na fala real (intenção EXPLÍCITA — pode consumir o turno
  // mesmo que não ache o projeto, pois o usuário citou "projeto" de propósito).
  if (PROJECT_RE.test(text)) {
    return { action, nameHint: _extractNameAfterProjeto(text), quotedText: q, viaProjectToken: true };
  }
  // Via 3: sem token "projeto", mas com o idioma "tirar/remover do sistema". nameHint
  // extraído da frase; viaProjectToken=false → só consome se casar projeto vivo.
  if (hasSystemRemoval) {
    return { action, nameHint: _extractNameFromSystemRemoval(text), quotedText: q, viaProjectToken: false };
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
