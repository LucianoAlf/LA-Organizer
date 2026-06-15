// src/services/pending-pdf.js — guarda em memória um PDF protegido aguardando a senha (que vem
// numa mensagem SEPARADA). TTL 10min; 1 PDF pendente por telefone. (Rose 14/06)
const TTL_MS = 10 * 60 * 1000;
const _store = new Map(); // phone -> { buffer, mime, fileName, ts }

function put(phone, { buffer, mime, fileName } = {}) {
  if (!phone || !buffer) return;
  _store.set(String(phone), { buffer, mime: mime || 'application/pdf', fileName: fileName || '', ts: Date.now() });
}
function get(phone) {
  const e = _store.get(String(phone));
  if (!e) return null;
  if (Date.now() - e.ts > TTL_MS) { _store.delete(String(phone)); return null; }
  return e;
}
function has(phone) { return get(phone) != null; }
function clear(phone) { _store.delete(String(phone)); }

module.exports = { put, get, has, clear };
