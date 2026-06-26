'use strict';

// Subtarefas/checklist (2026-06-26) — helper LITE generalizado do task-groups.
// Cria filhas (sub-itens) de uma tarefa QUALQUER (pessoal/delegada/grupo) via parent_task_id,
// herdando context/assigned do pai. SEM acoplamento a assigned_group_id; SEM recorrência
// (template/materialização do grupo NÃO é acionada aqui). 1 nível só: recusa se o "pai" já é
// filho (parent.parent_task_id setado) — o CHECK tasks_no_nested_groups protege o lado do grupo,
// mas aqui o pai não é is_group, então a trava de 1-nível é nossa.

async function createSubtasks({ supabase, parentId, texts, parent, createdBy }) {
  if (!parent || parent.parent_task_id) {
    throw new Error('subtask_nested_rejected: sub-item nao pode ter sub-item (1 nivel so / nested / child-of-child)');
  }
  const list = (Array.isArray(texts) ? texts : [])
    .map((t) => String(t || '').trim())
    .filter(Boolean);
  if (!list.length) return { created: 0 };

  const rows = list.map((title, i) => ({
    title,
    parent_task_id: parentId,
    is_group: false,
    status: 'pending',
    context: parent.context || 'personal',
    assigned_to: parent.assigned_to ?? null,
    assigned_group_id: parent.assigned_group_id ?? null,
    created_by: createdBy ?? null,
    sort_position: i + 1,
    source: 'whatsapp',
  }));

  const { data, error } = await supabase.from('tasks').insert(rows).select('id');
  if (error) throw new Error('subtask_insert_failed: ' + error.message);
  return { created: (data || rows).length };
}

module.exports = { createSubtasks };
