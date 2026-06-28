// Subtarefas/checklist (2026-06-26) — dados das filhas de uma tarefa (parent_task_id).
// Reusa o primitivo do grupo: sub-item = task filha que herda context/assigned do pai.
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase, supabaseConfigured } from '../lib/supabase';
import { checklistProgress, shouldAutocompleteParent } from '../lib/taskChecklist';
import { notifySubtaskParentComplete } from '../lib/tomEngine';

export interface ChecklistParent {
  id: string;
  context?: string | null;
  assigned_to?: string | null;
  assigned_group_id?: string | null;
}

export interface ChecklistItem {
  id: string;
  title: string;
  status: string;
  sort_position: number | null;
  assigned_to: string | null;
}

export function useTaskChecklist(parent: ChecklistParent | null, meId: string | null | undefined) {
  const qc = useQueryClient();
  const parentId = parent?.id ?? null;

  const { data: items = [], isLoading } = useQuery<ChecklistItem[]>({
    queryKey: ['task-checklist', parentId],
    enabled: !!parentId && supabaseConfigured,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('tasks')
        .select('id, title, status, sort_position, assigned_to')
        .eq('parent_task_id', parentId)
        .neq('status', 'cancelled')
        .order('sort_position', { ascending: true, nullsFirst: true })
        .order('created_at', { ascending: true });
      if (error) throw error;
      return (data ?? []) as ChecklistItem[];
    },
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['task-checklist', parentId] });
    qc.invalidateQueries({ queryKey: ['tasks'] });
    qc.invalidateQueries({ queryKey: ['agenda-tasks'] });
  };

  const addItem = useMutation({
    mutationFn: async (title: string) => {
      const text = title.trim();
      if (!text || !parent) return;
      const maxPos = items.reduce((m, i) => Math.max(m, i.sort_position ?? 0), 0);
      const { error } = await supabase.from('tasks').insert({
        title: text,
        parent_task_id: parent.id,
        is_group: false,
        status: 'pending',
        context: parent.context ?? 'personal',
        assigned_to: parent.assigned_to ?? null,
        assigned_group_id: parent.assigned_group_id ?? null,
        created_by: meId ?? null,
        sort_position: maxPos + 1,
        source: 'manual',
      });
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  const toggleItem = useMutation({
    mutationFn: async ({ id, done }: { id: string; done: boolean }) => {
      const { error } = await supabase.from('tasks').update({
        status: done ? 'done' : 'pending',
        completed_at: done ? new Date().toISOString() : null,
        completed_by: done ? (meId ?? null) : null,
      }).eq('id', id);
      if (error) throw error;
      // Cascade (checklist ativo): se TODAS as filhas ficaram done → conclui o pai sozinho e
      // avisa o delegador via ponte (/internal). Se desmarcar de 100% → reabre o pai SEM avisar.
      if (!parent) return;
      const projected = items.map((i) => (i.id === id ? { ...i, status: done ? 'done' : 'pending' } : i));
      if (done && shouldAutocompleteParent(projected)) {
        await supabase.from('tasks').update({
          status: 'done', completed_at: new Date().toISOString(), completed_by: meId ?? null,
        }).eq('id', parent.id);
        try { await notifySubtaskParentComplete(parent.id, meId ?? null); } catch { /* best-effort */ }
      } else if (!done) {
        await supabase.from('tasks').update({
          status: 'pending', completed_at: null, completed_by: null,
        }).eq('id', parent.id).eq('status', 'done');
      }
    },
    onSuccess: invalidate,
  });

  const removeItem = useMutation({
    // Soft-delete (status='cancelled'), consistente com o resto do app — sai do checklist sem
    // apagar histórico. checklistProgress já ignora 'cancelled'.
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('tasks').update({ status: 'cancelled' }).eq('id', id);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  return { items, progress: checklistProgress(items), isLoading, addItem, toggleItem, removeItem };
}
