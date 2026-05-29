#!/usr/bin/env node
// Smoke: roda o health-check e imprime SÓ o check known_issues_regression.
// Uso (no VPS): cd /opt/LA-Organizer && node --env-file=.env scripts/smoke-known-issues.js
process.chdir('/opt/LA-Organizer');
const { runHealthCheck } = require('../src/rituals/health-check');

(async () => {
  const r = await runHealthCheck();
  const k = (r.checks || []).find((c) => c.name === 'known_issues_regression');
  console.log('KNOWN_ISSUES_CHECK:', JSON.stringify(k));
  process.exit(0);
})().catch((e) => { console.error('FAIL:', e.message); process.exit(1); });
