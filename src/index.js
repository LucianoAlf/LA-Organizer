const express = require('express');
const config = require('./config');
const webhook = require('./webhook');
const { startCrons } = require('./services/ritual');

const app = express();
app.use(express.json({ limit: '5mb' }));
app.use(webhook);

app.listen(config.port, () => {
  console.log('');
  console.log('🎵 TOM Engine — LA Organizer');
  console.log('   Porta:', config.port);
  console.log('   AI: Claude Code CLI + Codex fallback');
  console.log('');
  startCrons();
  console.log('✅ TOM pronto. Aguardando mensagens...');
});

process.on('SIGTERM', () => process.exit(0));
process.on('SIGINT', () => process.exit(0));
process.on('unhandledRejection', err => console.error('[TOM] Erro:', err.message));
