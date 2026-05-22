// Hook que busca os "responsáveis" (owner) e contagem de membros de uma lista
// de projetos, em UMA query só. Usado pra mostrar o dono em cada card sem
// fazer N requests.

import { useQuery } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';

export interface ProjectOwnerInfo {
  /** Nome do responsável (owner) — ou null se ninguém marcado. */
  ownerName: string | null;
  /** ID do colaborador owner. */
  ownerId: string | null;
  /** Total de membros (incluindo owner). */
  memberCount: number;
}

interface MemberRow {
  project_id: string;
  collaborator_id: string;
  role_in_project: string;
  collaborators: { full_name: string | null; preferred_name: string | null } | null;
}

/**
 * Mapeia { projectId → { ownerName, ownerId, memberCount } } pra uma lista de
 * projetos. Roda 1 query joinando collaborators.
 */
export function useProjectOwners(projectIds: string[]) {
  return useQuery({
    queryKey: ['project-owners-map', [...projectIds].sort()],
    enabled: projectIds.length > 0,
    staleTime: 60_000,
    queryFn: async (): Promise<Record<string, ProjectOwnerInfo>> => {
      const { data, error } = await supabase
        .from('project_members')
        .select('project_id, collaborator_id, role_in_project, collaborators(full_name, preferred_name)')
        .in('project_id', projectIds);
      if (error || !data) return {};

      const map: Record<string, ProjectOwnerInfo> = {};
      for (const row of data as unknown as MemberRow[]) {
        const pid = row.project_id;
        if (!map[pid]) {
          map[pid] = { ownerName: null, ownerId: null, memberCount: 0 };
        }
        map[pid].memberCount += 1;
        if (row.role_in_project === 'owner' && !map[pid].ownerId) {
          const c = row.collaborators;
          map[pid].ownerName = c?.preferred_name || c?.full_name || null;
          map[pid].ownerId = row.collaborator_id;
        }
      }
      // Fallback: se não tem owner explícito mas tem coordinator, usa o primeiro
      for (const pid of projectIds) {
        if (map[pid] && !map[pid].ownerId) {
          const coord = (data as unknown as MemberRow[]).find(
            r => r.project_id === pid && r.role_in_project === 'coordinator',
          );
          if (coord) {
            const c = coord.collaborators;
            map[pid].ownerName = c?.preferred_name || c?.full_name || null;
            map[pid].ownerId = coord.collaborator_id;
          }
        }
      }
      return map;
    },
  });
}
