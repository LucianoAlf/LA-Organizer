// web/src/hooks/useTaskWatchers.ts
// IO dos watchers ("em cópia") de uma tarefa. Lógica pura do delta em lib/taskWatchers.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { diffWatchers } from '../lib/taskWatchers';

export function useTaskWatchers(taskId: string | null, enabled: boolean) {
  return useQuery({
    queryKey: ['task-watchers', taskId],
    enabled: enabled && Boolean(taskId),
    staleTime: 60_000,
    queryFn: async (): Promise<string[]> => {
      const { data, error } = await supabase
        .from('task_watchers')
        .select('collaborator_id')
        .eq('task_id', taskId!);
      if (error) throw error;
      return (data ?? []).map(r => r.collaborator_id as string);
    },
  });
}

export function useReplaceWatchers() {
  const { collaborator } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ taskId, next }: { taskId: string; next: string[] }) => {
      const { data: cur, error: e0 } = await supabase
        .from('task_watchers').select('collaborator_id').eq('task_id', taskId);
      if (e0) throw e0;
      const current = (cur ?? []).map(r => r.collaborator_id as string);
      const { add, remove } = diffWatchers(current, next);
      if (remove.length) {
        const { error } = await supabase
          .from('task_watchers').delete().eq('task_id', taskId).in('collaborator_id', remove);
        if (error) throw error;
      }
      if (add.length) {
        const rows = add.map(cid => ({ task_id: taskId, collaborator_id: cid, added_by: collaborator?.id ?? null }));
        const { error } = await supabase.from('task_watchers').insert(rows);
        if (error) throw error;
      }
      return { added: add };
    },
    onSuccess: (_r, vars) => {
      qc.invalidateQueries({ queryKey: ['task-watchers', vars.taskId] });
      qc.invalidateQueries({ queryKey: ['watched-tasks'] });
    },
  });
}
