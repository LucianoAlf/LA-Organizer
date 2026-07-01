'use strict';
// Reunião de grupo (F1) — resolve nomes de convidados → colaboradores, deduplicando por id.
// Puro: o resolvedor é injetado (no engine é resolveCollaboratorByName). Nome sem match NÃO
// aborta — vai pra `unresolved` pro engine reportar honesto. Ver
// docs/superpowers/specs/2026-07-01-reuniao-grupo-design.md
async function resolveAttendees(names, resolveOne) {
  const resolved = [];
  const unresolved = [];
  const seen = new Set();
  for (const raw of Array.isArray(names) ? names : []) {
    const name = String(raw || '').trim();
    if (!name) continue;
    const r = await resolveOne(name);
    if (r && r.status === 'resolved' && r.collaborator && r.collaborator.id) {
      if (seen.has(r.collaborator.id)) continue;
      seen.add(r.collaborator.id);
      resolved.push({ name, collaborator: r.collaborator });
    } else {
      unresolved.push(name);
    }
  }
  return { resolved, unresolved };
}

module.exports = { resolveAttendees };
