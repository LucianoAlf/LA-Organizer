#!/usr/bin/env node
// Teste force: relatório de compromissos em aberto (08:30 BRT)
// Uso: cd /opt/LA-Organizer && node --env-file=.env scripts/test-governance-events.js
const path = require('path');
process.chdir('/opt/LA-Organizer');

const { ceoTeamUnclosedEventsReport } = require('../src/rituals/dispatcher');

(async () => {
  console.log('[TEST] Disparando ceoTeamUnclosedEventsReport com force=true...');
  try {
    await ceoTeamUnclosedEventsReport(new Date(), { force: true });
    console.log('[TEST] OK — mensagem enviada (ou sem dados p/ enviar).');
  } catch (err) {
    console.error('[TEST] ERRO:', err.message);
    process.exit(1);
  }
  process.exit(0);
})();
