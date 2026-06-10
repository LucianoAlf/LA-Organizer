// src/services/task-groups.js
// Cascata de conclusão de grupos no caminho do WhatsApp (paridade com o PWA).
// Chamado APÓS um complete bem-sucedido de task. Best-effort: nunca lança.
const supabase = require('../supabase/client');

/**
 * Se a task concluída é FILHA de grupo e era a última aberta, conclui a mãe.
 * @returns {Promise<{groupCompleted: boolean, groupTitle: string|null}>}
 */
async function maybeCompleteParentGroup(taskId) {
  try {
    const { data: t } = await supabase
      .from('tasks').select('id, parent_task_id').eq('id', taskId).maybeSingle();
    if (!t || !t.parent_task_id) return { groupCompleted: false, groupTitle: null };

    // Premissa: grupo é single-owner (mãe e filhas do mesmo assigned_to, por construção
    // do createGroup). Service_role bypassa RLS — se grupos cruzarem donos um dia,
    // adicionar guard de assigned_to aqui.
    const { data: siblings } = await supabase
      .from('tasks').select('id, status')
      .eq('parent_task_id', t.parent_task_id).neq('status', 'cancelled');
    const open = (siblings || []).filter((s) => s.status !== 'done').length;
    if (open > 0) return { groupCompleted: false, groupTitle: null };

    const { data: mother } = await supabase
      .from('tasks')
      .update({ status: 'done', completed_at: new Date().toISOString() })
      .eq('id', t.parent_task_id).neq('status', 'done')
      .select('id, title').maybeSingle();
    if (mother) {
      console.log(`[TaskGroups] grupo auto-concluído: ${mother.title} (${String(mother.id).slice(0, 8)})`);
      return { groupCompleted: true, groupTitle: mother.title };
    }
    return { groupCompleted: false, groupTitle: null };
  } catch (e) {
    console.error('[TaskGroups] maybeCompleteParentGroup err:', e.message);
    return { groupCompleted: false, groupTitle: null };
  }
}

module.exports = { maybeCompleteParentGroup };
