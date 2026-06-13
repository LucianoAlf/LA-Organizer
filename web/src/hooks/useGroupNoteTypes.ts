import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { loadGroupNoteTypes, upsertGroupNoteType, deleteGroupNoteType, type GroupNoteType } from '../lib/groupNotes';
import { useAuth } from '../contexts/AuthContext';

export function useGroupNoteTypes(groupId: string) {
  const qc = useQueryClient();
  const { collaborator } = useAuth();
  const meId = collaborator?.id ?? '';
  const key = ['group-note-types', groupId];
  const list = useQuery({ queryKey: key, queryFn: () => loadGroupNoteTypes(groupId), enabled: !!groupId });
  const inval = () => qc.invalidateQueries({ queryKey: key });
  const saveType = useMutation({ mutationFn: (t: Partial<GroupNoteType> & { id?: string }) => upsertGroupNoteType(groupId, meId, t), onSuccess: inval });
  const removeType = useMutation({ mutationFn: (id: string) => deleteGroupNoteType(id), onSuccess: inval });
  return { types: list.data ?? [], loading: list.isLoading, saveType, removeType };
}
