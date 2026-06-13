// VPS: node --env-file=.env scripts/smoke-task-group.js
// Smoke do motor createTaskGroup contra o banco real (grupo descartável) + cleanup.
const path = require('path');
process.chdir(path.join(__dirname, '..'));
const supabase = require('../src/supabase/client');
const { createTaskGroup } = require('../src/services/task-groups');
const GID = 'd95f63af-5032-4120-89f2-ca4c49684cbc';
const CREATOR = '8bfb18b6-3c2e-4579-b4a9-06409d7e84c4';
const TAG = 'SMOKE-PACOTE-ZZZ';

(async () => {
  const r = await createTaskGroup({ supabase, groupId: GID, createdBy: CREATOR,
    input: { title: `${TAG}`, recurrence: 'monthly', groupDay: 5, subtasks: [
      { title: `${TAG} A`, day: 10 }, { title: `${TAG} B`, day: 12 },
    ] } });
  console.log('createTaskGroup →', JSON.stringify(r));
  // verifica a estrutura
  const { data: all } = await supabase.from('tasks')
    .select('id, title, is_group, recurrence_rule, recurrence_parent_id, parent_task_id, due_date, status')
    .eq('assigned_group_id', GID).ilike('title', `${TAG}%`).order('is_group', { ascending: false });
  const tpl = all.find((t) => t.is_group && t.recurrence_rule);
  const inst = all.find((t) => t.is_group && t.recurrence_parent_id);
  console.log('template:', tpl && { id: tpl.id, rrule: tpl.recurrence_rule, due: tpl.due_date });
  console.log('instancia:', inst && { id: inst.id, rparent: inst.recurrence_parent_id, due: inst.due_date });
  console.log('filhas inst:', all.filter((t) => t.parent_task_id === (inst && inst.id)).map((t) => `${t.title}@${t.due_date}`));
  console.log('total linhas SMOKE:', all.length);
  // cleanup: apaga TUDO do smoke (delete real, é lixo de teste)
  const ids = all.map((t) => t.id);
  if (ids.length) await supabase.from('tasks').delete().in('id', ids);
  console.log('cleanup: removidas', ids.length, 'linhas');
})().catch((e) => { console.error('ERRO:', e.message); process.exit(1); });
