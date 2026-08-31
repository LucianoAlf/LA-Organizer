'use strict';

// Detecta resposta de RSVP "crua" (essencialmente só sim/não/talvez) a um convite
// de evento. Usado pelo engine pra resolver presença DETERMINISTICAMENTE quando há
// convite pendente — SEM depender do LLM escolher o evento certo.
//
// Causa-raiz (RSVP-WRONG-EVENT-BARE, caso Luciano 09/06): um "Sim" solto, com vários
// eventos no contexto, fazia o LLM confabular o evento ERRADO (um passado) e NÃO emitir
// o marker <<EVENT_UPDATE>>{action:rsvp}. Como a resolução determinística (applyRsvp +
// resolvePendingInviteEventId) só roda QUANDO o marker é emitido, ela nunca disparava.
//
// Narrow de propósito: só casa quando a mensagem é ESSENCIALMENTE uma afirmação/negação
// curta. "sim, mas remarca pra sexta" → null (cai no LLM). A decisão de short-circuitar
// fica no engine, que só age se ALÉM disso houver UM convite pendente recente.

const { stripReplyScaffold } = require('./detect-approval-reply');

function norm(s) {
  return String(s || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '') // remove acentos
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')                     // pontuação/emoji → espaço
    .replace(/\s+/g, ' ')
    .trim();
}

// Conjuntos curados — frases INTEIRAS (não substring) que são RSVP inequívoco.
const CONFIRMED = new Set([
  'sim', 'simm', 'simmm', 'vou', 'vou sim', 'sim vou', 'eu vou', 'vou estar',
  'confirmo', 'confirmado', 'confirmada', 'confirmar', 'confirmadissimo',
  'bora', 'presente', 'estarei', 'estarei presente', 'estou dentro', 'to dentro',
  'pode confirmar', 'pode marcar', 'confirmo presenca', 'sim confirmo',
  // 3a pessoa do imperativo (finding 3b37b568): o Set tinha confirmo/confirmar/
  // confirmado/pode confirmar e NAO tinha "confirma" -- a forma que a Ana Paula usou.
  'confirma', 'confirma sim', 'confirma por favor', 'confirmo por favor',
  'confirma pra mim', 'pode confirmar por favor',
]);
const DECLINED = new Set([
  'nao', 'naoo', 'nao vou', 'vou nao', 'nao posso', 'nao consigo', 'nao da',
  'nao darei', 'recuso', 'nao estarei', 'nao poderei', 'nao vou poder',
  'infelizmente nao', 'nao vou conseguir',
]);
const TENTATIVE = new Set([
  'talvez', 'talvez sim', 'vou tentar', 'se der', 'se eu conseguir', 'nao sei ainda',
]);

/**
 * @param {string} text mensagem do usuário (texto cru, pode ter pontuação/emoji)
 * @returns {{status:'confirmed'|'declined'|'tentative'}|null}
 */
function detectBareRsvpReply(text) {
  // A MEDIDA E A FALA DA PESSOA, NAO A CITACAO (finding 3b37b568, Ana Paula 01/07).
  // Responder o convite por reply-quote e o caminho NATURAL -- e era justamente o que
  // quebrava: o bloco citado entrava no texto, a mensagem chegava a 38 palavras e o gate
  // abaixo matava. O convite CITADO ainda por cima carrega "vou / nao vou / talvez", entao
  // medir o texto inteiro nao era so ruido, era ler as palavras do TOM como se fossem dela.
  // Mesmo helper que os irmaos detect-approval-reply e detect-project-status-intent usam.
  const { userText } = stripReplyScaffold(String(text || ''));
  const n = norm(userText);
  if (!n) return null;
  if (n.split(' ').length > 4) return null; // frase longa → não é RSVP cru → LLM
  if (CONFIRMED.has(n)) return { status: 'confirmed' };
  if (DECLINED.has(n)) return { status: 'declined' };
  if (TENTATIVE.has(n)) return { status: 'tentative' };
  return null;
}

module.exports = { detectBareRsvpReply, _norm: norm };
