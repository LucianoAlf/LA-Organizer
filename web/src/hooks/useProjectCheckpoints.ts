// Sprint 22.23 (refactor) — extraido de screens/ProjetoDetalhe.tsx.
// Query + CRUD + reorder de project_checkpoints. Toggle em si fica como mutation
// crua (toggle.mutate(cp)); a logica de celebracao e cascata vive no consumidor.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase, supabaseConfigured } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import type { CheckpointFull } from '../types/projectDetail';

async function fetchCheckpoints(projectId: string): Promise<CheckpointFull[]> {
  const { data, error } = await supabase
    .from('project_checkpoints')
    .select('id, project_id, name, due_date, status, completed_at, sort_order, rationale')
    .eq('project_id', projectId)
    .order('sort_order', { ascending: true, nullsFirst: false })
    .order('due_date', { ascending: true });
  if (error) throw error;
  return (data ?? []) as CheckpointFull[];
}

export interface UseProjectCheckpointsResult {
  checkpoints: CheckpointFull[];
  togglePending: boolean;
  toggle: (cp: CheckpointFull) => void;
  rename: (input: { id: string; name: string }) => void;
  remove: (cpId: string) => void;
  create: (name: string) => void;
  reorder: (orderedIds: string[]) => void;
}

export function useProjectCheckpoints(projectId: string): UseProjectCheckpointsResult {
  const qc = useQueryClient();
  const { collaborator } = useAuth();
  const queryKey = ['project', projectId, 'checkpoints'] as const;

  const { data: checkpoints = [] } = useQuery({
    queryKey,
    queryFn: () => fetchCheckpoints(projectId),
    enabled: Boolean(projectId && supabaseConfigured),
  });

  const toggleMut = useMutation({
    mutationFn: async (cp: CheckpointFull) => {
      if (!collaborator) throw new Error('no_auth');
      const isDone = cp.status === 'done';
      const update = isDone
        ? { status: 'pending', completed_at: null, completed_by: null }
        : { status: 'done', completed_at: new Date().toISOString(), completed_by: collaborator.id };
      const { error } = await supabase.from('project_checkpoints').update(update).eq('id', cp.id);
      if (error) throw error;
    },
    onMutate: async (cp) => {
      await qc.cancelQueries({ queryKey });
      const prev = qc.getQueryData<CheckpointFull[]>(queryKey);
      qc.setQueryData<CheckpointFull[]>(queryKey, (old) =>
        (old || []).map(x => x.id === cp.id
          ? { ...x, status: x.status === 'done' ? 'pending' : 'done' }
          : x),
      );
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(queryKey, ctx.prev);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey });
    },
  });

  const renameMut = useMutation({
    mutationFn: async ({ id: cpId, name }: { id: string; name: string }) => {
      const { error } = await supabase.from('project_checkpoints').update({ name }).eq('id', cpId);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey }),
  });

  const deleteMut = useMutation({
    mutationFn: async (cpId: string) => {
      // Tasks vinculadas viram orfas (checkpoint_id = NULL) — nao queremos deletar tasks junto.
      await supabase.from('tasks').update({ checkpoint_id: null }).eq('checkpoint_id', cpId);
      const { error } = await supabase.from('project_checkpoints').delete().eq('id', cpId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey });
      qc.invalidateQueries({ queryKey: ['project', projectId, 'tasks'] });
    },
  });

  const createMut = useMutation({
    mutationFn: async (name: string) => {
      if (!collaborator) throw new Error('no_auth');
      const maxOrder = checkpoints.reduce((m, c) => Math.max(m, c.sort_order ?? 0), -1);
      const { error } = await supabase.from('project_checkpoints').insert({
        project_id: projectId,
        name: name.slice(0, 200),
        status: 'pending',
        sort_order: maxOrder + 1,
      });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey }),
  });

  // Bulk reorder com optimistic update — drag-and-drop precisa de feedback imediato.
  const reorderMut = useMutation({
    mutationFn: async (orderedIds: string[]) => {
      await Promise.all(
        orderedIds.map((cpId, idx) =>
          supabase.from('project_checkpoints').update({ sort_order: idx }).eq('id', cpId).then(({ error }) => {
            if (error) throw error;
          }),
        ),
      );
    },
    onMutate: async (orderedIds) => {
      await qc.cancelQueries({ queryKey });
      const prev = qc.getQueryData<CheckpointFull[]>(queryKey);
      qc.setQueryData<CheckpointFull[]>(queryKey, (old) => {
        if (!old) return old;
        const map = new Map(old.map(c => [c.id, c]));
        return orderedIds.map((cpId, idx) => ({ ...(map.get(cpId)!), sort_order: idx }));
      });
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(queryKey, ctx.prev);
    },
    onSettled: () => qc.invalidateQueries({ queryKey }),
  });

  return {
    checkpoints,
    togglePending: toggleMut.isPending,
    toggle: (cp) => toggleMut.mutate(cp),
    rename: (input) => renameMut.mutate(input),
    remove: (cpId) => deleteMut.mutate(cpId),
    create: (name) => createMut.mutate(name),
    reorder: (orderedIds) => reorderMut.mutate(orderedIds),
  };
}
