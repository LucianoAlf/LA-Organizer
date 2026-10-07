'use strict';
// src/lib/tarefa-que-e-evento.js — TASK-UPDATE-EM-ID-DE-EVENTO (Alf 07/10 19:39). PURO.
//
// Fechamento: "1. Mentoria Levi — rolou? 2. Reunião semana… 3. Reunião Comercial…" → "Rolou tudo,
// Tom!". O modelo emitiu EVENT_UPDATE complete dos 3 (executado, ok=3) E, no mesmo turno, um
// TASK_UPDATE complete com o id da Mentoria Levi — que é COMPROMISSO, não tarefa. O lote de tarefa
// falhou (0 ok, 1 fail), caiu no ramo "nada gravou" e a resposta virou "não consegui registrar
// agora. Me passa de novo?" — com os 3 compromissos já marcados como feitos.
// Ação de tarefa cujo alvo é um compromisso que o MESMO turno já está tratando pelo EVENT_UPDATE é
// duplicata do modelo, não pedido: sai do lote de tarefa antes de executar. Alvo de compromisso
// que o turno NÃO trata segue pro lote (e a falha honesta continua valendo — ninguém esconde erro).
const _curto = (id) => String(id || '').trim().toLowerCase().slice(0, 8);

function separarTarefaQueEEvento(acoesTarefa, acoesEvento) {
  const ids = new Set((Array.isArray(acoesEvento) ? acoesEvento : []).map((a) => _curto(a && a.id)).filter(Boolean));
  const ficam = [];
  const duplicadas = [];
  for (const a of Array.isArray(acoesTarefa) ? acoesTarefa : []) {
    const id = _curto(a && a.id);
    if (id && ids.has(id)) duplicadas.push(a); else ficam.push(a);
  }
  return { ficam, duplicadas };
}

module.exports = { separarTarefaQueEEvento };
