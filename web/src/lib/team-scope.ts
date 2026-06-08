// web/src/lib/team-scope.ts
// Resolvedor de ESCOPO da /time (Fase 3 — multi-tenant). Decide, a partir do
// viewer logado e do roster, o que ele enxerga:
//   • CEO (is_ceo)            → 'ceo'    · scopeIds null (empresa inteira)
//   • líder com liderados     → 'leader' · scopeIds = ids do time dele (membersOf)
//   • líder sem time / comum  → 'none'   · empty-state honesto
// Fonte única de "quem lidera quem": team-routing (mesma regra do TOM).
// scopeIds null = sem filtro (CEO). [] = ninguém (mode none).
import { membersOf, type Collab } from './team-routing';

export type ScopeMode = 'ceo' | 'leader' | 'none';

export interface TeamScope {
  mode: ScopeMode;
  viewerId: string;
  /** null = empresa inteira (CEO); array = restringe a estes ids; [] no mode none. */
  scopeIds: string[] | null;
  /** ids do time do líder (vazio p/ CEO e none). */
  memberIds: string[];
}

export function resolveScope(viewerId: string, allCollabs: Collab[]): TeamScope {
  const viewer = (allCollabs ?? []).find(c => c.id === viewerId) ?? null;
  if (!viewer) return { mode: 'none', viewerId, scopeIds: [], memberIds: [] };
  if (viewer.is_ceo) return { mode: 'ceo', viewerId, scopeIds: null, memberIds: [] };
  const memberIds = membersOf(viewer, allCollabs).map(c => c.id);
  if (memberIds.length === 0) return { mode: 'none', viewerId, scopeIds: [], memberIds: [] };
  return { mode: 'leader', viewerId, scopeIds: memberIds, memberIds };
}
