// Sprint 22.26 (audit Hoje, Fatia D) — categorias dinamicas de eventos.
// Lista categorias visiveis (globais + pessoais do user) + mutations de CRUD pra
// pessoais. RLS garante que so o dono mexa nas suas; nao da pra ver/mexer
// pessoais de outro user.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase, supabaseConfigured } from '../lib/supabase';
import type { EventCategory, TaskContext } from '../types';

async function fetchEventCategories(): Promise<EventCategory[]> {
  const { data, error } = await supabase
    .from('event_categories')
    .select('id, collaborator_id, slug, label, context, icon, is_system, sort_order')
    .order('context', { ascending: true })
    .order('is_system', { ascending: false })  // system primeiro dentro do mesmo context
    .order('sort_order', { ascending: true })
    .order('label', { ascending: true });
  if (error) throw error;
  return (data ?? []) as EventCategory[];
}

function slugify(label: string): string {
  return label
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')  // remove acentos
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60) || 'cat';
}

export interface UseEventCategoriesResult {
  categories: EventCategory[];
  workCategories: EventCategory[];
  personalCategories: EventCategory[];
  byId: (id: string) => EventCategory | undefined;
  bySlug: (slug: string) => EventCategory | undefined;
  /** Cria categoria pessoal pro user atual. Retorna a categoria criada. */
  createPersonal: (label: string, icon?: string) => Promise<EventCategory>;
  /** Renomeia uma categoria pessoal do proprio user (RLS bloqueia outras). */
  renamePersonal: (id: string, label: string) => Promise<void>;
  deletePersonal: (id: string) => Promise<void>;
}

export function useEventCategories(): UseEventCategoriesResult {
  const qc = useQueryClient();
  const queryKey = ['event-categories'] as const;

  const { data: categories = [] } = useQuery({
    queryKey,
    queryFn: fetchEventCategories,
    enabled: supabaseConfigured,
    staleTime: 5 * 60_000,
  });

  const workCategories = categories.filter(c => c.context === 'work');
  const personalCategories = categories.filter(c => c.context === 'personal');

  const createMut = useMutation({
    mutationFn: async ({ label, icon }: { label: string; icon?: string }): Promise<EventCategory> => {
      const trimmed = label.trim();
      if (trimmed.length < 2) throw new Error('Nome curto demais');
      if (trimmed.length > 60) throw new Error('Nome longo demais');
      // Pega user atual
      const { data: auth } = await supabase.auth.getUser();
      const userId = auth.user?.id;
      if (!userId) throw new Error('no_session');
      // collaborator_id = current_collab_id() — vamos buscar pelo user.id
      const { data: collab, error: ce } = await supabase
        .from('collaborators').select('id').eq('user_id', userId).maybeSingle();
      if (ce || !collab?.id) throw new Error('no_collab');
      const slug = slugify(trimmed);
      const { data, error } = await supabase
        .from('event_categories')
        .insert({
          collaborator_id: collab.id,
          slug,
          label: trimmed,
          context: 'personal' as TaskContext,
          icon: icon ?? null,
          is_system: false,
          sort_order: 100,  // pessoais sempre depois das system
        })
        .select('id, collaborator_id, slug, label, context, icon, is_system, sort_order')
        .single();
      if (error) throw error;
      return data as EventCategory;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey }),
  });

  const renameMut = useMutation({
    mutationFn: async ({ id, label }: { id: string; label: string }) => {
      const { error } = await supabase
        .from('event_categories')
        .update({ label: label.trim().slice(0, 60) })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey }),
  });

  const deleteMut = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('event_categories').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey }),
  });

  return {
    categories,
    workCategories,
    personalCategories,
    byId: (id) => categories.find(c => c.id === id),
    bySlug: (slug) => categories.find(c => c.slug === slug),
    createPersonal: (label, icon) => createMut.mutateAsync({ label, icon }),
    renamePersonal: (id, label) => renameMut.mutateAsync({ id, label }),
    deletePersonal: (id) => deleteMut.mutateAsync(id),
  };
}
