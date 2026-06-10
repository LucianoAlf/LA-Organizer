// Módulo Anotações (spec 2026-06-10) — dados do caderninho.
// RLS protege (dono tudo; shared_with só leitura); aqui é conveniência de client.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';

export interface Note {
  id: string;
  collaborator_id: string;
  title: string;
  body: string;
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
      const all = new Map<string, Note>();
      [...((mine.data ?? []) as Note[]), ...((shared.data ?? []) as Note[])].forEach((n) => all.set(n.id, n));
      return [...all.values()].sort(
        (a, b) => Number(b.pinned) - Number(a.pinned) || b.updated_at.localeCompare(a.updated_at)
      );
    },
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ['notes'] });

  const createNote = useMutation({
    mutationFn: async (): Promise<Note> => {
      const { data, error } = await supabase
        .from('notes')
        .insert({ collaborator_id: meuId, title: '', body: '', source: 'pwa' })
        .select('*')
        .single();
      if (error) throw error;
      return data as Note;
    },
    onSuccess: invalidate,
  });

  const updateNote = useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Partial<Pick<Note, 'title' | 'body' | 'pinned' | 'archived' | 'shared_with'>> }) => {
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

  return { list, createNote, updateNote, deleteNote, meuId };
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
