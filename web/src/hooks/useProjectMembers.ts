// Sprint 22.23 (refactor) — extraido de screens/ProjetoDetalhe.tsx.
// Query de project_members + estado derivado de permissoes/atribuicao.
// Mutations de membros vivem em components/MembersTab.tsx (escopo daquela aba).

import { useQuery } from '@tanstack/react-query';
import { supabase, supabaseConfigured } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import type { ProjectMember } from '../types';
import type { AssigneeOption } from '../components/AssigneePicker';

async function fetchMembers(projectId: string): Promise<ProjectMember[]> {
  const { data, error } = await supabase
    .from('project_members')
    .select('id, project_id, collaborator_id, role_in_project, function_in_project, guest_name, guest_role, sort_position, created_at, collaborators(id, full_name, function_title)')
    .eq('project_id', projectId)
    .order('sort_position', { ascending: true, nullsFirst: false })
    .order('created_at', { ascending: true });
  if (error) throw error;
  // Supabase pode devolver collaborators como array (FK) — normalizar pra objeto.
  return ((data ?? []) as Array<Record<string, unknown>>).map(row => {
    const coll = row.collaborators as { id: string; full_name: string; function_title: string | null } | { id: string; full_name: string; function_title: string | null }[] | null;
    const collaborator = Array.isArray(coll) ? (coll[0] ?? null) : coll;
    return {
      id: row.id as string,
      project_id: row.project_id as string,
      collaborator_id: (row.collaborator_id as string | null) ?? null,
      role_in_project: row.role_in_project as ProjectMember['role_in_project'],
      function_in_project: (row.function_in_project as string | null) ?? null,
      guest_name: (row.guest_name as string | null) ?? null,
      guest_role: (row.guest_role as string | null) ?? null,
      created_at: row.created_at as string,
      collaborator,
    };
  });
}

export interface UseProjectMembersResult {
  members: ProjectMember[];
  myMembership: ProjectMember | undefined;
  isGlobalLead: boolean;
  isProjectLead: boolean;
  /** Pode ver todas as tasks do projeto (nao filtra por assignee). */
  canSeeAll: boolean;
  /** Membros internos (collaborator_id != null) disponiveis pra atribuir tasks. */
  assigneeOptions: AssigneeOption[];
}

export function useProjectMembers(projectId: string): UseProjectMembersResult {
  const { collaborator, role } = useAuth();
  const isGlobalLead = role === 'coordinator' || role === 'director';

  const { data: members = [] } = useQuery<ProjectMember[]>({
    queryKey: ['project', projectId, 'members'],
    queryFn: () => fetchMembers(projectId),
    enabled: Boolean(projectId && supabaseConfigured),
  });

  const myMembership = members.find(m => m.collaborator_id === collaborator?.id);
  const isProjectLead = myMembership?.role_in_project === 'owner' || myMembership?.role_in_project === 'coordinator';
  const canSeeAll = isGlobalLead || isProjectLead;

  const assigneeOptions: AssigneeOption[] = members
    .filter(m => m.collaborator_id && m.collaborator?.full_name)
    .map(m => ({
      id: m.collaborator_id!,
      full_name: m.collaborator!.full_name,
      role_in_project: m.role_in_project,
    }));

  return {
    members,
    myMembership,
    isGlobalLead,
    isProjectLead,
    canSeeAll,
    assigneeOptions,
  };
}
