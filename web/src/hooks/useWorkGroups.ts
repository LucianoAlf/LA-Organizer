// Grupos de trabalho (spec 2026-06-10) — pools de tarefas por grupo.
// RLS: leitura geral; escrita só líder/diretor (e can_manage_groups no insert).
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';

export interface WorkGroupMember {
  collaborator_id: string;
  full_name: string;
}

export interface WorkGroup {
  id: string;
  name: string;
  slug: string;
  leader_id: string;
  active: boolean;
  members: WorkGroupMember[];
}

function slugify(name: string): string {
  return name.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

export function useWorkGroups() {
  const { collaborator } = useAuth();
  const qc = useQueryClient();
  const meuId = collaborator?.id ?? '';

  const list = useQuery({
    queryKey: ['work-groups'],
    queryFn: async (): Promise<WorkGroup[]> => {
      const [{ data: groups, error }, { data: members }] = await Promise.all([
        supabase.from('work_groups').select('id, name, slug, leader_id, active').eq('active', true).order('name'),
        // FK explícita obrigatória: a tabela tem 2 FKs pra collaborators (collaborator_id e added_by).
        supabase.from('work_group_members').select('group_id, collaborator_id, collaborator:collaborators!work_group_members_collaborator_id_fkey(full_name)'),
      ]);
      if (error) throw error;
      return (groups ?? []).map((g) => ({
        ...(g as Omit<WorkGroup, 'members'>),
        members: (members ?? [])
          .filter((m) => m.group_id === g.id)
          .map((m) => ({
            collaborator_id: m.collaborator_id as string,
            full_name: ((m as Record<string, unknown>).collaborator as { full_name: string } | null)?.full_name ?? '?',
          })),
      }));
    },
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ['work-groups'] });

  const createGroup = useMutation({
    mutationFn: async ({ name, leaderId, memberIds }: { name: string; leaderId: string; memberIds: string[] }) => {
      const { data, error } = await supabase.from('work_groups')
        .insert({ name: name.trim(), slug: slugify(name), leader_id: leaderId, created_by: meuId })
        .select('id').single();
      if (error) throw error;
      const gid = (data as { id: string }).id;
      const rows = [...new Set([leaderId, ...memberIds])].map((cid) => ({ group_id: gid, collaborator_id: cid, added_by: meuId }));
      const { error: me } = await supabase.from('work_group_members').upsert(rows, { onConflict: 'group_id,collaborator_id' });
      if (me) throw me;
      return gid;
    },
    onSuccess: invalidate,
  });

  const updateGroup = useMutation({
    mutationFn: async ({ id, name, leaderId }: { id: string; name?: string; leaderId?: string }) => {
      const patch: Record<string, unknown> = {};
      if (name !== undefined) { patch.name = name.trim(); }
      if (leaderId !== undefined) patch.leader_id = leaderId;
      const { error } = await supabase.from('work_groups').update(patch).eq('id', id);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  const addMember = useMutation({
    mutationFn: async ({ groupId, collaboratorId }: { groupId: string; collaboratorId: string }) => {
      const { error } = await supabase.from('work_group_members')
        .upsert({ group_id: groupId, collaborator_id: collaboratorId, added_by: meuId }, { onConflict: 'group_id,collaborator_id' });
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  const removeMember = useMutation({
    mutationFn: async ({ groupId, collaboratorId }: { groupId: string; collaboratorId: string }) => {
      const { error } = await supabase.from('work_group_members')
        .delete().eq('group_id', groupId).eq('collaborator_id', collaboratorId);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  const deactivateGroup = useMutation({
    mutationFn: async (id: string) => {
      // Spec: bloquear desativação com tarefas abertas do grupo.
      const { count } = await supabase.from('tasks')
        .select('id', { count: 'exact', head: true })
        .eq('assigned_group_id', id).in('status', ['pending', 'in_progress']);
      if ((count ?? 0) > 0) throw new Error(`Grupo tem ${count} tarefa(s) aberta(s) — conclui ou reatribui antes de desativar.`);
      const { error } = await supabase.from('work_groups').update({ active: false }).eq('id', id);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  return { list, createGroup, updateGroup, addMember, removeMember, deactivateGroup, meuId };
}

// Ids dos grupos do usuário logado — pras listas de tarefas incluírem o pool.
export function useMyGroupIds() {
  const { collaborator } = useAuth();
  return useQuery({
    queryKey: ['my-group-ids', collaborator?.id],
    enabled: !!collaborator?.id,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<string[]> => {
      const { data } = await supabase.from('work_group_members')
        .select('group_id').eq('collaborator_id', collaborator!.id);
      return (data ?? []).map((r) => r.group_id as string);
    },
  });
}
