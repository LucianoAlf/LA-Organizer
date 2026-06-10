import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase, supabaseConfigured } from '../../../lib/supabase';
import { useAuth } from '../../../contexts/AuthContext';
import { fetchGroupsForDay } from '../../../lib/taskGroups';
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
  // Sprint 30 — true se a tarefa é recorrente (é o template com regra OU uma
  // instância gerada a partir de um template). Usado pra mostrar ícone de repeat.
  is_recurring?: boolean;
  // Sprint 30 — horário-alvo da tarefa (HH:MM ou HH:MM:SS). Null = sem horário.
  due_time?: string | null;
  // Sprint 23 — recorrência: regra do template (se for o próprio template) e id do
  // pai (se for ocorrência materializada). Usados pelo editor de série.
  recurrence_rule?: string | null;
  recurrence_parent_id?: string | null;
  project_id?: string | null;
  // Grupos de tarefas (2026-06-09)
  is_group?: boolean;
  subtasks?: TaskForPanel[];
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
      // Grupos de tarefas (2026-06-09): parent_task_id/is_group no select; filhas e mães
      // ficam fora da lista solta (entram pelo GroupRow via hook de grupos).
      const { data, error } = await supabase
        .from('tasks')
        .select('id, title, description, context, status, scheduled_date, due_date, due_time, assigned_to, created_by, eisenhower_quadrant, remind_at, source, created_at, recurrence_rule, recurrence_parent_id, project_id, parent_task_id, is_group')
        .or(`assigned_to.eq.${collaboratorId},and(created_by.eq.${collaboratorId},assigned_to.neq.${collaboratorId})`)
        .neq('status', 'cancelled')
        // Sprint 29.1 — esconde teste/arquivado
        .eq('data_classification', 'real')
        // Sprint 29.4 — esconde TEMPLATES recorrentes (mostra só instâncias + não-recorrentes)
        .or('recurrence_rule.is.null,recurrence_parent_id.not.is.null')
        // Grupos (2026-06-09): exclui filhas (parent_task_id != null) e mães (is_group=true)
        .is('parent_task_id', null)
        .eq('is_group', false)
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
        is_recurring: Boolean(t.recurrence_rule || t.recurrence_parent_id),
        due_time: t.due_time ?? null,
        recurrence_rule: t.recurrence_rule ?? null,
        recurrence_parent_id: t.recurrence_parent_id ?? null,
        project_id: t.project_id ?? null,
      };
    });
    return mapped.filter(t => {
      if (t.delegated_to) return params.filters.delegadas;
      if (t.context === 'work') return params.filters.trabalho;
      if (t.context === 'personal') return params.filters.pessoal;
      return true;
    });
  }, [data, collaboratorId, params.filters]);

  // Grupos de tarefas (2026-06-09): query separada de grupos relevantes pro dia corrente.
  // O DayPanel mostra grupos do fromYmd (dia selecionado em view=day).
  const { data: groupsData } = useQuery({
    queryKey: ['task-groups', collaboratorId, fromYmd],
    enabled: Boolean(collaboratorId && supabaseConfigured),
    queryFn: () => fetchGroupsForDay(collaboratorId!, fromYmd),
  });

  const groups = useMemo<TaskForPanel[]>(() => {
    if (!groupsData) return [];
    // Converte Task[] (do taskGroups) em TaskForPanel[] para o DayPanel
    return (groupsData as Array<{
      id: string; title: string; context: 'work' | 'personal'; status: string;
      due_date: string | null; due_time: string | null; scheduled_date?: string | null;
      recurrence_rule?: string | null; recurrence_parent_id?: string | null;
      subtasks?: TaskForPanel[];
    }>).map(g => ({
      id: g.id,
      title: g.title,
      context: g.context,
      status: g.status as TaskForPanel['status'],
      scheduled_date: g.scheduled_date ?? null,
      due_date: g.due_date,
      due_time: g.due_time ?? null,
      delegated_to: null,
      is_group: true,
      recurrence_rule: g.recurrence_rule ?? null,
      recurrence_parent_id: g.recurrence_parent_id ?? null,
      subtasks: (g.subtasks ?? []).map(k => ({
        id: k.id,
        title: k.title,
        context: g.context,
        status: k.status as TaskForPanel['status'],
        scheduled_date: null,
        due_date: (k as unknown as { due_date?: string | null }).due_date ?? null,
        due_time: (k as unknown as { due_time?: string | null }).due_time ?? null,
        delegated_to: null,
        is_group: false,
      })),
    }));
  }, [groupsData]);

  return { tasks, isLoading, error, groups };
}
