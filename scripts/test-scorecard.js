#!/usr/bin/env node
// Teste force: scorecard semanal director + líderes (segunda 8h/9h BRT)
// Uso: cd /opt/LA-Organizer && node --env-file=.env scripts/test-scorecard.js
const path = require('path');
process.chdir('/opt/LA-Organizer');

const { tick } = require('../src/rituals/monday-scorecard');

(async () => {
  console.log('[TEST] Disparando monday-scorecard (director + líderes) com force=true...');
  try {
    const result = await tick({ force: true });
    console.log('[TEST] resultado:', JSON.stringify(result, null, 2));
  } catch (err) {
    console.error('[TEST] ERRO:', err.message);
    process.exit(1);
  }
  process.exit(0);
})();
