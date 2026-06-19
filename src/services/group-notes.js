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
    .select('id, body').eq('group_id', groupId).ilike('title', String(title || '').trim()).is('deleted_at', null).limit(1).maybeSingle();
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
    supabase.from('group_notes').select('title, type, category, tags, fields, body, pinned').eq('group_id', groupId).is('deleted_at', null).order('pinned', { ascending: false }),
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
  const { data } = await supabase.from('group_notes').select('id, title, type, tags, fields').eq('group_id', groupId).is('deleted_at', null);
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

// ── Parte 1 (Grupo-CRUD): leitura sob demanda + edit + delete/restore + confirmação ──

// Máscara de secret pra LEITURA geral (diferente do credentialLookup, que revela sob pedido): senha vira ••••.
function maskSecretFields(n) {
  const fields = (n.fields || []).map((f) => ({
    label: f.label,
    value: f.secret ? '••••' : f.value,
    secret: !!f.secret,
  }));
  return { ...n, fields };
}

// Decisão determinística da confirmação de ação destrutiva (não confia no LLM pra threading "sim/não").
const AFFIRM_RE = /\b(sim|confirmo|confirma|pode|isso|apaga|apagar|exclui|excluir|manda ver|ok|isso a[ií])\b/i;
const NEGATE_RE = /\b(n[aã]o|cancela|deixa|esquece|para|pera|espera)\b/i;
function decideConfirm(pending, text) {
  if (!pending) return 'ignore';
  const t = String(text || '').trim();
  if (NEGATE_RE.test(t)) return 'cancel';
  if (AFFIRM_RE.test(t) && t.length <= 40) return 'execute';
  return 'ignore';
}

// Resolve uma ficha do grupo por título (ilike). Por padrão só as ATIVAS; includeDeleted p/ restore.
async function resolveNoteByTitle({ supabase, groupId, title, includeDeleted = false }) {
  const { data } = await supabase.from('group_notes')
    .select('id, title, type, tags, fields, body, pinned, deleted_at, updated_by, updated_at')
    .eq('group_id', groupId).ilike('title', String(title || '').trim()).limit(5);
  const rows = (data || []).filter((r) => (includeDeleted ? r.deleted_at : !r.deleted_at));
  return rows[0] || null;
}

// Edita uma ficha existente. patch: { new_title, type, tags, body, set_fields, upsert_field, remove_field }.
// NUNCA reescreve um secret cifrado (enc:v1:) sem novo valor real (preserva o cifrado).
async function updateGroupNote({ supabase, groupId, updatedBy, title, patch = {} }) {
  const hit = await resolveNoteByTitle({ supabase, groupId, title });
  if (!hit) return { updated: false, reason: 'not_found' };
  const upd = { updated_by: updatedBy, updated_at: new Date().toISOString() };
  if (patch.new_title) upd.title = String(patch.new_title).trim().slice(0, 200);
  if (patch.type) upd.type = patch.type;
  if (Array.isArray(patch.tags)) upd.tags = patch.tags.map((t) => String(t).trim()).filter(Boolean);
  if (typeof patch.body === 'string') upd.body = patch.body;
  let fields = Array.isArray(hit.fields) ? hit.fields.map((f) => ({ ...f })) : [];
  const blankVal = (v) => v == null || v === '' || /^[•*]+$/.test(String(v));
  const keepCipher = (oldF, newF) => ((oldF && oldF.secret && blankVal(newF.value))
    ? { ...newF, value: oldF.value, secret: true } : newF);
  let touchedFields = false;
  if (Array.isArray(patch.set_fields)) {
    fields = sanitizeFields(patch.set_fields).map((nf) => keepCipher(fields.find((f) => f.label === nf.label), nf));
    touchedFields = true;
  }
  if (patch.upsert_field && patch.upsert_field.label) {
    const nf = sanitizeFields([patch.upsert_field])[0];
    const i = fields.findIndex((f) => f.label === nf.label);
    const merged = keepCipher(i >= 0 ? fields[i] : null, nf);
    if (i >= 0) fields[i] = merged; else fields.push(merged);
    touchedFields = true;
  }
  if (patch.remove_field) { fields = fields.filter((f) => f.label !== patch.remove_field); touchedFields = true; }
  if (touchedFields) upd.fields = fields;
  await supabase.from('group_notes').update(upd).eq('id', hit.id);
  return { updated: true, id: hit.id, title: upd.title || hit.title };
}

// Soft-delete (lixeira reversível) — por título e por id (o por-id é usado pelo gate de confirmação).
async function softDeleteGroupNote({ supabase, groupId, title }) {
  const hit = await resolveNoteByTitle({ supabase, groupId, title });
  if (!hit) return { deleted: false, reason: 'not_found' };
  await supabase.from('group_notes').update({ deleted_at: new Date().toISOString() }).eq('id', hit.id);
  return { deleted: true, id: hit.id, title: hit.title };
}
async function softDeleteGroupNoteById({ supabase, noteId }) {
  await supabase.from('group_notes').update({ deleted_at: new Date().toISOString() }).eq('id', noteId);
  return { deleted: true, id: noteId };
}
async function restoreGroupNote({ supabase, groupId, title }) {
  const hit = await resolveNoteByTitle({ supabase, groupId, title, includeDeleted: true });
  if (!hit) return { restored: false, reason: 'not_found' };
  await supabase.from('group_notes').update({ deleted_at: null }).eq('id', hit.id);
  return { restored: true, id: hit.id, title: hit.title };
}

// Leitura sob demanda: quando a mensagem cita uma ficha, injeta o conteúdo dela no contexto
// (secret MASCARADO — diferente do credentialLookup, que revela sob pedido explícito de senha).
const NOTE_REQUEST_RE = /\b(manda|mandar|mostra|mostrar|envia|enviar|passa|passar|qual|cad[êe]|abre|abrir|ver|me d[áa]|consulta|busca)\b/i;
const NOTE_NOUN_RE = /\b(ficha|anota[çc][aã]o|nota|passo a passo|procedimento|guia|tutorial)\b/i;
async function noteFetchContext({ supabase, groupId, text }) {
  const looksRequest = NOTE_REQUEST_RE.test(text || '') || NOTE_NOUN_RE.test(text || '');
  const tokens = credTokenize(text);
  if (!tokens.length) return '';
  const { data } = await supabase.from('group_notes')
    .select('title, type, tags, fields, body, deleted_at, updated_by, updated_at')
    .eq('group_id', groupId);
  const active = (data || []).filter((n) => !n.deleted_at);
  const scored = active.map((n) => ({ n, score: scoreNoteMatch(n, tokens) }))
    .filter((x) => x.score >= (looksRequest ? 1 : 2))
    .sort((a, b) => b.score - a.score).slice(0, 2);
  if (!scored.length) return '';
  const blocks = scored.map(({ n }) => `### ${n.title} (${n.type || 'livre'})\n${renderNoteContent(maskSecretFields(n))}`).join('\n\n');
  return `## Ficha(s) do grupo que casam com o pedido\n(senha vem mascarada — pra revelar, a pessoa pede "a senha de X")\n${blocks}`;
}

module.exports = { createGroupNote, appendGroupNote, groupNotesContext, NOTE_TYPES, sanitizeFields, htmlToPlain, renderNoteContent, pickType, renderTypesBlock, allowedTypeSet, looksLikeCredentialRequest, scoreNoteMatch, buildCredentialBlock, credentialLookupContext, maskSecretFields, decideConfirm, resolveNoteByTitle, updateGroupNote, softDeleteGroupNote, softDeleteGroupNoteById, restoreGroupNote, noteFetchContext };
