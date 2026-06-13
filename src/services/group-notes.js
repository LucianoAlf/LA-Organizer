// src/services/group-notes.js
// Base de conhecimento do grupo (group_notes). createGroupNote/appendGroupNote usados
// pelo TOM (chat de grupo) via service_role; groupNotesContext monta o bloco que vai no
// prompt (índice de todas + body das fixadas). supabase injetado (testável sem DB).
'use strict';

const NOTE_TYPES = ['acesso', 'cnpj', 'conta', 'reuniao', 'livre'];

// Sanitiza fields: array de {label, value, kind?, secret?}; descarta linha sem label nem value.
function sanitizeFields(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((f) => ({
      label: String(f.label || '').trim(),
      value: String(f.value == null ? '' : f.value),
      kind: ['text', 'url', 'password'].includes(f.kind) ? f.kind : 'text',
      secret: f.secret === true,
    }))
    .filter((f) => f.label || f.value);
}

async function createGroupNote({ supabase, groupId, createdBy, note }) {
  const row = {
    group_id: groupId, created_by: createdBy, updated_by: createdBy,
    title: String(note.title || '').trim().slice(0, 200),
    type: NOTE_TYPES.includes(note.type) ? note.type : 'livre',
    category: (note.category && String(note.category).trim()) || 'Geral',
    tags: Array.isArray(note.tags) ? note.tags.map((t) => String(t).trim()).filter(Boolean) : [],
    fields: sanitizeFields(note.fields),
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

// Renderiza o conteúdo de uma ficha pro prompt: campos (label: value) + observações livres.
// Sem mascarar secret — é o prompt server-side; é justamente onde o TOM lê a senha pra responder.
function renderNoteContent(n) {
  const lines = [];
  for (const f of n.fields || []) {
    if (f && (f.label || f.value)) lines.push(`${f.label || '—'}: ${f.value || ''}`.trim());
  }
  if (n.body) lines.push(String(n.body).trim());
  return lines.join('\n');
}

// Bloco pro prompt do grupo: índice (título · tipo · tags) de TODAS + conteúdo das fixadas.
async function groupNotesContext({ supabase, groupId }) {
  const { data } = await supabase.from('group_notes')
    .select('title, type, category, tags, fields, body, pinned').eq('group_id', groupId).order('pinned', { ascending: false });
  const notes = data || [];
  if (!notes.length) return '';
  const idx = notes.map((n) => `- ${n.title} (${n.type || 'livre'})${(n.tags || []).length ? ' · ' + n.tags.map((t) => '#' + t).join(' ') : ''}`).join('\n');
  const pinned = notes.filter((n) => n.pinned).map((n) => `### ${n.title}\n${renderNoteContent(n)}`).join('\n\n');
  let out = `## Anotações do grupo (base de conhecimento)\n${idx}`;
  if (pinned) out += `\n\n### Fixadas (conteúdo):\n${pinned}`;
  return out;
}

module.exports = { createGroupNote, appendGroupNote, groupNotesContext, NOTE_TYPES, sanitizeFields };
