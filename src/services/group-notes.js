// src/services/group-notes.js
// Base de conhecimento do grupo (group_notes). createGroupNote/appendGroupNote usados
// pelo TOM (chat de grupo) via service_role; groupNotesContext monta o bloco que vai no
// prompt (índice de todas + body das fixadas). supabase injetado (testável sem DB).
'use strict';

async function createGroupNote({ supabase, groupId, createdBy, note }) {
  const row = {
    group_id: groupId, created_by: createdBy, updated_by: createdBy,
    title: String(note.title || '').trim().slice(0, 200),
    category: (note.category && String(note.category).trim()) || 'Geral',
    tags: Array.isArray(note.tags) ? note.tags.map((t) => String(t).trim()).filter(Boolean) : [],
    body: String(note.body || ''),
  };
  const { data, error } = await supabase.from('group_notes').insert(row).select('id').single();
  if (error) throw new Error('insert group_note: ' + error.message);
  return { id: data.id };
}

async function appendGroupNote({ supabase, groupId, updatedBy, title, body }) {
  const { data: hit } = await supabase.from('group_notes')
    .select('id, body').eq('group_id', groupId).ilike('title', String(title || '').trim()).limit(1).maybeSingle();
  if (!hit) return { appended: false, reason: 'not_found' };
  const newBody = `${hit.body || ''}\n\n${String(body || '')}`.trim();
  await supabase.from('group_notes').update({ body: newBody, updated_by: updatedBy, updated_at: new Date().toISOString() }).eq('id', hit.id);
  return { appended: true, id: hit.id };
}

// Bloco pro prompt do grupo: índice (título · categoria · tags) de TODAS + body das fixadas.
async function groupNotesContext({ supabase, groupId }) {
  const { data } = await supabase.from('group_notes')
    .select('title, category, tags, body, pinned').eq('group_id', groupId).order('pinned', { ascending: false });
  const notes = data || [];
  if (!notes.length) return '';
  const idx = notes.map((n) => `- ${n.title} (${n.category})${(n.tags || []).length ? ' · ' + n.tags.map((t) => '#' + t).join(' ') : ''}`).join('\n');
  const pinned = notes.filter((n) => n.pinned).map((n) => `### ${n.title}\n${n.body}`).join('\n\n');
  let out = `## Anotações do grupo (base de conhecimento)\n${idx}`;
  if (pinned) out += `\n\n### Fixadas (conteúdo):\n${pinned}`;
  return out;
}

module.exports = { createGroupNote, appendGroupNote, groupNotesContext };
