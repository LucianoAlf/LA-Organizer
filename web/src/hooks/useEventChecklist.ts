// Checklist de compromisso (2026-06-26) — pauta/preparação de um evento via tabela-satélite
// event_checklist_items. Espelha useTaskChecklist, mas sobre evento (campo `done` bool) e SEM
// herança de assigned (evento tem dono próprio). Semântica: marcar NÃO conclui o evento.
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase, supabaseConfigured } from '../lib/supabase';

export interface EventChecklistItem {
  id: string;
  title: string;
  done: boolean;
  sort_position: number | null;
}

export function useEventChecklist(eventId: string | null | undefined, meId: string | null | undefined) {
  const qc = useQueryClient();
  const id = eventId ?? null;

  const { data: items = [], isLoading } = useQuery<EventChecklistItem[]>({
    queryKey: ['event-checklist', id],
    enabled: !!id && supabaseConfigured,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('event_checklist_items')
        .select('id, title, done, sort_position')
        .eq('event_id', id)
        .order('sort_position', { ascending: true, nullsFirst: true })
        .order('created_at', { ascending: true });
      if (error) throw error;
      return (data ?? []) as EventChecklistItem[];
    },
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['event-checklist', id] });
    qc.invalidateQueries({ queryKey: ['events'] });
  };

  const addItem = useMutation({
    mutationFn: async (title: string) => {
      const text = title.trim();
      if (!text || !id) return;
      const maxPos = items.reduce((m, i) => Math.max(m, i.sort_position ?? 0), 0);
      const { error } = await supabase.from('event_checklist_items').insert({
        event_id: id,
        title: text,
        done: false,
        sort_position: maxPos + 1,
        created_by: meId ?? null,
      });
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  const toggleItem = useMutation({
    mutationFn: async ({ id: itemId, done }: { id: string; done: boolean }) => {
      const { error } = await supabase.from('event_checklist_items').update({ done }).eq('id', itemId);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  const removeItem = useMutation({
    // Hard delete — pauta não precisa de histórico (diferente da tarefa, que faz soft-delete).
    mutationFn: async (itemId: string) => {
      const { error } = await supabase.from('event_checklist_items').delete().eq('id', itemId);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  const progress = { done: items.filter(i => i.done).length, total: items.length };

  return { items, progress, isLoading, addItem, toggleItem, removeItem };
}
