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

const EVENT_SELECT = `
  id, title, description, start_at, end_at, context, category, modality,
  location_text, meeting_url, status, project_id, source,
  eisenhower_quadrant, remind_at,
  event_categories!category_id ( slug, label, color )
` as const;

// Sprint Agenda Desktop — query de eventos no range [from,to].
//
// Fix 2026-05-28: replica o padrão owned + invited de fetchEventsForDay
// (lib/events.ts, fix 2026-05-15). Antes, eventos onde o user era convidado
// via event_participants não apareciam no desktop, só no mobile (/hoje).
// Agora: query 1 = events.collaborator_id=eu + query 2 = event_participants,
// merge dedup por id, filtra pelo range em JS (participants não tem range no SQL).
export function useAgendaEvents(params: { from: Date; to: Date; filters: AgendaFilters }) {
  const { collaborator } = useAuth();
  const collaboratorId = collaborator?.id;
  const fromIso = params.from.toISOString();
  const toIso = params.to.toISOString();

  const { data, isLoading, error } = useQuery({
    queryKey: ['agenda-events', collaboratorId, fromIso, toIso],
    enabled: Boolean(collaboratorId && supabaseConfigured),
    queryFn: async () => {
      const [ownRes, partsRes] = await Promise.all([
        supabase
          .from('events')
          .select(EVENT_SELECT)
          .eq('collaborator_id', collaboratorId!)
          .gte('start_at', fromIso)
          .lte('start_at', toIso)
          .order('start_at', { ascending: true }),
        supabase
          .from('event_participants')
          .select(`event:events(${EVENT_SELECT})`)
          .eq('collaborator_id', collaboratorId!)
          .neq('status', 'declined'),
      ]);
      if (ownRes.error) throw ownRes.error;
      if (partsRes.error) throw partsRes.error;

      const map = new Map<string, unknown>();
      const fromTs = params.from.getTime();
      const toTs = params.to.getTime();

      for (const e of ownRes.data ?? []) {
        map.set((e as any).id, e);
      }
      for (const row of (partsRes.data ?? []) as Array<{ event: any }>) {
        const e = row.event;
        if (!e || map.has(e.id)) continue;
        const t = new Date(e.start_at).getTime();
        if (t < fromTs || t > toTs) continue;
        map.set(e.id, e);
      }
      return [...map.values()].sort((a: any, b: any) =>
        String(a.start_at).localeCompare(String(b.start_at))
      );
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
