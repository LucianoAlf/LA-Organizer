const express = require('express');
const config = require('./config');
const webhook = require('./webhook');
const internalApi = require('./internal-api');
const { startCrons } = require('./services/ritual');
const shutdown = require('./services/shutdown');
const { startRealtime } = require('./realtime/tom-realtime');
const { startGroupChatWatcher } = require('./realtime/group-chat-watcher');
const whatsapp = require('./services/whatsapp');
const supabase = require('./supabase/client');
const webhookPersistence = require('./services/webhook-persistence');

const app = express();
// `verify` callback expõe o buffer cru pra validação HMAC no /webhook.
// Sem isso, express.json() consome o stream e o body original somente reaparece serializado.
app.use(express.json({
  limit: '5mb',
  verify: (req, _res, buf) => { req.rawBody = buf; },
}));
app.use(webhook);
app.use(internalApi);

const server = app.listen(config.port, '127.0.0.1', () => {
  const pkg = (() => { try { return require('../package.json'); } catch (_) { return { version: 'unknown' }; } })();
  console.log('');
  console.log('👽 TOM Engine — LA Organizer');
  console.log(`[TOM] PROCESS START pid=${process.pid} version=${pkg.version} node=${process.version} at=${new Date().toISOString()}`);
  console.log('   Porta:', config.port);
  console.log('   AI: Claude Code CLI + Codex fallback');
  console.log('');
  startCrons();
  // Sprint 34 — Realtime subscriber (event-driven, complementa o cron de 15min)
  startRealtime((phone, msg) => whatsapp.sendMessage(phone, msg), supabase);
  // Fase 2 — TOM engaja no chat de grupo (poll de role='member', responde role='tom')
  startGroupChatWatcher(supabase);
  console.log('✅ TOM pronto. Aguardando mensagens...');
  // Sinaliza ready pro PM2 (ecosystem.config.js usa wait_ready:true)
  if (typeof process.send === 'function') process.send('ready');
  // Sprint WQ — replay webhooks salvos durante graceful shutdown do ciclo anterior.
  // 2s de delay pra garantir que o engine está totalmente pronto antes do replay.
  setTimeout(() => webhookPersistence.replayPending(webhook.processWebhookBody), 2000);
});

// Sprint 23.14 — graceful shutdown: aguarda processMessage em curso terminar
// (max 30s) antes de exit. Evita perda de mensagem em deploy/restart.
shutdown.installGracefulShutdown(server, 30000);
process.on('unhandledRejection', err => console.error('[TOM] Erro:', err.message));
