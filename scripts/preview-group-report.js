// scripts/preview-group-report.js — VPS: node --env-file=.env scripts/preview-group-report.js
// Roda buildGroupReport pro Financeiro e mostra o HTML + confere a contagem de tarefas.
const supabase = require('../src/supabase/client');
const { buildGroupReport } = require('../src/services/group-report-builder');
const GID = 'd95f63af-5032-4120-89f2-ca4c49684cbc';
(async () => {
  const { count } = await supabase.from('tasks')
    .select('id', { count: 'exact', head: true })
    .eq('assigned_group_id', GID).neq('status', 'done');
  console.log('Tarefas abertas no banco:', count);
  const { html } = await buildGroupReport({ supabase, groupId: GID, scope: 'tudo', window: 'mes' });
  const li = (html.match(/<li>/g) || []).length;
  console.log('Itens <li> no card:', li);
  console.log('===== CARD HTML =====');
  console.log(html);
})().catch((e) => { console.error('ERRO:', e.message); process.exit(1); });
