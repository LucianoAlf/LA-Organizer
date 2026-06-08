// src/services/leader-routing.js
// Roteamento de LIDERANÇA — define QUAIS líderes recebem cobrança das tarefas de um
// colaborador. Função PURA (sem I/O): recebe o colaborador + a lista de todos os
// colaboradores e devolve a lista de líderes (fan-out). Extraído pra cá com teste
// porque o digest de governança antes roteava por CATEGORIA do evento
// (event_category_leaders), que era quase sempre vazia → tudo caía em "Sem líder" e
// nada chegava ao gerente da unidade. Causa-raiz GovLeader (caso Krissya 06/06).
//
// Regra definida pelo CEO (08/06, organograma):
//   • pedagógico EXCLUSIVO (supervisor já é coord. pedag.) → só ela (Dai→Juliana, Matheus→Quintela)
//   • pedagógico guarda-chuva (supervisor não-coord.) → AMBAS as coordenadoras (Juliana + Quintela)
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
 * @param {object} collab  colaborador dono da tarefa (precisa de id, role, function_role, unit, supervisor_id)
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
    // 2) pedagógico → exclusivo OU guarda-chuva.
    // Exclusividade (organograma 08/06): se o supervisor já é coordenador
    // pedagógico (Dai→Juliana, Matheus→Quintela), fica EXCLUSIVO a ele (entra
    // pelo passo 4 do supervisor). Senão (sup = CEO/gerente/nada) → guarda-chuva:
    // cai nas DUAS coordenadoras (Jordan/Peterson/Ramon/Rodrigo/Leo).
    if (fr === 'pedagogico') {
      const sup = collab.supervisor_id ? byId.get(collab.supervisor_id) : null;
      const supIsPedCoord = !!sup && sup.role === 'coordinator' && sup.function_role === 'pedagogico';
      if (!supIsPedCoord) {
        for (const c of active) {
          if (c.role === 'coordinator' && c.function_role === 'pedagogico') add(c);
        }
      }
    }
    // 3) marketing → managers de marketing
    if (fr === 'marketing') {
      for (const c of active) {
        if (c.role === 'manager' && c.function_role === 'marketing') add(c);
      }
    }
  }

  // 4) supervisor_id explícito (override/exceção) — soma sem dominar a ordem.
  // EXCETO quando o supervisor é o próprio CEO: ele já recebe o digest COMPLETO,
  // então não deve poluir o fan-out por-líder (senão todo pedagógico que reporta
  // "ao topo" duplicaria o CEO). O CEO entra só pelo fallback de órfão real (passo 5).
  if (collab.supervisor_id && byId.has(collab.supervisor_id)) {
    const sup = byId.get(collab.supervisor_id);
    if (sup && !sup.is_ceo) add(sup);
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
