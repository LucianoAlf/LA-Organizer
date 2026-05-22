// Sprint 22.24 — Hook puro (sem queries). Recebe checkpoint + project + members
// ja carregados pelo pai (ProjetoDetalhe usa useProjectMembers). Retorna o
// responsavel computado com fallback pro created_by do projeto.

import type { ProjectFull, CheckpointFull } from '../types/projectDetail';
import type { ProjectMember } from '../types';

export interface CheckpointResponsavel {
  /** Membro responsavel, ou null se nao tem nem assigned_to nem created_by resolvivel. */
  member: ProjectMember | null;
  /** True se veio do fallback (project.created_by), false se veio do assigned_to do checkpoint. */
  isFallback: boolean;
  /** Nome de exibicao — collaborator.full_name ?? guest_name ?? '—'. */
  displayName: string;
}

function resolveDisplayName(m: ProjectMember): string {
  return m.collaborator?.full_name ?? m.guest_name ?? '—';
}

export function useCheckpointResponsavel(
  cp: Pick<CheckpointFull, 'assigned_to'>,
  project: Pick<ProjectFull, 'created_by'> | null | undefined,
  members: ProjectMember[],
): CheckpointResponsavel {
  if (cp.assigned_to) {
    const m = members.find((mm) => mm.collaborator_id === cp.assigned_to);
    if (m) {
      return {
        member: m,
        isFallback: false,
        displayName: resolveDisplayName(m),
      };
    }
  }
  // Fallback: created_by do projeto
  if (project?.created_by) {
    const m = members.find((mm) => mm.collaborator_id === project.created_by);
    if (m) {
      return {
        member: m,
        isFallback: true,
        displayName: resolveDisplayName(m),
      };
    }
  }
  return { member: null, isFallback: true, displayName: '—' };
}
