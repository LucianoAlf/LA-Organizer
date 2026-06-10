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
//   1. Marca isShuttingDown=true
//   2. NÃO fecha o servidor HTTP — porta fica aberta (Sprint WQ)
//      webhook.js detecta isInShutdown() → salva payload no banco → retorna 200
//      Assim uazapi não perde o webhook nem retenta. index.js replaya no próximo startup.
//   3. Aguarda activeProcesses chegar a 0 (max timeoutMs, default 30s)
//   4. process.exit(0)
//
// PM2 ecosystem.config.js precisa `kill_timeout >= timeoutMs + 5000`
// pra dar margem antes do SIGKILL.

let isShuttingDown = false;
let activeProcesses = 0;

// INFLIGHT-LOST-ON-RESTART (caso Rose/Ana Paula 09/06 21:45): mensagens JÁ em
// processMessage no SIGTERM eram perdidas em silêncio no timeout ("serão perdidos").
// Módulos registram um drain hook (ex.: webhook.js salva payloads in-flight na fila
// de replay) que roda SEMPRE antes do exit — inclusive quando active=0, pra cobrir
// mensagens ainda no buffer de agregação.
const drainHooks = [];
function registerDrainHook(fn) { if (typeof fn === 'function') drainHooks.push(fn); }

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

    // Sprint WQ: NÃO chama server.close() — porta 3100 fica aberta durante shutdown.
    // Webhooks que chegam nessa janela são salvos no banco pelo webhook.js (isInShutdown check)
    // e replayados pelo index.js no próximo startup. Assim uazapi recebe 200 e não perde msgs.

    const deadline = Date.now() + timeoutMs;
    while (activeProcesses > 0 && Date.now() < deadline) {
      await new Promise(r => setTimeout(r, 250));
    }

    if (activeProcesses > 0) {
      console.log(`[TOM] timeout graceful (${timeoutMs}ms) — ${activeProcesses} processo(s) ainda ativo(s); salvando in-flight pra replay`);
    } else {
      console.log('[TOM] fila vazia — encerrando limpo');
    }
    // Drena SEMPRE (mesmo com active=0): cobre msgs no buffer de agregação (3.5s)
    // que ainda nem viraram processMessage. Hook idempotente: só salva o que não
    // terminou (o finally do processMessage remove os concluídos do registro).
    for (const hook of drainHooks) {
      try { await hook(); } catch (e) { console.error('[TOM] drain hook err:', e.message); }
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
  registerDrainHook,
};
