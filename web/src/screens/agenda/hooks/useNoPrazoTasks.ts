import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase, supabaseConfigured } from '../../../lib/supabase';
import { useAuth } from '../../../contexts/AuthContext';
import { useMyGroupIds } from '../../../hooks/useWorkGroups';
import { filterNoPrazo } from '../../../lib/agendaSemPrazo';
import type { TaskForPanel } from './useAgendaTasks';

// NOPRAZO-TASK-INVISIBLE-PWA — fonte ISOLADA de tarefas SEM prazo pro desktop (DayPanel).
// useAgendaTasks busca por RANGE de due_date e exclui due_date null; aqui buscamos só as sem-prazo,
// SEM tocar naquele hook (zero-regressão no painel datado). due_date E scheduled_date null pra não
// duplicar com tarefas que já plotam no dia agendado. Mapeamento = espelho do mapper do useAgendaTasks.
export function useNoPrazoTasks(): TaskForPanel[] {
  const { collaborator } = useAuth();
  const collaboratorId = collaborator?.id;
  const myGroupIds = useMyGroupIds();
  const groupIds = myGroupIds.data ?? [];

  const { data } = useQuery({
    queryKey: ['agenda-noprazo', collaboratorId, groupIds.join(',')],
    enabled: Boolean(collaboratorId && supabaseConfigured),
    queryFn: async () => {
      const vis = [`assigned_to.eq.${collaboratorId}`, `created_by.eq.${collaboratorId}`];
      if (groupIds.length > 0) vis.push(`assigned_group_id.in.(${groupIds.join(',')})`);
      const { data, error } = await supabase
        .from('tasks')
        .select('id, title, description, context, status, scheduled_date, due_date, due_time, assigned_to, created_by, eisenhower_quadrant, remind_at, source, created_at, recurrence_rule, recurrence_parent_id, project_id, parent_task_id, is_group, assigned_group_id, work_group:work_groups!tasks_assigned_group_id_fkey(name), creator:collaborators!tasks_created_by_fkey(preferred_name, full_name)')
        .or(vis.join(','))
        .is('due_date', null)
        .is('scheduled_date', null)
        .is('parent_task_id', null)
        .eq('is_group', false)
        .eq('data_classification', 'real')
        .neq('status', 'done')
        .neq('status', 'cancelled');
      if (error) throw error;
      return data ?? [];
    },
  });

  return useMemo<TaskForPanel[]>(() => {
    if (!data || !collaboratorId) return [];
    const mapped: TaskForPanel[] = (data as any[]).map((t) => {
      const isDelegated = t.created_by === collaboratorId && !!t.assigned_to && t.assigned_to !== collaboratorId;
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
        is_recurring: Boolean(t.recurrence_rule || t.recurrence_parent_id),
        due_time: t.due_time ?? null,
        recurrence_rule: t.recurrence_rule ?? null,
        recurrence_parent_id: t.recurrence_parent_id ?? null,
        project_id: t.project_id ?? null,
        parent_task_id: t.parent_task_id ?? null,
        assigned_group_id: t.assigned_group_id ?? null,
        work_group_name: t.work_group?.name ?? null,
        created_by: t.created_by ?? null,
        assigned_to: t.assigned_to ?? null,
        creator_name: t.creator?.preferred_name ?? t.creator?.full_name ?? null,
      };
    });
    return filterNoPrazo(mapped); // predicate único + ordenação; context aplicado no AgendaDesktop
  }, [data, collaboratorId]);
}
