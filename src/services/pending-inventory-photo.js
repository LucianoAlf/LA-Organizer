// src/services/pending-inventory-photo.js
//
// Cache EM MEMÓRIA da última foto que um telefone mandou por WhatsApp, pra anexar
// ao item de inventário quando o insert acontecer — que costuma ser TURNOS depois
// (foto+legenda → "qual sala?" → "sala 7" → insert). Sem schema novo; processo
// único (pm2), então Map em memória basta. TTL curto pra não anexar foto velha.
//
// Capturado em services/media.js (quando a imagem chega) e consumido no handler
// <<INVENTORY_ACTION>> do engine (action insert/create) via uploadFotoItem.
//
// Memória: 1 entrada por telefone (a última sobrescreve), base64 ~ tamanho da foto.
// Bounded pelo TTL + clear-on-use.

const TTL_MS = 10 * 60 * 1000; // 10 min

/** @type {Map<string, {base64:string, contentType:string, ts:number}>} */
const store = new Map();

function set(phone, base64, contentType, now = Date.now()) {
  if (!phone || !base64) return; // defensivo: sem foto, não guarda
  store.set(String(phone), { base64, contentType: contentType || 'image/jpeg', ts: now });
}

function get(phone, now = Date.now()) {
  if (!phone) return null;
  const e = store.get(String(phone));
  if (!e) return null;
  if (now - e.ts > TTL_MS) { store.delete(String(phone)); return null; }
  return e;
}

function clear(phone) {
  if (phone) store.delete(String(phone));
}

module.exports = { set, get, clear, TTL_MS };
