// src/lib/reminder-refs-query.js
'use strict';
// Busca as referências de TAREFA que o TOM surfou pra essa pessoa nas últimas 24h — as linhas
// que o sendAndLink (Lote D) gravou em conversation_history com ref_type='task'. Builder puro
// pra travar o SHAPE em teste (o engine não é testável isolado). Title vem null aqui: o
// consumidor (engine) enriquece com o título/status da tarefa por id, que é onde também mora a
// checagem de idempotência do freio #4.

function buildReminderRefsQuery(supabase, collaboratorId, desdeIso) {
  return supabase
    .from('conversation_history')
    .select('ref_id, content, created_at')
    .eq('collaborator_id', collaboratorId)
    .eq('direction', 'outbound')
    .eq('ref_type', 'task')
    .gte('created_at', desdeIso)
    .order('created_at', { ascending: false })
    .limit(20);
}

function mapRefRows(rows) {
  return (Array.isArray(rows) ? rows : [])
    .filter((r) => r && r.ref_id)
    .map((r) => ({ task_id: r.ref_id, title: null, reminded_at: r.created_at }));
}

module.exports = { buildReminderRefsQuery, mapRefRows };
