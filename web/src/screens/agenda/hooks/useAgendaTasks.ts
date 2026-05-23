import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase, supabaseConfigured } from '../../../lib/supabase';
import { useAuth } from '../../../contexts/AuthContext';
import type { AgendaFilters } from './useAgendaFilters';

export interface TaskForPanel {
  id: string;
  title: string;
  context: 'work' | 'personal';
  status: 'pending' | 'in_progress' | 'done' | 'overdue' | 'delegated';
  scheduled_date: string | null;
  due_date: string | null;
  delegated_to: string | null;
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
        .select('id, title, context, status, scheduled_date, due_date, assigned_to, created_by')
        .or(`assigned_to.eq.${collaboratorId},and(created_by.eq.${collaboratorId},assigned_to.neq.${collaboratorId})`)
        .neq('status', 'cancelled')
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
        context: t.context,
        status: t.status,
        scheduled_date: t.scheduled_date,
        due_date: t.due_date,
        delegated_to: isDelegated ? t.assigned_to : null,
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
