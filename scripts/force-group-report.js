// VPS: node --env-file=.env scripts/force-group-report.js [preset]
// Força um disparo IGNORANDO o horário (mas respeitando claim diário). Default: daily_morning.
const path = require('path');
process.chdir(path.join(__dirname, '..'));
const supabase = require('../src/supabase/client');
const { presetConfig, claimGroupRitual, insertReportCard } = require('../src/rituals/group-reports');
const { buildGroupReport } = require('../src/services/group-report-builder');

const GID = 'd95f63af-5032-4120-89f2-ca4c49684cbc'; // Financeiro
const preset = process.argv[2] || 'daily_morning';

(async () => {
  const cfg = presetConfig(preset);
  if (!cfg) { console.error('preset inválido:', preset); process.exit(1); }
  const { data: g } = await supabase.from('work_groups').select('name').eq('id', GID).maybeSingle();
  const groupName = g?.name || 'grupo';
  const heading = cfg.headingTemplate.replace('{grupo}', groupName);
  const { html, isEmpty } = await buildGroupReport({ supabase, groupId: GID, scope: cfg.scope, window: cfg.window, onlyOverdue: cfg.onlyOverdue, heading });
  console.log('isEmpty:', isEmpty);
  if (cfg.onlyOverdue && isEmpty) { console.log('overdue vazio — nada a enviar'); return; }
  const ymd = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
  const claim = await claimGroupRitual(supabase, GID, preset, ymd);
  if (!claim.won) { console.log('claim não venceu (já enviado hoje?):', claim); return; }
  await insertReportCard(supabase, GID, html);
  console.log('card inserido p/', preset, '→ ver chat + WhatsApp');
})().catch((e) => { console.error('ERRO:', e.message); process.exit(1); });
