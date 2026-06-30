// web/src/hooks/useWatchedTasks.ts
// Tarefas em que estou "em cópia" (acompanho e cobro, não concluo). Leitura SEPARADA —
// não toca a .or() central de useAgendaTasks (zero-regressão).
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';

export interface WatchedTask {
  id: string; title: string; due_date: string | null;
  status: string; assigned_to: string | null; executor_name: string | null;
}

export function useWatchedTasks(enabled: boolean) {
  const { collaborator } = useAuth();
  const meId = collaborator?.id;
  return useQuery({
    queryKey: ['watched-tasks', meId],
    enabled: enabled && Boolean(meId),
    staleTime: 60_000,
    queryFn: async (): Promise<WatchedTask[]> => {
      const { data: wr, error: e0 } = await supabase
        .from('task_watchers').select('task_id').eq('collaborator_id', meId!);
      if (e0) throw e0;
      const ids = (wr ?? []).map(r => r.task_id as string);
      if (!ids.length) return [];
      const { data, error } = await supabase
        .from('tasks')
        .select('id, title, due_date, status, assigned_to, executor:collaborators!tasks_assigned_to_fkey(preferred_name, full_name)')
        .in('id', ids)
        .not('status', 'in', '(done,cancelled)')
        .order('due_date', { ascending: true });
      if (error) throw error;
      return (data ?? []).map((t: any) => ({
        id: t.id, title: t.title, due_date: t.due_date, status: t.status,
        assigned_to: t.assigned_to,
        executor_name: t.executor?.preferred_name ?? t.executor?.full_name ?? null,
      }));
    },
  });
}
