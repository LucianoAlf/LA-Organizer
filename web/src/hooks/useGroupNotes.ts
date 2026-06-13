import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { loadGroupNotes, upsertGroupNote, deleteGroupNote, togglePin, reorderGroupNotes, type GroupNote } from '../lib/groupNotes';
import { useAuth } from '../contexts/AuthContext';

export function useGroupNotes(groupId: string) {
  const qc = useQueryClient();
  const { collaborator } = useAuth();
  const meId = collaborator?.id ?? '';
  const key = ['group-notes', groupId];
  const list = useQuery({ queryKey: key, queryFn: () => loadGroupNotes(groupId), enabled: !!groupId });
  const inval = () => qc.invalidateQueries({ queryKey: key });
  const save = useMutation({ mutationFn: (n: Partial<GroupNote> & { id?: string }) => upsertGroupNote(groupId, meId, n), onSuccess: inval });
  const remove = useMutation({ mutationFn: (id: string) => deleteGroupNote(id), onSuccess: inval });
  const pin = useMutation({ mutationFn: (v: { id: string; pinned: boolean }) => togglePin(v.id, v.pinned), onSuccess: inval });
  // Reorder otimista: aplica sort_order no cache na hora; reverte se falhar.
  const reorder = useMutation({
    mutationFn: (updates: Array<{ id: string; sort_order: number }>) => reorderGroupNotes(updates),
    onMutate: async (updates) => {
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<GroupNote[]>(key);
      const map = new Map(updates.map((u) => [u.id, u.sort_order]));
      qc.setQueryData<GroupNote[]>(key, (old) => (old ?? []).map((n) => (map.has(n.id) ? { ...n, sort_order: map.get(n.id)! } : n)));
      return { prev };
    },
    onError: (_e, _v, ctx) => { if (ctx?.prev) qc.setQueryData(key, ctx.prev); },
    onSettled: inval,
  });
  return { notes: list.data ?? [], loading: list.isLoading, save, remove, pin, reorder };
}
