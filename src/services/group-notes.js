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

// Tipo é válido se for base OU existir em group_note_types do grupo; senão 'livre'.
function pickType(type, allowedSet) {
  return allowedSet && allowedSet.has(type) ? type : 'livre';
}
// Bloco do prompt: lista os tipos do grupo (base + custom) pro TOM escolher (sem inventar).
function renderTypesBlock(types) {
  const base = [['acesso', 'Acesso'], ['cnpj', 'CNPJ'], ['conta', 'Conta'], ['reuniao', 'Reunião'], ['livre', 'Livre']];
  const all = [...base, ...((types || []).map((t) => [t.key, t.label]))];
  const lines = all.map(([k, l]) => `- ${k} — ${l}`).join('\n');
  return `Tipos de ficha disponíveis (use o mais adequado; NÃO invente tipo novo):\n${lines}`;
}
async function allowedTypeSet(supabase, groupId) {
  let custom = [];
  try {
    const { data } = await supabase.from('group_note_types').select('key').eq('group_id', groupId);
    custom = (data || []).map((r) => r.key).filter(Boolean);
  } catch (_) { /* sem tipos custom */ }
  return new Set([...NOTE_TYPES, ...custom]);
}

async function createGroupNote({ supabase, groupId, createdBy, note }) {
  const allowed = await allowedTypeSet(supabase, groupId);
  const row = {
    group_id: groupId, created_by: createdBy, updated_by: createdBy,
    title: String(note.title || '').trim().slice(0, 200),
    type: pickType(note.type, allowed),
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

// Converte HTML em texto plano pro prompt (body agora pode ser HTML do editor TipTap).
function htmlToPlain(s) {
  return String(s || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}

// Renderiza o conteúdo de uma ficha pro prompt: campos (label: value) + observações livres.
// Sem mascarar secret — é o prompt server-side; é justamente onde o TOM lê a senha pra responder.
function renderNoteContent(n) {
  const lines = [];
  for (const f of n.fields || []) {
    if (f && (f.label || f.value)) lines.push(`${f.label || '—'}: ${f.value || ''}`.trim());
  }
  if (n.body) lines.push(htmlToPlain(n.body));
  return lines.join('\n');
}

// Bloco pro prompt do grupo: índice (título · tipo · tags) de TODAS + conteúdo das fixadas.
async function groupNotesContext({ supabase, groupId }) {
  const [notesRes, typesRes] = await Promise.all([
    supabase.from('group_notes').select('title, type, category, tags, fields, body, pinned').eq('group_id', groupId).order('pinned', { ascending: false }),
    supabase.from('group_note_types').select('key, label').eq('group_id', groupId),
  ]);
  const notes = notesRes.data || [];
  const typesBlock = renderTypesBlock(typesRes.data || []);
  if (!notes.length) return typesBlock;
  const idx = notes.map((n) => `- ${n.title} (${n.type || 'livre'})${(n.tags || []).length ? ' · ' + n.tags.map((t) => '#' + t).join(' ') : ''}`).join('\n');
  const pinned = notes.filter((n) => n.pinned).map((n) => `### ${n.title}\n${renderNoteContent(n)}`).join('\n\n');
  let out = `## Anotações do grupo (base de conhecimento)\n${idx}`;
  if (pinned) out += `\n\n### Fixadas (conteúdo):\n${pinned}`;
  return `${typesBlock}\n\n${out}`;
}

// ── Recuperação de credencial sob demanda (senhas) ──
function stripAccent(s) { return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase(); }
function looksLikeCredentialRequest(text) { return /\b(senha|login|usu[áa]rio|usuario|acesso|credencial|c[óo]digo|pin)\b/i.test(String(text || '')); }
function credTokenize(text) { return [...new Set(stripAccent(text).split(/[^a-z0-9]+/).filter((t) => t.length >= 3))]; }
function scoreNoteMatch(note, tokens) {
  const parts = [note.title, ...((note.tags) || []), ...((note.fields) || []).flatMap((f) => [f.label, f.secret ? '' : f.value])];
  const hay = stripAccent(parts.join(' '));
  return tokens.reduce((s, t) => s + (hay.includes(t) ? 1 : 0), 0);
}
function buildCredentialBlock(matches) {
  if (!matches || !matches.length) return '';
  const blocks = matches.map((m) => `### ${m.title} (${m.type || 'livre'})\n` +
    (m.fields || []).filter((f) => f.label || f.value).map((f) => `${f.label || '—'}: ${f.value || ''}`).join('\n')).join('\n\n');
  return `## Credencial(is) que casam com o pedido\n(responda só o que foi perguntado; NÃO despeje outras senhas)\n${blocks}`;
}
// Busca fichas do grupo que casam com o pedido, decifra os secrets (service_role) e devolve o bloco.
async function credentialLookupContext({ supabase, groupId, text }) {
  if (!looksLikeCredentialRequest(text)) return '';
  const tokens = credTokenize(text);
  if (!tokens.length) return '';
  const { data } = await supabase.from('group_notes').select('id, title, type, tags, fields').eq('group_id', groupId);
  const scored = (data || []).map((n) => ({ n, score: scoreNoteMatch(n, tokens) }))
    .filter((x) => x.score >= 1).sort((a, b) => b.score - a.score).slice(0, 2);
  if (!scored.length) return '';
  const matches = [];
  for (const { n } of scored) {
    const fields = [];
    for (const f of (n.fields || [])) {
      if (!f.label && !f.value) continue;
      let value = f.value;
      if (f.secret && typeof value === 'string' && value.startsWith('enc:v1:')) {
        try { const { data: dec } = await supabase.rpc('gn_decrypt', { ciphertext: value }); if (dec != null) value = dec; } catch (_) {}
      }
      fields.push({ label: f.label, value });
    }
    matches.push({ title: n.title, type: n.type, fields });
  }
  return buildCredentialBlock(matches);
}

module.exports = { createGroupNote, appendGroupNote, groupNotesContext, NOTE_TYPES, sanitizeFields, htmlToPlain, renderNoteContent, pickType, renderTypesBlock, allowedTypeSet, looksLikeCredentialRequest, scoreNoteMatch, buildCredentialBlock, credentialLookupContext };
