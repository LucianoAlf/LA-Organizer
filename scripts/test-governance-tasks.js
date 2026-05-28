#!/usr/bin/env node
// Teste force: relatório de tarefas atrasadas (08:45 BRT)
// Uso: cd /opt/LA-Organizer && node --env-file=.env scripts/test-governance-tasks.js
const path = require('path');
process.chdir('/opt/LA-Organizer');

const { ceoTeamUnclosedTasksReport } = require('../src/rituals/dispatcher');

(async () => {
  console.log('[TEST] Disparando ceoTeamUnclosedTasksReport com force=true...');
  try {
    await ceoTeamUnclosedTasksReport(new Date(), { force: true });
    console.log('[TEST] OK — mensagem enviada (ou sem dados p/ enviar).');
  } catch (err) {
    console.error('[TEST] ERRO:', err.message);
    process.exit(1);
  }
  process.exit(0);
})();
