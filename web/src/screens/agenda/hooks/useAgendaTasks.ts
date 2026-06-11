import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase, supabaseConfigured } from '../../../lib/supabase';
import { useAuth } from '../../../contexts/AuthContext';
import { useMyGroupIds } from '../../../hooks/useWorkGroups';
import { fetchGroupsForDay } from '../../../lib/taskGroups';
import type { AgendaFilters } from './useAgendaFilters';
import { localYmd } from '../../../utils/date';

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
  /** Filha de grupo de tarefas (aparece flat na Semana/Mês; no Dia entra via GroupRow). */
  parent_task_id?: string | null;
  // Grupos de TRABALHO — pool por equipe (2026-06-10)
  assigned_group_id?: string | null;
  work_group_name?: string | null;
}

// Sprint Agenda Desktop — tasks no range [from,to]. Espelha padrão de
// screens/Semana.tsx: assigned_to=eu OU (created_by=eu E assigned_to!=eu)
// para incluir delegadas. Range aplicado em due_date.
// `delegated_to` virtual: derivado de assigned_to quando created_by=collab e
// assigned_to!=collab (não existe coluna delegated_to no schema atual).
export function useAgendaTasks(params: { from: Date; to: Date; filters: AgendaFilters }) {
  const { collaborator } = useAuth();
  const collaboratorId = collaborator?.id;
  // localYmd: from/to são Date locais (endOfDay 23:59 BRT virava dia+1 em UTC).
  const fromYmd = localYmd(params.from);
  const toYmd = localYmd(params.to);

  // Pool dos grupos de trabalho (2026-06-10): tarefa de grupo tem assigned_to NULL,
  // então a cláusula antiga assigned_to.neq nunca casava — membro não via o pool.
  const myGroupIds = useMyGroupIds();
  const groupIds = myGroupIds.data ?? [];

  const { data, isLoading, error } = useQuery({
    queryKey: ['agenda-tasks', collaboratorId, fromYmd, toYmd, groupIds.join(',')],
    enabled: Boolean(collaboratorId && supabaseConfigured),
    queryFn: async () => {
      // Visibilidade: minhas + criadas por mim (delegadas e tarefas de grupo que criei)
      // + pool dos MEUS grupos de trabalho.
      const vis = [`assigned_to.eq.${collaboratorId}`, `created_by.eq.${collaboratorId}`];
      if (groupIds.length > 0) vis.push(`assigned_group_id.in.(${groupIds.join(',')})`);
      // Grupos de tarefas (2026-06-09): mães (is_group) ficam fora da lista solta (entram
      // pelo GroupRow via hook de grupos); FILHAS entram flat — Semana/Mês não tinham
      // como mostrá-las (caso Rose 10/06). Filha de mãe-TEMPLATE recorrente sai no filtro
      // JS (2ª query leve traz os ids das mães-template; self-embed M:1 por constraint dá
      // PGRST200 no PostgREST e por coluna resolve pros FILHOS — validado 10/06).
      const [{ data, error }, { data: tplMothers }] = await Promise.all([
        supabase
          .from('tasks')
          .select('id, title, description, context, status, scheduled_date, due_date, due_time, assigned_to, created_by, eisenhower_quadrant, remind_at, source, created_at, recurrence_rule, recurrence_parent_id, project_id, parent_task_id, is_group, assigned_group_id, work_group:work_groups!tasks_assigned_group_id_fkey(name)')
          .or(vis.join(','))
          .neq('status', 'cancelled')
          // Sprint 29.1 — esconde teste/arquivado
          .eq('data_classification', 'real')
          // (2026-06-10) Sprint 29.4 escondia TEMPLATES recorrentes; pós RECUR-TEMPLATE-DUP
          // o template É a própria 1ª ocorrência (não nasce filho no dia dele) — escondê-lo
          // sumia com a tarefa do desktop (caso Rose/Conciliação). Template volta a aparecer.
          .eq('is_group', false)
          .gte('due_date', fromYmd)
          .lte('due_date', toYmd)
          .order('due_date', { ascending: true }),
        supabase.from('tasks').select('id').eq('is_group', true).not('recurrence_rule', 'is', null),
      ]);
      if (error) throw error;
      return { rows: data ?? [], tplMotherIds: ((tplMothers ?? []) as Array<{ id: string }>).map(r => r.id) };
    },
  });

  const tasks = useMemo<TaskForPanel[]>(() => {
    if (!data || !collaboratorId) return [];
    const tplMotherIds = new Set(data.tplMotherIds);
    const mapped: TaskForPanel[] = (data.rows as any[])
      // Filha de mãe-TEMPLATE de grupo recorrente é estrutura, não ocorrência — fica fora.
      .filter(t => !(t.parent_task_id && tplMotherIds.has(t.parent_task_id)))
      .map(t => {
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
    queryKey: ['task-groups', collaboratorId, fromYmd, groupIds.join(',')],
    enabled: Boolean(collaboratorId && supabaseConfigured),
    queryFn: () => fetchGroupsForDay(collaboratorId!, fromYmd, groupIds),
  });

  const groups = useMemo<TaskForPanel[]>(() => {
    if (!groupsData) return [];
    // Converte Task[] (do taskGroups) em TaskForPanel[] para o DayPanel
    return (groupsData as Array<{
      id: string; title: string; context: 'work' | 'personal'; status: string;
      due_date: string | null; due_time: string | null; scheduled_date?: string | null;
      recurrence_rule?: string | null; recurrence_parent_id?: string | null;
      assigned_group_id?: string | null; work_group?: { name: string } | null;
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
      assigned_group_id: g.assigned_group_id ?? null,
      work_group_name: g.work_group?.name ?? null,
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
