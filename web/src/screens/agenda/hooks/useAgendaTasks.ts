import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase, supabaseConfigured } from '../../../lib/supabase';
import { useAuth } from '../../../contexts/AuthContext';
import type { AgendaFilters } from './useAgendaFilters';

export interface TaskForPanel {
  id: string;
  title: string;
  description?: string | null;
  context: 'work' | 'personal';
  status: 'pending' | 'in_progress' | 'done' | 'overdue' | 'delegated';
  scheduled_date: string | null;
  due_date: string | null;
  delegated_to: string | null;
  eisenhower_quadrant?: number | null;
  remind_at?: string | null;
  source?: string | null;
  created_at?: string | null;
}

// Sprint Agenda Desktop — tasks no range [from,to]. Espelha padrão de
// screens/Semana.tsx: assigned_to=eu OU (created_by=eu E assigned_to!=eu)
// para incluir delegadas. Range aplicado em due_date.
// `delegated_to` virtual: derivado de assigned_to quando created_by=collab e
// assigned_to!=collab (não existe coluna delegated_to no schema atual).
export function useAgendaTasks(params: { from: Date; to: Date; filters: AgendaFilters }) {
  const { collaborator } = useAuth();
  const collaboratorId = collaborator?.id;
  const fromYmd = params.from.toISOString().slice(0, 10);
  const toYmd = params.to.toISOString().slice(0, 10);

  const { data, isLoading, error } = useQuery({
    queryKey: ['agenda-tasks', collaboratorId, fromYmd, toYmd],
    enabled: Boolean(collaboratorId && supabaseConfigured),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('tasks')
        .select('id, title, description, context, status, scheduled_date, due_date, assigned_to, created_by, eisenhower_quadrant, remind_at, source, created_at, recurrence_rule, recurrence_parent_id')
        .or(`assigned_to.eq.${collaboratorId},and(created_by.eq.${collaboratorId},assigned_to.neq.${collaboratorId})`)
        .neq('status', 'cancelled')
        // Sprint 29.1 — esconde teste/arquivado
        .eq('data_classification', 'real')
        // Sprint 29.4 — esconde TEMPLATES recorrentes (mostra só instâncias + não-recorrentes)
        .or('recurrence_rule.is.null,recurrence_parent_id.not.is.null')
        .gte('due_date', fromYmd)
        .lte('due_date', toYmd)
        .order('due_date', { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
  });

  const tasks = useMemo<TaskForPanel[]>(() => {
    if (!data || !collaboratorId) return [];
    const mapped: TaskForPanel[] = (data as any[]).map(t => {
      const isDelegated = t.created_by === collaboratorId && t.assigned_to !== collaboratorId;
      return {
        id: t.id,
        title: t.title,
        description: t.description ?? null,
        context: t.context,
        status: t.status,
        scheduled_date: t.scheduled_date,
        due_date: t.due_date,
        delegated_to: isDelegated ? t.assigned_to : null,
        eisenhower_quadrant: t.eisenhower_quadrant ?? null,
        remind_at: t.remind_at ?? null,
        source: t.source ?? null,
        created_at: t.created_at ?? null,
      };
    });
    return mapped.filter(t => {
      if (t.delegated_to) return params.filters.delegadas;
      if (t.context === 'work') return params.filters.trabalho;
      if (t.context === 'personal') return params.filters.pessoal;
      return true;
    });
  }, [data, collaboratorId, params.filters]);

  return { tasks, isLoading, error };
}
