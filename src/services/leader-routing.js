// src/services/leader-routing.js
// Roteamento de LIDERANÇA — define QUAIS líderes recebem cobrança das tarefas de um
// colaborador. Função PURA (sem I/O): recebe o colaborador + a lista de todos os
// colaboradores e devolve a lista de líderes (fan-out). Extraído pra cá com teste
// porque o digest de governança antes roteava por CATEGORIA do evento
// (event_category_leaders), que era quase sempre vazia → tudo caía em "Sem líder" e
// nada chegava ao gerente da unidade. Causa-raiz GovLeader (caso Krissya 06/06).
//
// Regra definida pelo CEO (08/06, organograma):
//   • pedagógico (collaborator) → AMBOS os coordenadores pedagógicos (Juliana + Quintela);
//     os DOIS veem todos ("tudo que a Quintela vê, a Juliana vê"). SEM exclusividade.
//   • marketing  (collaborator) → managers de marketing (Yuri)
//   • lotado numa unidade (barra/campo_grande/recreio) → gerente daquela unidade
//   • supervisor_id explícito → SEMPRE incluído (override de exceção)
//   • órfão (nada resolve) ou ele-mesmo líder (manager/coordinator/director) → CEO
//   • nunca roteia pra própria pessoa; dedupe por id; só líderes ATIVOS
// Uma pessoa pode ter VÁRIOS líderes (ex.: Leo = pedagógico + Barra → Juliana+Quintela+Krissya).
//
// Funções puras → fáceis de testar e raciocinar. Rodar: node --test src/services/leader-routing.test.js

'use strict';

const UNITS = new Set(['barra', 'campo_grande', 'recreio']);
const LEADER_ROLES = new Set(['manager', 'coordinator', 'director']);

/**
 * @param {object} collab  colaborador dono da tarefa (precisa de id, role, function_role, unit, explicit_leader_ids)
 * @param {object[]} allCollabs  todos os colaboradores (pra achar os líderes)
 * @returns {object[]}  lista de líderes (objetos de allCollabs), em ordem de prioridade, deduplicada
 */
function resolveLeadersOf(collab, allCollabs) {
  if (!collab) return [];
  const list = Array.isArray(allCollabs) ? allCollabs : [];
  const byId = new Map(list.map((c) => [c.id, c]));
  const active = list.filter((c) => c && c.is_active !== false);

  const leaders = new Map(); // id -> collab (Map preserva ordem de inserção = prioridade)
  const add = (c) => {
    if (!c) return;
    if (c.id === collab.id) return;       // nunca roteia pra si mesmo
    if (c.is_active === false) return;     // só líderes ativos
    if (!leaders.has(c.id)) leaders.set(c.id, c);
  };

  const fr = collab.function_role || null;
  const unit = collab.unit || null;
  const isSelfLeader = LEADER_ROLES.has(collab.role);

  // Ordem de inserção = prioridade pro "líder principal" (1º da lista) usado no
  // agrupamento do digest do CEO. As regras por função só valem pra COLABORADOR
  // (um gerente/coordenador não vira liderado de um par).
  if (!isSelfLeader) {
    // 1) lotado numa unidade → gerente da unidade (líder "de chão" principal)
    if (UNITS.has(unit)) {
      for (const c of active) {
        if (c.role === 'manager' && c.unit === unit) add(c);
      }
    }
    // 2) pedagógico → AMBOS os coordenadores pedagógicos (Juliana + Quintela).
    // Os dois veem TODOS os pedagógicos — "tudo que a Quintela vê, a Juliana vê"
    // (um lembra o outro). SEM exclusividade (decisão CEO 08/06).
    if (fr === 'pedagogico') {
      for (const c of active) {
        if (c.role === 'coordinator' && c.function_role === 'pedagogico') add(c);
      }
    }
    // 3) marketing → managers de marketing
    if (fr === 'marketing') {
      for (const c of active) {
        if (c.role === 'manager' && c.function_role === 'marketing') add(c);
      }
    }
  }

  // 4) override manual (matriz editável, governance_edges) — soma sem dominar a ordem.
  // EXCETO quando o líder explícito é o próprio CEO: ele já recebe o digest COMPLETO,
  // então não deve poluir o fan-out por-líder. O CEO entra só pelo fallback (passo 5).
  for (const lid of (Array.isArray(collab.explicit_leader_ids) ? collab.explicit_leader_ids : [])) {
    const L = byId.get(lid);
    if (L && !L.is_ceo) add(L);
  }

  // 5) fallback: ninguém resolveu (órfão ou ele-mesmo líder) → CEO
  if (leaders.size === 0) {
    for (const c of active) {
      if (c.is_ceo) add(c);
    }
  }

  return Array.from(leaders.values());
}

/**
 * Conveniência: só os IDs dos líderes.
 */
function resolveLeaderIdsOf(collab, allCollabs) {
  return resolveLeadersOf(collab, allCollabs).map((c) => c.id);
}

module.exports = { resolveLeadersOf, resolveLeaderIdsOf, UNITS, LEADER_ROLES };
