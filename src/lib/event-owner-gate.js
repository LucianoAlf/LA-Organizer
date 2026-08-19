'use strict';
// src/lib/event-owner-gate.js
// EVENT-PARTICIPANT-GATE-MUDO (Alf 19/08 12:14 BRT) — a mensagem do gate "participante não
// remarca evento dos outros". A POLÍTICA (só o dono mexe; convidado só completa) fica no
// engine; aqui é só a fala honesta que faltava: o gate rejeitava com `failCount++` seco e o
// usuário recebia o fallback "_não consegui atualizar o compromisso_" — que soa como defeito
// técnico ("não consegui") quando a verdade é permissão ("não posso: é do Yuri").
//
// A mensagem faz as três coisas que a recusa muda não fazia:
//   1. diz a VERDADE (é regra, não erro);
//   2. nomeia QUEM pode (o dono, pra pessoa saber a quem recorrer);
//   3. OFERECE o caminho que existe (recado ao dono — a coordenação já é capacidade do TOM;
//      o "sim" do usuário segue o fluxo normal de COORDINATION_REQUEST com confirmação).
// PURA: recebe ação, título e nome do dono já resolvidos. Sem I/O.

const VERBO = { reschedule: 'remarcar', cancel: 'cancelar' };

function buildOwnerGateMessage(action, title, ownerName) {
  const verbo = VERBO[action] || 'alterar';
  const dono = ownerName ? `*${ownerName}*` : 'quem criou o compromisso';
  return `Sobre *${title}*: quem pode ${verbo} é o dono do compromisso, ${dono} — convidado não altera a agenda dos outros. Quer que eu mande um recado propondo a mudança?`;
}

module.exports = { buildOwnerGateMessage };
