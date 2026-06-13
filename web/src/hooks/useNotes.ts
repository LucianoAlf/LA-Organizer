// Módulo Anotações (spec 2026-06-10) — dados do caderninho.
// RLS protege (dono tudo; shared_with só leitura); aqui é conveniência de client.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { loadNoteTypes, upsertNoteType, deleteNoteType, reorderNotes, type NoteField, type PersonalNoteType } from '../lib/personalNotes';

export interface Note {
  id: string;
  collaborator_id: string;
  title: string;
  body: string;
  type: string;
  fields: NoteField[];
  color: string | null;
  icon: string | null;
  sort_order: number;
  tags: string[];
  pinned: boolean;
  archived: boolean;
  source: 'tom' | 'pwa';
  shared_with: string[];
  created_at: string;
  updated_at: string;
}

export interface NoteTaskLink {
  id: string;
  note_id: string;
  task_id: string;
  line_no: number;
}

export function useNotes() {
  const { collaborator } = useAuth();
  const qc = useQueryClient();
  const meuId = collaborator?.id ?? '';

  const list = useQuery({
    queryKey: ['notes', meuId],
    enabled: !!meuId,
    queryFn: async (): Promise<Note[]> => {
      const [mine, shared] = await Promise.all([
        supabase.from('notes').select('*').eq('collaborator_id', meuId).eq('archived', false),
        supabase.from('notes').select('*').contains('shared_with', [meuId]).eq('archived', false),
      ]);
      if (mine.error) throw mine.error;
      const norm = (n: Note): Note => ({
        ...n, type: n.type ?? 'livre', fields: Array.isArray(n.fields) ? n.fields : [],
        tags: Array.isArray(n.tags) ? n.tags : [], sort_order: n.sort_order ?? 0,
        color: n.color ?? null, icon: n.icon ?? null,
      });
      const all = new Map<string, Note>();
      [...((mine.data ?? []) as Note[]), ...((shared.data ?? []) as Note[])].forEach((n) => all.set(n.id, norm(n)));
      return [...all.values()].sort(
        (a, b) => Number(b.pinned) - Number(a.pinned) || (a.sort_order - b.sort_order) || b.updated_at.localeCompare(a.updated_at)
      );
    },
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ['notes'] });

  const createNote = useMutation({
    mutationFn: async (patch?: Partial<Note>): Promise<Note> => {
      const insert: Record<string, unknown> = {
        collaborator_id: meuId, title: patch?.title ?? '', body: patch?.body ?? '', source: 'pwa',
        type: patch?.type ?? 'livre', fields: patch?.fields ?? [],
        color: patch?.color ?? null, icon: patch?.icon ?? null, tags: patch?.tags ?? [],
      };
      const { data, error } = await supabase.from('notes').insert(insert).select('*').single();
      if (error) throw error;
      return data as Note;
    },
    onSuccess: invalidate,
  });

  const updateNote = useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Partial<Pick<Note, 'title' | 'body' | 'pinned' | 'archived' | 'shared_with' | 'type' | 'fields' | 'color' | 'icon' | 'sort_order' | 'tags'>> }) => {
      const { error } = await supabase
        .from('notes')
        .update({ ...patch, updated_at: new Date().toISOString() })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  const deleteNote = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('notes').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  // Reorder (sort_order 1..N) — update otimista + persiste por ficha (anti-reshuffle).
  const reorder = useMutation({
    mutationFn: (updates: Array<{ id: string; sort_order: number }>) => reorderNotes(updates),
    onMutate: async (updates) => {
      await qc.cancelQueries({ queryKey: ['notes', meuId] });
      const prev = qc.getQueryData<Note[]>(['notes', meuId]);
      if (prev) {
        const map = new Map(updates.map((u) => [u.id, u.sort_order]));
        qc.setQueryData<Note[]>(['notes', meuId], prev
          .map((n) => (map.has(n.id) ? { ...n, sort_order: map.get(n.id)! } : n))
          .sort((a, b) => Number(b.pinned) - Number(a.pinned) || (a.sort_order - b.sort_order) || b.updated_at.localeCompare(a.updated_at)));
      }
      return { prev };
    },
    onError: (_e, _v, ctx) => { if (ctx?.prev) qc.setQueryData(['notes', meuId], ctx.prev); },
    onSettled: invalidate,
  });

  return { list, createNote, updateNote, deleteNote, reorder, meuId };
}

// Tipos de ficha customizados POR USUÁRIO (note_types) — espelha useGroupNoteTypes.
export function useNoteTypes() {
  const { collaborator } = useAuth();
  const qc = useQueryClient();
  const meId = collaborator?.id ?? '';
  const key = ['note-types', meId];
  const list = useQuery({ queryKey: key, queryFn: () => loadNoteTypes(meId), enabled: !!meId });
  const inval = () => qc.invalidateQueries({ queryKey: key });
  const saveType = useMutation({ mutationFn: (t: Partial<PersonalNoteType> & { id?: string }) => upsertNoteType(meId, t), onSuccess: inval });
  const removeType = useMutation({ mutationFn: (id: string) => deleteNoteType(id), onSuccess: inval });
  return { types: list.data ?? [], loading: list.isLoading, saveType, removeType };
}

export function useNoteTaskLinks(noteId: string | undefined) {
  return useQuery({
    queryKey: ['note-task-links', noteId],
    enabled: !!noteId,
    queryFn: async (): Promise<NoteTaskLink[]> => {
      const { data, error } = await supabase
        .from('note_task_links')
        .select('id, note_id, task_id, line_no')
        .eq('note_id', noteId as string);
      if (error) throw error;
      return (data ?? []) as NoteTaskLink[];
    },
  });
}

// Roster pra compartilhar / delegar (mesma fonte do gov-roster).
export function useCollabRoster() {
  return useQuery({
    queryKey: ['notes-roster'],
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<Array<{ id: string; full_name: string }>> => {
      const { data, error } = await supabase
        .from('collaborators')
        .select('id, full_name')
        .eq('is_active', true)
        .order('full_name');
      if (error) throw error;
      return (data ?? []) as Array<{ id: string; full_name: string }>;
    },
  });
}
