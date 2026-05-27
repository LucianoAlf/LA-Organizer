// src/utils/roles.js — Sprint 28
// ──────────────────────────────────────────────────────────────────────
// Helpers de permissão. Centraliza a lógica "tem nível de coordinator?"
// pra que o cargo (role) continue refletindo a hierarquia organizacional
// real (organograma) enquanto a permissão operacional pode ser concedida
// individualmente via collaborators.has_coord_permissions.
//
// Filosofia: cargo ≠ permissão. Krissya continua manager (cargo),
// mas tem permissão de coordinator (operacional).
//
// NÃO usar pra: aprovação de eventos (que continua olhando role literal,
// porque aprovação é função estritamente do cargo coordinator/director).

/**
 * Retorna true se o colaborador tem nível operacional de coordinator
 * (criar tarefa pra outros, delegar, ver relatórios de equipe, LA Educa).
 *
 * Aceita:
 *   - role === 'coordinator' (cargo literal)
 *   - role === 'director' (sempre tudo)
 *   - has_coord_permissions === true (flag explícita)
 */
function hasCoordLevel(collab) {
  if (!collab) return false;
  if (collab.role === 'director') return true;
  if (collab.role === 'coordinator') return true;
  if (collab.has_coord_permissions === true) return true;
  return false;
}

/**
 * Director-only — não delega. Usado em aprovações sensíveis (comunicados,
 * projetos quando configurado como exclusivo, etc).
 */
function isDirector(collab) {
  return !!collab && collab.role === 'director';
}

/**
 * Sprint 30 — Apenas o CEO (decisor final). Distingue de outros directors
 * no organograma (Anne, Admin) que usam o TOM como usuários comuns sem
 * receber notificações de governança/aprovação/relatórios sistêmicos.
 *
 * Use isCEO() em vez de isDirector() pra:
 *   - Aprovar comunicados internos (only CEO approves)
 *   - Receber relatórios diários consolidados (eventos sem fechamento,
 *     tasks vencidas, engajamento de líderes, scorecard semanal)
 *   - Receber escalações LA Educa/LA Journey
 *   - Receber alertas de projetos pending_approval +6h
 */
function isCEO(collab) {
  return !!collab && collab.is_ceo === true;
}

/**
 * Lista de roles que historicamente recebiam relatórios coordinator-level.
 * Mantido pra compat com checks COORDINATOR_ROLES.includes(role).
 */
const COORDINATOR_ROLES_LITERAL = ['coordinator', 'director'];

/**
 * Sprint 28 — detecta cargo Farmer. Form PWA salva em `function_title`
 * (string livre tipo "Farmer"); pode também ter `function_role='farmer'`
 * via SQL direto. Casa qualquer um, case-insensitive.
 */
function isFarmer(collab) {
  if (!collab) return false;
  const fr = String(collab.function_role || '').toLowerCase();
  const ft = String(collab.function_title || '').toLowerCase();
  return fr === 'farmer' || ft === 'farmer';
}

/**
 * Sprint 28 — Detecta cargo "pedagógico" (assistente pedagógico / pedagógico).
 * Transita entre unidades — Farmer pode criar tarefa pra eles em qualquer unit.
 */
function isPedagogicoTransit(collab) {
  if (!collab) return false;
  const fr = String(collab.function_role || '').toLowerCase();
  const ft = String(collab.function_title || '').toLowerCase();
  return fr === 'pedagogico' || /pedag/.test(ft);
}

/**
 * Sprint 28 — Decide se `creator` pode criar tarefa/evento pra `target`.
 *
 * Regras de bloqueio:
 *   1. Director nunca pode receber de Farmer.
 *   2. Farmer só pode criar pra:
 *      - role='coordinator' (qualquer unidade — transit)
 *      - function_role/title pedagogico (qualquer unidade — transit)
 *      - mesma unidade do creator (qualquer cargo)
 *
 * Demais creators (collaborator/manager/coord/director) não têm restrição
 * de unidade nesta camada — segue comportamento atual.
 *
 * Returns { allowed: boolean, reason?: string }
 */
function canCreateForOther(creator, target) {
  if (!creator || !target) return { allowed: false, reason: 'missing_party' };

  // Gate 1: Director nunca recebe de Farmer
  if (isFarmer(creator) && target.role === 'director') {
    return { allowed: false, reason: 'farmer_to_director' };
  }

  // Gate 2: Farmer scope-limited
  if (isFarmer(creator)) {
    if (target.role === 'coordinator') return { allowed: true };
    if (isPedagogicoTransit(target)) return { allowed: true };
    const cu = String(creator.unit || '').trim().toLowerCase();
    const tu = String(target.unit || '').trim().toLowerCase();
    if (cu && tu && cu === tu) return { allowed: true };
    // Sem unidade ou unidades diferentes → bloqueia
    return { allowed: false, reason: `farmer_out_of_unit:creator=${creator.unit || 'none'},target=${target.unit || 'none'}` };
  }

  return { allowed: true };
}

module.exports = {
  hasCoordLevel,
  isDirector,
  isCEO,
  isFarmer,
  isPedagogicoTransit,
  canCreateForOther,
  COORDINATOR_ROLES_LITERAL,
};
