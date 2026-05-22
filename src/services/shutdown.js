// Sprint 23.14 — Graceful shutdown.
// Sem isso, `pm2 restart tom` enviava SIGTERM → process.exit(0) imediato,
// matando processMessage em curso. Mensagens do WhatsApp ficavam órfãs
// (per-user-queue é em memória, não persiste).
//
// Uso:
//   const shutdown = require('./services/shutdown');
//   shutdown.installGracefulShutdown(httpServer, 30000);
//
// Em qualquer trabalho async crítico (processMessage, dispatch, etc):
//   shutdown.trackStart();
//   try { /* ... */ } finally { shutdown.trackEnd(); }
//
// SIGTERM agora:
//   1. Marca isShuttingDown=true (consumidores podem skipar trabalho novo)
//   2. server.close() — para de aceitar novos webhooks
//   3. Aguarda activeProcesses chegar a 0 (max timeoutMs, default 30s)
//   4. process.exit(0)
//
// PM2 ecosystem.config.js precisa `kill_timeout >= timeoutMs + 5000`
// pra dar margem antes do SIGKILL.

let isShuttingDown = false;
let activeProcesses = 0;

function isInShutdown() { return isShuttingDown; }
function active() { return activeProcesses; }

function trackStart() {
  activeProcesses++;
}

function trackEnd() {
  activeProcesses--;
  if (activeProcesses < 0) activeProcesses = 0;
}

async function withTracking(fn) {
  trackStart();
  try { return await fn(); }
  finally { trackEnd(); }
}

function installGracefulShutdown(server, timeoutMs = 30000) {
  const handler = async (sig) => {
    if (isShuttingDown) return; // idempotente — sinal duplo não reentra
    isShuttingDown = true;
    console.log(`[TOM] ${sig} recebido — graceful shutdown (active=${activeProcesses}, timeout=${timeoutMs}ms)`);

    // Para de aceitar novos webhooks/HTTP — conexões existentes terminam
    if (server && typeof server.close === 'function') {
      try { server.close(); } catch (e) { console.warn('[TOM] server.close err:', e.message); }
    }

    const deadline = Date.now() + timeoutMs;
    while (activeProcesses > 0 && Date.now() < deadline) {
      await new Promise(r => setTimeout(r, 250));
    }

    if (activeProcesses > 0) {
      console.log(`[TOM] timeout graceful (${timeoutMs}ms) — ${activeProcesses} processo(s) ainda ativo(s) serão perdidos`);
    } else {
      console.log('[TOM] fila vazia — encerrando limpo');
    }
    process.exit(0);
  };

  process.on('SIGTERM', () => handler('SIGTERM'));
  process.on('SIGINT', () => handler('SIGINT'));
}

module.exports = {
  installGracefulShutdown,
  isInShutdown,
  trackStart,
  trackEnd,
  withTracking,
  active,
};
