import { supabase } from './supabase';
import type { Task } from '../types';
import { clausulasVisibilidade } from './visibilidadeTarefas';

// Mesmo select de fetchTasksToday (Hoje.tsx) — os sheets precisam de todos os campos.
const DAY_TASK_SELECT = 'id, title, description, status, context, priority, category, action_type, source, due_date, due_time, scheduled_date, remind_at, eisenhower_quadrant, sort_position, project_id, assigned_to, assigned_group_id, created_by, completed_at, recurrence_rule, recurrence_parent_id, parent_task_id, is_group, projects(name, category), assignee:collaborators!tasks_assigned_to_fkey(full_name), creator:collaborators!tasks_created_by_fkey(preferred_name, full_name), work_group:work_groups!tasks_assigned_group_id_fkey(name), task_reminders(remind_at, sent_at)';

/** Tarefas com due_date == ymd, visíveis ao colaborador (minhas / criadas por mim / pool
 *  dos meus grupos). Objetos Task completos. Espelha a visibilidade de useAgendaTasks. */
export async function fetchTasksForDay(collabId: string, ymd: string, groupIds: string[] = []): Promise<Task[]> {
  // AUTOR-CONTINUA-VENDO-O-POOL-DO-GRUPO-QUE-DEIXOU (09/09): a regra das tres pernas mora
  // em visibilidadeTarefas.ts. Nao remonte a clausula aqui — eram CINCO copias, e a que
  // divergir volta a mostrar o pool de um grupo pra quem saiu dele.
  const vis = clausulasVisibilidade(collabId, groupIds);
  const { data, error } = await supabase
    .from('tasks')
    .select(DAY_TASK_SELECT)
    .or(vis.join(','))
    .neq('status', 'cancelled')
    .eq('data_classification', 'real')
    .is('parent_task_id', null)
    .eq('is_group', false)
    .eq('due_date', ymd)
    .order('due_time', { ascending: true, nullsFirst: false })
    .order('eisenhower_quadrant', { ascending: true, nullsFirst: false });
  if (error) throw error;
  return (data ?? []) as unknown as Task[];
}
