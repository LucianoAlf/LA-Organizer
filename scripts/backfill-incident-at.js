// scripts/backfill-incident-at.js
// Preenche incident_at/incident_confidence nos findings existentes a partir do evidence.
// Rodar na VPS (RETIDO pelo HOLD até OK do Alf): node --env-file=.env scripts/backfill-incident-at.js
'use strict';
const { createClient } = require('@supabase/supabase-js');
const { resolveIncidentAt } = require('../src/services/conversation-audit');

(async () => {
  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  const { data: rows } = await sb.from('tom_audit_findings')
    .select('id, collaborator_id, evidence, occurred_at, created_at, incident_at')
    .is('incident_at', null);
  let done = 0;
  for (const f of rows || []) {
    const since = new Date(Date.parse(f.created_at) - 24 * 3600 * 1000).toISOString();
    const inc = await resolveIncidentAt(sb, f.collaborator_id, f.evidence, f.occurred_at, since);
    await sb.from('tom_audit_findings')
      .update({ incident_at: inc.incident_at, incident_confidence: inc.incident_confidence })
      .eq('id', f.id);
    done++;
  }
  console.log(`backfill incident_at: ${done} findings`);
})().catch(e => { console.error(e); process.exit(1); });
