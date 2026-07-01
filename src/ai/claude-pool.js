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

// Keep-alive: no modo paralelo o CANON fica sub-exercitado (só é tocado nos
// minutos de slack antes de expirar). Se o token vencer numa janela sem tráfego
// (madrugada), morre — e `claude -p` NÃO refresca token já expirado → TOM cai
// 100% no fallback. Este predicado diz quando disparar um refresh PROATIVO do
// CANON (antes de expirar): token dentro da margem OU validade desconhecida.
function shouldRefreshCanon(expiresAt, now, marginMs) {
  if (!expiresAt || expiresAt <= 0) return true;
  return (expiresAt - now) < marginMs;
}

function needsCredSync(srcMtimeMs, dstMtimeMs) {
  if (dstMtimeMs == null) return true;
  return dstMtimeMs < srcMtimeMs;
}

module.exports = { createSemaphore, decideRefreshMode, workerHomePath, needsCredSync, shouldRefreshCanon };
