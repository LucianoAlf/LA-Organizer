// src/services/note-marker.js — parser puro do <<NOTE_ACTION>> (espelha o padrão
// parseChecklistActionMarker do engine). Validação de schema aqui; persistência em
// notes.js. share_with carrega NOMES (o engine resolve nomes→ids contra o banco —
// JAMAIS uuid vindo do LLM sem validação). Spec: docs/superpowers/specs/2026-06-10-anotacoes-design.md
'use strict';

const RE = /<<NOTE_ACTION>>\s*([\s\S]*?)\s*<<END>>/i;

function parseNoteActionMarker(text) {
  if (!text) return null;
  const m = text.match(RE);
  if (!m) return null;
  const cleanText = text.replace(RE, '').trim();
  let p;
  try { p = JSON.parse(m[1].trim()); } catch { return { malformed: true, cleanText }; }
  if (!p || typeof p !== 'object' || Array.isArray(p)) return { malformed: true, cleanText };
  const action = String(p.action || '');
  if (!['create', 'append', 'share'].includes(action)) return { malformed: true, cleanText };
  if (p.share_with !== undefined && (!Array.isArray(p.share_with) || !p.share_with.every((s) => typeof s === 'string'))) {
    return { malformed: true, cleanText };
  }
  if (action === 'create') {
    const body = typeof p.body === 'string' ? p.body.trim() : '';
    if (!body) return { malformed: true, cleanText };
    const title = (typeof p.title === 'string' && p.title.trim()) || body.split('\n')[0].slice(0, 120);
    return { malformed: false, cleanText, action: { action, title, body, share_with: p.share_with || [] } };
  }
  if (action === 'append') {
    if (typeof p.body !== 'string' || !p.body.trim() || !p.note) return { malformed: true, cleanText };
    return { malformed: false, cleanText, action: { action, note: String(p.note), body: p.body.trim() } };
  }
  // share
  if (!p.note || !Array.isArray(p.share_with) || p.share_with.length === 0) return { malformed: true, cleanText };
  return { malformed: false, cleanText, action: { action, note: String(p.note), share_with: p.share_with } };
}

module.exports = { parseNoteActionMarker };
