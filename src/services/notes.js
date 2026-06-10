// src/services/notes.js — CRUD de anotações (caderninho do usuário).
// supabase SEMPRE injetado (local _remote pode não ter supabase/client — lição
// project_local_vps_desync). collaborator_id vem do REMETENTE no engine, nunca do
// marker. Spec: docs/superpowers/specs/2026-06-10-anotacoes-design.md
'use strict';

const norm = (s) => String(s || '')
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().trim();

// Nomes → ids contra collaborators (padrão do comunicados): exato (preferred_name,
// full_name ou primeiro nome) vence; senão prefixo; ambíguo/ausente → unresolved.
async function resolveShareNames(supabase, names) {
  const { data } = await supabase.from('collaborators')
    .select('id, full_name, preferred_name, is_active').eq('is_active', true);
  const roster = data || [];
  const ids = [];
  const unresolved = [];
  for (const raw of names || []) {
    const q = norm(raw);
    if (!q) continue;
    const exact = roster.filter((c) => norm(c.preferred_name) === q
      || norm(c.full_name) === q
      || norm(c.full_name).split(' ')[0] === q);
    const pool = exact.length ? exact : roster.filter((c) =>
      norm(c.full_name).startsWith(q) || norm(c.preferred_name || '').startsWith(q));
    if (pool.length === 1) ids.push(pool[0].id);
    else unresolved.push(raw);
  }
  return { ids: [...new Set(ids)], unresolved };
}

async function createNote(supabase, collaboratorId, { title, body, source = 'tom', sharedWith = [] }) {
  const { data, error } = await supabase.from('notes')
    .insert({ collaborator_id: collaboratorId, title, body, source, shared_with: sharedWith })
    .select('id, title').single();
  if (error) return { ok: false, error: error.message };
  return { ok: true, note: data };
}

// ref: 'latest' | prefixo de id (8 chars). uuid não aceita LIKE via PostgREST —
// busca as recentes e filtra em JS (lição cravada do projeto).
async function findNoteRef(supabase, collaboratorId, ref) {
  const base = () => supabase.from('notes')
    .select('id, title, body, shared_with')
    .eq('collaborator_id', collaboratorId).eq('archived', false)
    .order('updated_at', { ascending: false });
  if (ref && ref !== 'latest') {
    const { data } = await base().limit(25);
    return (data || []).find((n) => String(n.id).startsWith(ref)) || null;
  }
  const { data } = await base().limit(1);
  return (data || [])[0] || null;
}

async function appendToNote(supabase, collaboratorId, ref, body) {
  const note = await findNoteRef(supabase, collaboratorId, ref);
  if (!note) return { ok: false, error: 'note_not_found' };
  const { error } = await supabase.from('notes')
    .update({ body: note.body + '\n' + body, updated_at: new Date().toISOString() })
    .eq('id', note.id);
  return error ? { ok: false, error: error.message } : { ok: true, note };
}

async function shareNote(supabase, collaboratorId, ref, addIds) {
  const note = await findNoteRef(supabase, collaboratorId, ref);
  if (!note) return { ok: false, error: 'note_not_found' };
  const merged = [...new Set([...(note.shared_with || []), ...addIds])]
    .filter((id) => id !== collaboratorId); // nunca-self
  const { error } = await supabase.from('notes')
    .update({ shared_with: merged, updated_at: new Date().toISOString() })
    .eq('id', note.id);
  return error ? { ok: false, error: error.message } : { ok: true, note, count: merged.length };
}

async function listRecentNotes(supabase, collaboratorId, n = 5) {
  const { data } = await supabase.from('notes')
    .select('id, title, body, updated_at, shared_with')
    .eq('collaborator_id', collaboratorId).eq('archived', false)
    .order('updated_at', { ascending: false }).limit(n);
  return data || [];
}

module.exports = { resolveShareNames, createNote, appendToNote, shareNote, listRecentNotes, findNoteRef };
