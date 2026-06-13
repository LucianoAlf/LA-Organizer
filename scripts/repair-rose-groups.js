// VPS: node --env-file=.env scripts/repair-rose-groups.js [--dry]
// Reparo dos grupos da Rose (Financeiro) usando o motor único createTaskGroup.
// (1) Conciliação de Cartões: cancela a árvore emaranhada e recria limpo.
// (2) Planilha do financeiro: cria pacote + cancela as soltas.
// (3) Aplicar cashbacks: cria pacote weekend_adjust + cancela as soltas.
const path = require('path');
process.chdir(path.join(__dirname, '..'));
const supabase = require('../src/supabase/client');
const { createTaskGroup } = require('../src/services/task-groups');

const GID = 'd95f63af-5032-4120-89f2-ca4c49684cbc';
const CREATOR = '8bfb18b6-3c2e-4579-b4a9-06409d7e84c4';
const DRY = process.argv.includes('--dry');

async function cancelIds(ids) {
  if (!ids.length) return;
  if (DRY) { console.log('  [dry] cancelaria', ids.length, 'ids:', ids.map((x) => x.slice(0, 8)).join(',')); return; }
  for (const id of ids) await supabase.from('tasks').update({ status: 'cancelled' }).eq('id', id);
  console.log('  cancelados', ids.length);
}
async function cancelTree(motherId) {
  const { data: kids } = await supabase.from('tasks').select('id').eq('parent_task_id', motherId);
  await cancelIds([motherId, ...(kids || []).map((k) => k.id)]);
}

(async () => {
  // (1) Conciliação de Cartões
  console.log('== (1) Conciliação de Cartões ==');
  await cancelTree('82ea87e7-73c7-4694-8b7e-c83d4cdde482'); // template + 6 filhas junho
  await cancelTree('e1eea34d-15a7-4d78-9dfd-be23da1a31eb'); // instância julho + 6 filhas
  if (!DRY) {
    const conc = await createTaskGroup({ supabase, groupId: GID, createdBy: CREATOR,
      input: { title: 'Conciliação de Cartões', recurrence: 'monthly', groupDay: 1, subtasks: [
        { title: 'Cartão 8516 (Barra)', day: 12 }, { title: 'Cartão 2270 (EMLA)', day: 12 },
        { title: 'Cartão 8641 (Recreio)', day: 17 }, { title: 'Cartão 8434 (Kids CG)', day: 25 },
        { title: 'Cartão 1074 (Kids CG)', day: 25 }, { title: 'Cartão Mercado Pago (Barra)', day: 27 },
      ] } });
    for (const t of ['Cartão 8516 (Barra)', 'Cartão 2270 (EMLA)']) {
      await supabase.from('tasks').update({ status: 'done', completed_at: new Date().toISOString() })
        .eq('parent_task_id', conc.groupId).ilike('title', t);
    }
    console.log('  recriado (instância junho):', conc.groupId, '— 2 cartões reaplicados como done');
  }

  // (2) Planilha do financeiro do mês finalizada (Relatório)
  console.log('== (2) Planilha do financeiro ==');
  await cancelIds(['d5ec6498-73e9-4edf-a848-1bf99fd4a34a', '939da81a-5ab4-4fcd-8d02-eec69fb9ace8', 'f07efbd5-d9e9-4239-90eb-d07abe6bd88a', '27243673-6499-4291-b784-d6835159dfe9']);
  if (!DRY) {
    const r2 = await createTaskGroup({ supabase, groupId: GID, createdBy: CREATOR,
      input: { title: 'Planilha do financeiro do mês finalizada (Relatório)', recurrence: 'monthly', groupDay: 5, subtasks: [
        { title: 'Recreio', day: 5 }, { title: 'Barra', day: 5 }, { title: 'CG', day: 5 },
      ] } });
    console.log('  recriado:', r2.groupId);
  }

  // (3) Aplicar cashbacks do mês anterior
  console.log('== (3) Aplicar cashbacks ==');
  await cancelIds(['42f791be-5a6a-4b5a-aa27-23b54daf81ba', '1d5c357c-40b8-4e08-99b9-ac6aab4f8a84', '55414e45-1c69-4224-be0a-154f3c6d591e']);
  if (!DRY) {
    const r3 = await createTaskGroup({ supabase, groupId: GID, createdBy: CREATOR,
      input: { title: 'Aplicar cashbacks do mês anterior', recurrence: 'monthly', groupDay: 4, weekendAdjust: 'previous_friday', subtasks: [
        { title: 'Recreio', day: 4 }, { title: 'Barra', day: 4 }, { title: 'CG', day: 4 },
      ] } });
    console.log('  recriado:', r3.groupId);
  }
  console.log('DONE', DRY ? '(dry)' : '');
})().catch((e) => { console.error('ERRO:', e.message); process.exit(1); });
