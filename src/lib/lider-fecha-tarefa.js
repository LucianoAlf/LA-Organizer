'use strict';
// lider-fecha-tarefa.js — LIDER-FECHA-TAREFA-DE-OUTRO (decisão do Alf, 11/09/2026 — 60fbb2e3).
//
// 22/07 o Alf pediu "fecha as tarefas do Yuri": o parse da pergunta estava certo, mas todos os
// caminhos de conclusão só achavam tarefa com assigned_to = quem falou — o pedido era
// inalcançável por desenho. Decisão: coordenação e direção podem pedir pro TOM fechar tarefa de
// outra pessoa. PURO — quem busca e grava é o engine. Regra:
//   • direção (role director) e CEO → qualquer tarefa aberta de outra pessoa;
//   • gerência, coordenação e quem tem has_coord_permissions → só as que DELEGOU (created_by)
//     ou que COBRA (governance_owner_id);
//   • nunca o molde de uma série, nunca tarefa já fechada; tarefa própria segue o caminho normal.
function alcanceDoLider(c) {
  if (!c || typeof c !== 'object') return null;
  if (c.is_ceo === true || c.role === 'director') return 'total';
  if (c.role === 'manager' || c.role === 'coordinator' || c.has_coord_permissions === true) return 'delegadas';
  return null;
}

function podeFecharComoLider(c, t) {
  const alcance = alcanceDoLider(c);
  if (!alcance || !t || typeof t !== 'object') return false;
  if (!t.assigned_to && !t.assigned_group_id) return false;
  if (t.assigned_to && t.assigned_to === c.id) return false;
  if (['done', 'cancelled'].includes(t.status)) return false;
  if (t.recurrence_rule != null && t.recurrence_parent_id == null) return false; // molde
  if (alcance === 'total') return true;
  return t.created_by === c.id || t.governance_owner_id === c.id;
}

// Filtro PostgREST (.or) do alcance. `incluiProprias` junta as tarefas do próprio líder (a
// pergunta de fechamento pode misturar as dele com as do time). Direção não filtra por dono.
function filtroOrDoLider(c, { incluiProprias = false } = {}) {
  const alcance = alcanceDoLider(c);
  if (!alcance || alcance === 'total') return null;
  const partes = [`created_by.eq.${c.id}`, `governance_owner_id.eq.${c.id}`];
  if (incluiProprias) partes.push(`assigned_to.eq.${c.id}`);
  return partes.join(',');
}

module.exports = { alcanceDoLider, podeFecharComoLider, filtroOrDoLider };
