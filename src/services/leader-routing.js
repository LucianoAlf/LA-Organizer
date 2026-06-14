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
    // 2) líderes do grupo vêm da tabela governance_leaders (group+unit), anexados no load
    // como group_leader_ids via groupLeaderIdsFor. Desacoplado do nível de acesso (uma
    // farmer pode liderar farmers da unidade dela sem ser gerente).
    for (const lid of (Array.isArray(collab.group_leader_ids) ? collab.group_leader_ids : [])) {
      const L = byId.get(lid);
      if (L) add(L);
    }
  }

  // 4) override manual (matriz editável, governance_edges) — soma sem dominar a ordem.
  // O CEO PODE ser líder explícito (opt-in do Diretor: "Ana reporta a mim e à Rose").
  // As regras AUTOMÁTICAS (1-2) nunca adicionam o CEO; o ENVIO do digest por-líder
  // também o pula (dispatcher ~L.2610/2797), pois ele já tem o report completo.
  for (const lid of (Array.isArray(collab.explicit_leader_ids) ? collab.explicit_leader_ids : [])) {
    const L = byId.get(lid);
    if (L) add(L);
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

/**
 * Líderes do grupo de um colaborador: casa o function_role (grupo) dele contra a tabela
 * governance_leaders, com unit 'all' (global) OU a unidade da pessoa (farmer por-loja). PURA.
 */
function groupLeaderIdsFor(collab, groupLeaders) {
  const fr = (collab && collab.function_role) || null;
  if (!fr) return [];
  const unit = collab.unit || null;
  return (Array.isArray(groupLeaders) ? groupLeaders : [])
    .filter((g) => g.group_key === fr && (g.unit === 'all' || g.unit === unit))
    .map((g) => g.leader_id);
}

/**
 * Quem VÊ a tarefa na governança:
 *   • DELEGADA (governance_owner_id) → SÓ o delegador (fatiamento por delegação).
 *   • SOLTA (NULL) → os LÍDERES DO DONO pela MESMA regra que roteia eventos e define
 *     o time (resolveLeaderIdsOf: unidade REAL→gerente + group_leaders + arestas + CEO).
 *
 * Antes esta função tinha lógica PRÓPRIA de "gerente da unidade" com `if (unit)` que
 * tratava o sentinel unit='all' (= sem unidade física) como unidade real → todo manager
 * unit='all' (Yuri/Rose/Ana) herdava a atrasada de QUALQUER pessoa unit='all', e o próprio
 * dono-gerente aparecia como viewer de si. Caso 14/06 (Yuri/marketing via pedagógico).
 * Unificar com resolveLeaderIdsOf mata o vazamento, o sub-escopo (faltava group_leaders)
 * e a auto-inclusão — e garante tasks×eventos×time SEMPRE coerentes (uma fonte de verdade).
 * Retorna array de collaborator ids. Vazio → caller cai no CEO.
 * @param {{governance_owner_id?: string|null, assigned_to: string}} task
 * @param {{id:string, role?:string, unit?:string|null, explicit_leader_ids?:string[], group_leader_ids?:string[]}} owner
 * @param {Array} allCollabs
 * @returns {string[]}
 */
function governanceViewerIdsOf(task, owner, allCollabs) {
  if (task && task.governance_owner_id) return [task.governance_owner_id];
  if (!owner) return [];
  return resolveLeaderIdsOf(owner, allCollabs);
}

module.exports = { resolveLeadersOf, resolveLeaderIdsOf, groupLeaderIdsFor, governanceViewerIdsOf, UNITS, LEADER_ROLES };
