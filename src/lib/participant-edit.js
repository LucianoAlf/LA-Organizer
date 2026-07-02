'use strict';
// Plano PURO de edição de participantes de uma reunião (02/07). Idempotente:
//   - add de quem já está     = noop
//   - remove de quem não está = noop
//   - qualquer op sobre o organizador = rejeitado (ele é DONO do evento, não é event_participant;
//     não dá pra "adicionar" nem "remover" o dono da própria agenda)
// Sem I/O: o engine resolve nomes→ids e busca os participantes atuais; aqui só o diff.
function planParticipantEdit({ op, resolvedIds = [], existingIds = [], organizerId = null }) {
  const existing = new Set(existingIds);
  const toAdd = [];
  const toRemove = [];
  const noops = [];
  const rejected = [];
  const ids = [...new Set(resolvedIds)]; // dedup preservando ordem
  for (const id of ids) {
    if (id === organizerId) { rejected.push(id); continue; }
    if (op === 'add') {
      if (existing.has(id)) noops.push(id);
      else toAdd.push(id);
    } else if (op === 'remove') {
      if (existing.has(id)) toRemove.push(id);
      else noops.push(id);
    }
  }
  return { toAdd, toRemove, noops, rejected };
}

module.exports = { planParticipantEdit };
