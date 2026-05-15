// src/services/per-user-queue.js — Serializa o processamento de mensagens
// por usuário (phone). Mensagens do MESMO phone rodam em sequência;
// usuários diferentes seguem em paralelo. Mantém um Map<phone, Promise>
// como cauda da fila — anexa cada novo trabalho ao .then() do anterior.
//
// Uso:
//   const queue = require('./services/per-user-queue');
//   queue.enqueue(phone, () => processMessage(phone, text, body));
//
// Não é durável — em memória apenas. Reset no restart do PM2 é aceitável
// porque novas mensagens chegam com novos webhooks.

const queues = new Map();

function enqueue(key, fn) {
  if (!key || typeof fn !== 'function') return Promise.resolve();
  const prev = queues.get(key) || Promise.resolve();
  // .then(fn, fn) garante que o próximo trabalho roda mesmo se o anterior rejeitou.
  const next = prev.then(fn, fn).catch(err => {
    const msg = err && err.message ? err.message : err;
    const stack = err && err.stack ? `\n${err.stack}` : '';
    console.error(`[Queue] task err for ${String(key).slice(-4)}: ${msg}${stack}`);
  });
  queues.set(key, next);
  // Cleanup quando esta tarefa termina E ela ainda for a cauda atual.
  next.finally(() => {
    if (queues.get(key) === next) queues.delete(key);
  });
  return next;
}

function activeKeys() {
  return [...queues.keys()];
}

function size() {
  return queues.size;
}

module.exports = { enqueue, activeKeys, size };
