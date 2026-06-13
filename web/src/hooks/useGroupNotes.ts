import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { loadGroupNotes, upsertGroupNote, deleteGroupNote, togglePin, type GroupNote } from '../lib/groupNotes';
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
  return { notes: list.data ?? [], loading: list.isLoading, save, remove, pin };
}
