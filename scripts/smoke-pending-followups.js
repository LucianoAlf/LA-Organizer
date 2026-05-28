#!/usr/bin/env node
// Smoke test: pending-followups service end-to-end.
// Uso: cd /opt/LA-Organizer && node --env-file=.env scripts/smoke-pending-followups.js
process.chdir('/opt/LA-Organizer');

const pf = require('../src/services/pending-followups');

const YURI = '5bb97642-bbc1-44c5-a3dc-bdab74347011';
const VIDEO_CADU = 'd2f9e026-3015-4db9-a1e2-9549230dd3de';

(async () => {
  console.log('[smoke] listActive ANTES:');
  const before = await pf.listActive(YURI);
  console.log('  count =', before.length);
  for (const f of before) console.log('   -', f.target_title, '(', f.followup_kind, ')');

  console.log('[smoke] resolveByTarget Video CADU → completed (simula marker EVENT_UPDATE)');
  const n = await pf.resolveByTarget({
    collaboratorId: YURI,
    targetType: 'event',
    targetId: VIDEO_CADU,
    action: 'completed',
    via: 'smoke-test',
  });
  console.log('  resolveByTarget retornou:', n, '(esperado 1)');

  console.log('[smoke] listActive DEPOIS:');
  const after = await pf.listActive(YURI);
  console.log('  count =', after.length);

  console.log('[smoke] createOrRefresh — refresh deve detectar inexistente e criar');
  const r = await pf.createOrRefresh({
    collaboratorId: YURI,
    targetType: 'event',
    targetId: VIDEO_CADU,
    targetTitle: 'Video CADU [smoke]',
    kind: 'overdue_check',
    questionText: 'smoke test question',
    ttlHours: 1,
  });
  console.log('  create result:', r);

  console.log('[smoke] createOrRefresh DE NOVO — deve detectar existente e refresh');
  const r2 = await pf.createOrRefresh({
    collaboratorId: YURI,
    targetType: 'event',
    targetId: VIDEO_CADU,
    targetTitle: 'Video CADU [smoke refresh]',
    kind: 'overdue_check',
    questionText: 'smoke test refresh question',
    ttlHours: 1,
  });
  console.log('  create result (refresh esperado):', r2);

  console.log('[smoke] expireOld (não deve marcar nenhum agora)');
  const exp = await pf.expireOld();
  console.log('  expireOld retornou:', exp);

  // Cleanup
  console.log('[smoke] cleanup → resolve+dismiss tudo do smoke');
  await pf.resolveByTarget({
    collaboratorId: YURI,
    targetType: 'event',
    targetId: VIDEO_CADU,
    action: 'dismissed',
    via: 'smoke-cleanup',
  });
  console.log('[smoke] FIM ✓');
  process.exit(0);
})().catch(err => {
  console.error('[smoke] FAIL:', err.message);
  console.error(err.stack);
  process.exit(1);
});
