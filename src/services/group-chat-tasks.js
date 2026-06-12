// src/services/group-chat-tasks.js
// Chat de grupo Fase 2 — applier mínimo de tarefas do POOL do grupo.
// NÃO usa o applyTaskActions do WhatsApp (evita lembretes/cascata no zap).

async function applyGroupChatTaskActions({ supabase, groupId, senderCollabId, actions }) {
  const created = [];
  const completed = [];
  const failed = [];

  for (const a of actions || []) {
    try {
      if (a.action === 'create') {
        const title = (a.title || '').trim();
        if (!title) { failed.push({ action: a, why: 'title_missing' }); continue; }
        const row = {
          title,
          assigned_group_id: groupId,
          created_by: senderCollabId,
          status: 'pending',
        };
        if (typeof a.due_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(a.due_date)) {
          row.due_date = a.due_date;
        }
        const { data, error } = await supabase.from('tasks').insert(row).select('id, title').single();
        if (error) { failed.push({ action: a, why: error.message }); continue; }
        created.push(data);
      } else if (a.action === 'complete') {
        const title = (a.title || '').trim();
        if (!title) { failed.push({ action: a, why: 'title_missing' }); continue; }
        // Resolve por título dentro do pool do grupo, ainda não concluída.
        const { data: found } = await supabase
          .from('tasks')
          .select('id, title')
          .eq('assigned_group_id', groupId)
          .neq('status', 'done')
          .ilike('title', title)
          .limit(1);
        const target = (found || [])[0];
        if (!target) { failed.push({ action: a, why: 'not_found_in_pool' }); continue; }
        // Anti-corrida: só marca se ainda não estava done.
        const patch = { status: 'done', completed_at: new Date().toISOString(), completed_by: senderCollabId };
        const { data: upd } = await supabase
          .from('tasks')
          .update(patch)
          .eq('id', target.id)
          .neq('status', 'done')
          .select('id, title');
        if (!upd || !upd.length) { failed.push({ action: a, why: 'race_lost' }); continue; }
        completed.push(target);
      } else {
        failed.push({ action: a, why: 'unsupported_action' });
      }
    } catch (err) {
      failed.push({ action: a, why: err.message });
    }
  }

  return { created, completed, failed };
}

module.exports = { applyGroupChatTaskActions };
