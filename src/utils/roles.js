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
 * Lista de roles que historicamente recebiam relatórios coordinator-level.
 * Mantido pra compat com checks COORDINATOR_ROLES.includes(role).
 */
const COORDINATOR_ROLES_LITERAL = ['coordinator', 'director'];

module.exports = {
  hasCoordLevel,
  isDirector,
  COORDINATOR_ROLES_LITERAL,
};
