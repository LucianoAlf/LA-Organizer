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
        // Lembrete agendado ("me lembra segunda…"): grava remind_at (o cron de deadlines
        // dispara o aviso quando remind_at <= now e ainda não foi enviado). Sem isso, "te
        // lembro" vira promessa vazia. Aceita ISO datetime; ignora se inválido.
        if (typeof a.remind_at === 'string' && a.remind_at.trim()) {
          const d = new Date(a.remind_at.trim());
          if (!Number.isNaN(d.getTime())) row.remind_at = d.toISOString();
        }
        // Recorrência (Sprint 4): armazena a RRULE e materializa as instâncias logo após —
        // espelha o caminho do engine (applyTaskActions). NUNCA criar várias cópias manuais.
        if (typeof a.recurrence_rule === 'string' && a.recurrence_rule.trim()) {
          row.recurrence_rule = a.recurrence_rule.trim().replace(/^RRULE:/i, '');
        }
        const { data, error } = await supabase.from('tasks').insert(row).select('id, title').single();
        if (error) { failed.push({ action: a, why: error.message }); continue; }
        if (row.recurrence_rule && data?.id) {
          try {
            const { materializeSeries } = require('./recurrence-engine');
            const { data: fullTpl } = await supabase.from('tasks').select('*').eq('id', data.id).maybeSingle();
            if (fullTpl) await materializeSeries('tasks', fullTpl);
          } catch (e) { console.warn('[GroupChat] materialize recorrência falhou:', e.message); }
        }
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
