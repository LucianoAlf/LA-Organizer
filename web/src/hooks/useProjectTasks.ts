// Sprint 22.23 (refactor) — extraido de screens/ProjetoDetalhe.tsx.
// Query + CRUD + reorder + assign de tasks vinculadas a um projeto.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase, supabaseConfigured } from '../lib/supabase';
import type { Task } from '../types';

async function fetchProjectTasks(projectId: string): Promise<Task[]> {
  const { data, error } = await supabase
    .from('tasks')
    .select('id, title, status, context, priority, due_date, scheduled_date, remind_at, eisenhower_quadrant, project_id, checkpoint_id, sort_position, assigned_to, created_by, completed_at, action_type, source')
    .eq('project_id', projectId)
    .order('sort_position', { ascending: true, nullsFirst: false })
    .order('due_date', { ascending: true, nullsFirst: false });
  if (error) throw error;
  return (data ?? []) as unknown as Task[];
}

export interface UseProjectTasksResult {
  tasks: Task[];
  toggle: (task: Task) => void;
  rename: (input: { id: string; title: string }) => void;
  remove: (taskId: string) => void;
  assign: (input: { taskId: string; collabId: string }) => void;
  reorder: (input: { checkpointId: string | null; orderedIds: string[] }) => void;
}

export function useProjectTasks(projectId: string): UseProjectTasksResult {
  const qc = useQueryClient();
  const queryKey = ['project', projectId, 'tasks'] as const;

  const { data: tasks = [] } = useQuery({
    queryKey,
    queryFn: () => fetchProjectTasks(projectId),
    enabled: Boolean(projectId && supabaseConfigured),
  });

  const toggleMut = useMutation({
    mutationFn: async (task: Task) => {
      const next = task.status === 'done' ? 'pending' : 'done';
      const { error } = await supabase
        .from('tasks')
        .update({ status: next, completed_at: next === 'done' ? new Date().toISOString() : null })
        .eq('id', task.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey });
      qc.invalidateQueries({ queryKey: ['tasks'] });
    },
  });

  const renameMut = useMutation({
    mutationFn: async ({ id: tId, title }: { id: string; title: string }) => {
      const { error } = await supabase.from('tasks').update({ title }).eq('id', tId);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey }),
  });

  const deleteMut = useMutation({
    mutationFn: async (tId: string) => {
      const { error } = await supabase.from('tasks').delete().eq('id', tId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey });
      qc.invalidateQueries({ queryKey: ['tasks'] });
    },
  });

  // Sprint 22.22 — atribuir task a um membro do projeto (otimista).
  const assignMut = useMutation({
    mutationFn: async ({ taskId, collabId }: { taskId: string; collabId: string }) => {
      const { error } = await supabase.from('tasks').update({ assigned_to: collabId }).eq('id', taskId);
      if (error) throw error;
    },
    onMutate: async ({ taskId, collabId }) => {
      await qc.cancelQueries({ queryKey });
      const prev = qc.getQueryData<Task[]>(queryKey);
      qc.setQueryData<Task[]>(queryKey, (old) =>
        (old || []).map(t => t.id === taskId ? { ...t, assigned_to: collabId } : t),
      );
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(queryKey, ctx.prev);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey });
      qc.invalidateQueries({ queryKey: ['tasks'] });
    },
  });

  const reorderMut = useMutation({
    mutationFn: async ({ checkpointId: _cpId, orderedIds }: { checkpointId: string | null; orderedIds: string[] }) => {
      await Promise.all(
        orderedIds.map((taskId, idx) =>
          supabase.from('tasks').update({ sort_position: idx }).eq('id', taskId).then(({ error }) => {
            if (error) throw error;
          }),
        ),
      );
    },
    onMutate: async ({ checkpointId, orderedIds }) => {
      await qc.cancelQueries({ queryKey });
      const prev = qc.getQueryData<Task[]>(queryKey);
      qc.setQueryData<Task[]>(queryKey, (old) => {
        if (!old) return old;
        // Atualiza sort_position dos itens reordenados; outros ficam intactos.
        const positionMap = new Map(orderedIds.map((tId, idx) => [tId, idx]));
        return old.map(t => {
          const k = (t as Task & { checkpoint_id?: string | null }).checkpoint_id ?? null;
          if (k !== checkpointId) return t;
          const newPos = positionMap.get(t.id);
          if (newPos == null) return t;
          return { ...t, sort_position: newPos } as Task;
        }).sort((a, b) => {
          const pa = (a as Task & { sort_position?: number | null }).sort_position ?? 0;
          const pb = (b as Task & { sort_position?: number | null }).sort_position ?? 0;
          return pa - pb;
        });
      });
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(queryKey, ctx.prev);
    },
    onSettled: () => qc.invalidateQueries({ queryKey }),
  });

  return {
    tasks,
    toggle: (task) => toggleMut.mutate(task),
    rename: (input) => renameMut.mutate(input),
    remove: (taskId) => deleteMut.mutate(taskId),
    assign: (input) => assignMut.mutate(input),
    reorder: (input) => reorderMut.mutate(input),
  };
}
