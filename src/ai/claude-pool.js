// Lógica pura do pool de workers do CLI claude. SEM I/O (fs/spawn) — testável.
// O I/O (criar HOMEs, copiar credenciais, spawn) fica em claude.js.

// Semáforo de K slots, 1 por worker HOME. acquire() resolve com {home,index};
// se todos ocupados, enfileira e resolve quando alguém der release().
function createSemaphore(homes) {
  const slots = homes.map((home, index) => ({ home, index, busy: false }));
  const waiters = [];
  function acquire() {
    const free = slots.find((s) => !s.busy);
    if (free) { free.busy = true; return Promise.resolve(free); }
    return new Promise((resolve) => waiters.push(resolve));
  }
  function release(slot) {
    const s = slots[slot.index];
    if (!s) return;
    const next = waiters.shift();
    if (next) { next(s); } // permanece busy, repassado ao próximo
    else { s.busy = false; }
  }
  return {
    acquire,
    release,
    size: slots.length,
    available: () => slots.filter((s) => !s.busy).length,
  };
}

// 'canon' (serializa no CANON e deixa refrescar) quando falta < slack p/ expirar
// ou não há expiresAt; 'pool' (worker isolado) quando há folga.
function decideRefreshMode(expiresAt, now, slackMs) {
  if (!expiresAt || expiresAt <= 0) return 'canon';
  return (expiresAt - now) < slackMs ? 'canon' : 'pool';
}

function workerHomePath(canonHome, i) {
  return `${canonHome}-w${i}`;
}

function needsCredSync(srcMtimeMs, dstMtimeMs) {
  if (dstMtimeMs == null) return true;
  return dstMtimeMs < srcMtimeMs;
}

module.exports = { createSemaphore, decideRefreshMode, workerHomePath, needsCredSync };
