#!/usr/bin/env node
// Smoke: checkProviderHealth lê tom_metrics e devolve {status, detail} válido.
process.chdir('/opt/LA-Organizer');
const { checkProviderHealth } = require('../src/rituals/health-check');

(async () => {
  const r = await checkProviderHealth();
  console.log('status:', r.status);
  console.log('detail:', r.detail);
  const ok = r
    && ['ok', 'warning', 'error'].includes(r.status)
    && typeof r.detail === 'string'
    && (/mediana/.test(r.detail) || /Sem mensagens/.test(r.detail));
  console.log(ok ? 'SMOKE PASS' : 'SMOKE FAIL');
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error('FAIL:', e.message); process.exit(1); });
