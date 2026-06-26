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
    // NOTE-MARKER-CONTENT-BODY-ALIAS (25/06): o LLM às vezes emite "content" em vez de
    // "body" (nome super comum de corpo de nota), sobretudo em notas longas/estruturadas
    // (fechamento financeiro do Alf). Aceita os dois — provider-agnóstico, mata a classe.
    const body = (typeof p.body === 'string' ? p.body
                : typeof p.content === 'string' ? p.content : '').trim();
    if (!body) return { malformed: true, cleanText };
    const title = (typeof p.title === 'string' && p.title.trim()) || body.split('\n')[0].slice(0, 120);
    return { malformed: false, cleanText, action: { action, title, body, share_with: p.share_with || [] } };
  }
  if (action === 'append') {
    // NOTE-MARKER-CONTENT-BODY-ALIAS: mesmo alias content→body do create (mesma exposição ao drift).
    const appendBody = (typeof p.body === 'string' ? p.body
                      : typeof p.content === 'string' ? p.content : '').trim();
    if (!appendBody || !p.note) return { malformed: true, cleanText };
    return { malformed: false, cleanText, action: { action, note: String(p.note), body: appendBody } };
  }
  // share
  if (!p.note || !Array.isArray(p.share_with) || p.share_with.length === 0) return { malformed: true, cleanText };
  return { malformed: false, cleanText, action: { action, note: String(p.note), share_with: p.share_with } };
}

module.exports = { parseNoteActionMarker };
