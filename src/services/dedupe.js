// src/services/dedupe.js — Cache em memória pra reconhecer reentregas
// do mesmo evento de webhook (UAZAPI às vezes reenvia se a resposta atrasa,
// ou o cliente pode disparar curl duplicado em testes).
//
// Política:
// - Chave preferencial: id estável da mensagem (body.message.id, body.messages[0].id, etc).
// - Fallback: hash(phone | event_type | minute | content[0..200]).
//   Granularidade de minuto evita colisão no caso comum de uma mensagem repetida
//   em outro turno (ex.: o usuário digita "fiz" duas vezes, separadas por minutos).
// - LRU FIFO simples — quando passa MAX, descarta a entrada mais antiga.
// - TTL 24h — expira mesmo sem pressão de tamanho, no caso de tráfego baixo.
// - Reset no restart do PM2 (não persistente).

const crypto = require('crypto');

const MAX_ENTRIES = 1000;
const TTL_MS = 24 * 60 * 60 * 1000;

const seen = new Map(); // key -> expiresAt

function getMessageId(body) {
  if (!body || typeof body !== 'object') return null;
  const m = (body.message && typeof body.message === 'object') ? body.message
    : (Array.isArray(body.messages) && body.messages[0]) || {};
  const candidates = [
    m && m.id,
    m && m.messageid,
    m && m.message_id,
    m && m.key && m.key.id,
    body.id,
    body.messageid,
    body.message_id,
  ];
  for (const c of candidates) {
    if (typeof c === 'string' && c.length >= 4) return 'mid:' + c;
  }
  return null;
}

function fallbackKey(body) {
  const msg = (body && body.message) || (Array.isArray(body && body.messages) && body.messages[0]) || {};
  const phone = String(
    (body && body.chat && body.chat.wa_chatid) ||
    msg.chatid || msg.from || ''
  ).replace(/\D/g, '').slice(-13);
  const text = String(msg.content || msg.text || msg.body || '').slice(0, 200);
  const event = String((body && body.EventType) || (body && body.event) || '');
  const minute = Math.floor(Date.now() / 60000); // 1-min bucket
  const hash = crypto.createHash('sha1')
    .update(phone + '|' + event + '|' + minute + '|' + text)
    .digest('hex').slice(0, 16);
  return 'fb:' + hash;
}

function eventKey(body) {
  return getMessageId(body) || fallbackKey(body);
}

// Returns true if this body was already processed recently. Marks as seen on
// first call. Map insertion order is FIFO; we drop the oldest entry when over capacity.
function isDuplicate(body) {
  const key = eventKey(body);
  const now = Date.now();
  const exp = seen.get(key);
  if (exp != null) {
    if (exp > now) return true;
    seen.delete(key); // expired — fall through and re-insert
  }
  seen.set(key, now + TTL_MS);
  if (seen.size > MAX_ENTRIES) {
    const oldestKey = seen.keys().next().value;
    if (oldestKey !== undefined) seen.delete(oldestKey);
  }
  return false;
}

function size() { return seen.size; }

module.exports = { isDuplicate, eventKey, size };
