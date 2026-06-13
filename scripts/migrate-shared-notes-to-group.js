// VPS: node --env-file=.env scripts/migrate-shared-notes-to-group.js [--dry]
// Migra a(s) nota(s) que o TOM marcou como "do grupo" (hack shared_with) no Financeiro
// pra group_notes. Idempotente (pula se já existe título igual no grupo). Não deleta:
// arquiva a nota pessoal original (archived=true).
const path = require('path');
process.chdir(path.join(__dirname, '..'));
const supabase = require('../src/supabase/client');
const { createGroupNote } = require('../src/services/group-notes');

const GID = 'd95f63af-5032-4120-89f2-ca4c49684cbc';
const DRY = process.argv.includes('--dry');
// Títulos a migrar (notas pessoais compartilhadas que são, na prática, do grupo):
const TITLES = ['Contas a Pagar 15/06/2026'];

(async () => {
  for (const title of TITLES) {
    const { data: notes } = await supabase.from('notes')
      .select('id, title, body, collaborator_id, shared_with, archived')
      .ilike('title', title).limit(1);
    const n = (notes || [])[0];
    if (!n) { console.log('skip (não achei):', title); continue; }
    const { data: exists } = await supabase.from('group_notes').select('id').eq('group_id', GID).ilike('title', title).limit(1);
    if (exists && exists.length) { console.log('skip (já migrada):', title); continue; }
    if (DRY) { console.log('[dry] migraria:', title, '→ categoria Contas'); continue; }
    await createGroupNote({ supabase, groupId: GID, createdBy: n.collaborator_id, note: { title: n.title, category: 'Contas', tags: [], body: n.body || '' } });
    await supabase.from('notes').update({ archived: true }).eq('id', n.id);
    console.log('migrada + arquivada:', title);
  }
  console.log('DONE', DRY ? '(dry)' : '');
})().catch((e) => { console.error('ERRO:', e.message); process.exit(1); });
