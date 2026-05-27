// web/src/lib/permissions.ts — Sprint 30
// Espelho TS de src/utils/roles.js (backend). DEVE estar em paridade.
//
// Filosofia: cargo (role) reflete o organograma (director/coordinator/manager/collaborator).
// Permissão operacional pode ser concedida individualmente via `has_coord_permissions`,
// que destrava ações de nível coordinator (criar comunicado, ver scorecard de equipe,
// LA Educa, etc) mesmo pra quem tem role='collaborator' no organograma.
//
// Use estes helpers em vez de hardcoded checks tipo `role === 'director'`.

import type { Collaborator } from '../types';

/**
 * Retorna true se o colaborador tem nível operacional de coordenador.
 * Aceita:
 *   - role === 'director' (sempre tudo)
 *   - role === 'coordinator'
 *   - has_coord_permissions === true (override individual, ex: assistentes
 *     pedagógicos como Léo/Dai/Jordan, managers como Krissya/Yuri/Jereh/Clayton,
 *     coordenadores de área como Hugo (Tech) e John (Marketing))
 */
export function hasCoordLevel(collab: Collaborator | null | undefined): boolean {
  if (!collab) return false;
  if (collab.role === 'director') return true;
  if (collab.role === 'coordinator') return true;
  if (collab.has_coord_permissions === true) return true;
  return false;
}

/**
 * Director-only — não delega. Usado em aprovações sensíveis (comunicados,
 * promoção de permissões, etc).
 */
export function isDirector(collab: Collaborator | null | undefined): boolean {
  return !!collab && collab.role === 'director';
}

/**
 * Sprint 28 — detecta cargo Farmer (gate de unit + sem permissão de comunicados).
 */
export function isFarmer(collab: Collaborator | null | undefined): boolean {
  if (!collab) return false;
  const fr = String(collab.function_role || '').toLowerCase();
  const ft = String(collab.function_title || '').toLowerCase();
  return fr === 'farmer' || ft === 'farmer';
}
