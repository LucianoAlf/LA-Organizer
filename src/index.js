const express = require('express');
const config = require('./config');
const webhook = require('./webhook');
const { startCrons } = require('./services/ritual');

const app = express();
// `verify` callback expõe o buffer cru pra validação HMAC no /webhook.
// Sem isso, express.json() consome o stream e o body original somente reaparece serializado.
app.use(express.json({
  limit: '5mb',
  verify: (req, _res, buf) => { req.rawBody = buf; },
}));
app.use(webhook);

app.listen(config.port, () => {
  const pkg = (() => { try { return require('../package.json'); } catch (_) { return { version: 'unknown' }; } })();
  console.log('');
  console.log('👽 TOM Engine — LA Organizer');
  console.log(`[TOM] PROCESS START pid=${process.pid} version=${pkg.version} node=${process.version} at=${new Date().toISOString()}`);
  console.log('   Porta:', config.port);
  console.log('   AI: Claude Code CLI + Codex fallback');
  console.log('');
  startCrons();
  console.log('✅ TOM pronto. Aguardando mensagens...');
});

process.on('SIGTERM', () => process.exit(0));
process.on('SIGINT', () => process.exit(0));
process.on('unhandledRejection', err => console.error('[TOM] Erro:', err.message));
