import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase, supabaseConfigured } from '../../../lib/supabase';
import { useAuth } from '../../../contexts/AuthContext';
import type { AgendaFilters } from './useAgendaFilters';

export interface EventForGrid {
  id: string;
  title: string;
  description?: string | null;
  start_at: string;
  end_at: string;
  context: 'work' | 'personal';
  category: string;
  category_color: string | null;
  modality: 'presencial' | 'online' | 'hibrido';
  location_text: string | null;
  meeting_url: string | null;
  status: 'scheduled' | 'done' | 'cancelled';
  project_id: string | null;
  source: 'manual' | 'tom' | 'imported';
  eisenhower_quadrant?: number | null;
  remind_at?: string | null;
}

// Sprint Agenda Desktop — query de eventos no range [from,to] com JOIN em
// event_categories para puxar a cor (events.category_id é NOT NULL e referencia
// event_categories; events.category texto é legado/slug).
export function useAgendaEvents(params: { from: Date; to: Date; filters: AgendaFilters }) {
  const { collaborator } = useAuth();
  const collaboratorId = collaborator?.id;
  const fromIso = params.from.toISOString();
  const toIso = params.to.toISOString();

  const { data, isLoading, error } = useQuery({
    queryKey: ['agenda-events', collaboratorId, fromIso, toIso],
    enabled: Boolean(collaboratorId && supabaseConfigured),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('events')
        .select(`
          id, title, description, start_at, end_at, context, category, modality,
          location_text, meeting_url, status, project_id, source,
          eisenhower_quadrant, remind_at,
          event_categories!category_id ( slug, label, color )
        `)
        .eq('collaborator_id', collaboratorId!)
        .gte('start_at', fromIso)
        .lte('start_at', toIso)
        .order('start_at', { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
  });

  const events = useMemo<EventForGrid[]>(() => {
    if (!data) return [];
    return (data as any[])
      .filter(e => {
        if (e.context === 'work' && !params.filters.trabalho) return false;
        if (e.context === 'personal' && !params.filters.pessoal) return false;
        return true;
      })
      .map(e => {
        const cat = Array.isArray(e.event_categories) ? e.event_categories[0] : e.event_categories;
        return {
          id: e.id,
          title: e.title,
          description: e.description ?? null,
          start_at: e.start_at,
          end_at: e.end_at,
          context: e.context,
          category: cat?.slug ?? e.category ?? 'la_music',
          category_color: cat?.color ?? null,
          modality: e.modality,
          location_text: e.location_text,
          meeting_url: e.meeting_url,
          status: e.status,
          project_id: e.project_id,
          source: e.source,
          eisenhower_quadrant: e.eisenhower_quadrant ?? null,
          remind_at: e.remind_at ?? null,
        };
      });
  }, [data, params.filters]);

  return { events, isLoading, error };
}
