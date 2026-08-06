// web/src/hooks/useGroupWorkspace.ts
// Dados do workspace (spec 2026-06-10). Zero migration — RLS tasks_group_member_all
// (membro: ALL) + leituras de gestão já cobrem. FK explícita nos embeds (tasks tem
// 5 FKs pra collaborators → sem nome dá PGRST200).
import { useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { todaySP } from '../utils/date';
import { bucketizeGroupTasks, collapseOpenSeries, computeGroupStats, groupCountsFromRows, packageInMonth, type PoolTask } from '../lib/groupWorkspace';
import type { Task } from '../types';

const POOL_SELECT =
  'id, title, description, status, due_date, due_time, completed_at, created_by, ' +
  // Recorrência (2026-07-02): campos pro colapso de série. A regra do PAI (badge de
  // cadência) vem por 2ª query batelada no fetchPool — NUNCA por embed self-join:
  // hint por constraint dá PGRST200 (schema cache não resolve a self-FK → HTTP 400,
  // pool inteiro caía: caso Rose 06/07) e hint por coluna resolve pro lado ERRADO
  // (filhas, array). GROUPPOOL-SELFJOIN-EMBED-400.
  'recurrence_parent_id, recurrence_rule, ' +
  'creator:collaborators!tasks_created_by_fkey(full_name), ' +
  'done_by:collaborators!tasks_completed_by_fkey(full_name), ' +
  'task_reminders(id, remind_at, sent_at)';

export interface PoolTaskRow extends PoolTask {
  task_reminders?: Array<{ id: string; remind_at: string; sent_at: string | null }>;
}

function monthStartUtcIso(todayYmd: string): string {
  return `${todayYmd.slice(0, 7)}-01T03:00:00.000Z`; // 00:00 BRT do dia 1
}

async function fetchPool(groupId: string, todayYmd: string): Promise<PoolTaskRow[]> {
  const { data, error } = await supabase
    .from('tasks')
    .select(POOL_SELECT)
    .eq('assigned_group_id', groupId)
    .eq('is_group', false)
    .is('parent_task_id', null)
    .neq('status', 'cancelled')
    .eq('data_classification', 'real')
    .or(`status.neq.done,and(status.eq.done,completed_at.gte.${monthStartUtcIso(todayYmd)})`)
    .order('due_date', { ascending: true });
  if (error) throw error;
  const rows = (data ?? []) as any[];
  // Regra da série pro badge: busca batelada dos templates-pai (ver nota no POOL_SELECT).
  // Se a RLS esconder algum pai, o badge daquela série só não aparece — nada quebra.
  const parentIds = [...new Set(rows.map(r => r.recurrence_parent_id).filter(Boolean))] as string[];
  const ruleById = new Map<string, string | null>();
  if (parentIds.length > 0) {
    const { data: parents } = await supabase
      .from('tasks')
      .select('id, recurrence_rule')
      .in('id', parentIds);
    for (const p of (parents ?? []) as Array<{ id: string; recurrence_rule: string | null }>) {
      ruleById.set(p.id, p.recurrence_rule);
    }
  }
  return rows.map(r => ({
    ...r,
    creator_name: r.creator?.full_name ?? null,
    completed_by_name: r.done_by?.full_name ?? null,
    // Regra resolvida (própria do template ou do pai) pra rotular a cadência no badge.
    series_rule: r.recurrence_rule ?? (r.recurrence_parent_id ? ruleById.get(r.recurrence_parent_id) ?? null : null),
  }));
}

// Pacotes: mães is_group do grupo com filhas — espelha o GROUP_SELECT de lib/taskGroups.
const PKG_SELECT =
  'id, title, status, context, due_date, due_time, is_group, recurrence_rule, recurrence_parent_id, ' +
  'sort_position, assigned_to, assigned_group_id, created_by, completed_at, created_at, ' +
  'subtasks:tasks!parent_task_id(id, title, status, due_date, due_time, sort_position, parent_task_id, recurrence_parent_id, completed_at, ' +
  'done_by:collaborators!tasks_completed_by_fkey(full_name))';

async function fetchPackages(groupId: string, todayYmd: string): Promise<Task[]> {
  const { data, error } = await supabase
    .from('tasks')
    .select(PKG_SELECT)
    .eq('assigned_group_id', groupId)
    .eq('is_group', true)
    .is('recurrence_rule', null) // esconde mãe-TEMPLATE (instância representa o ciclo)
    .neq('status', 'cancelled')
    .eq('data_classification', 'real');
  if (error) throw error;
  const ym = todayYmd.slice(0, 7);
  return ((data ?? []) as unknown as Task[])
    .filter(m => packageInMonth({ status: m.status, due_date: m.due_date }, ym))
    .map(m => ({ ...m, subtasks: [...(m.subtasks ?? [])].sort((a, b) => (a.sort_position ?? 0) - (b.sort_position ?? 0)) }));
}

export function useGroupWorkspace(groupId: string | undefined, collabId: string | undefined) {
  const qc = useQueryClient();
  const today = todaySP();

  const pool = useQuery({
    queryKey: ['group-workspace', groupId, today],
    enabled: Boolean(groupId),
    staleTime: 30_000,
    queryFn: () => fetchPool(groupId!, today),
  });
  const packages = useQuery({
    queryKey: ['group-workspace-pkgs', groupId, today],
    enabled: Boolean(groupId),
    staleTime: 30_000,
    queryFn: () => fetchPackages(groupId!, today),
  });

  // Recorrência (2026-07-02): colapsa cada série numa linha ANTES de bucketizar e
  // contar — senão uma tarefa diária de grupo (30 instâncias) infla abertas
  // e entope o pool (caso Vitória/ADM CG). Só as ABERTAS colapsam: colapsar as
  // concluídas apagava "Feitas no mês" (ver collapseOpenSeries — caso Rose 05/08).
  const collapsed = useMemo(() => collapseOpenSeries(pool.data ?? [], today), [pool.data, today]);
  const buckets = useMemo(() => bucketizeGroupTasks(collapsed, today), [collapsed, today]);
  // Stats: pool + PACOTES do painel do mês (contados pelas filhas). Regra única em
  // lib/groupWorkspace — a lista /grupos usa a MESMA, senão as telas se contradizem.
  const stats = useMemo(
    () => computeGroupStats(pool.data ?? [], packages.data ?? [], today, monthStartUtcIso(today)),
    [pool.data, packages.data, today],
  );

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['group-workspace'] });
    qc.invalidateQueries({ queryKey: ['group-workspace-pkgs'] });
    qc.invalidateQueries({ queryKey: ['groups-overview'] });
    qc.invalidateQueries({ queryKey: ['tasks'] });
    qc.invalidateQueries({ queryKey: ['task-groups'] });
  };

  // Concluir com ANTI-CORRIDA (padrão do engine): 0 rows = outra pessoa fechou antes.
  const toggleDone = useMutation({
    mutationFn: async ({ task, done }: { task: PoolTaskRow; done: boolean }) => {
      if (done) {
        const { data, error } = await supabase.from('tasks')
          .update({ status: 'done', completed_at: new Date().toISOString(), completed_by: collabId ?? null })
          .eq('id', task.id).neq('status', 'done').select('id');
        if (error) throw error;
        if (!data || data.length === 0) throw new Error('JA_CONCLUIDA');
      } else {
        const { error } = await supabase.from('tasks')
          .update({ status: 'pending', completed_at: null, completed_by: null })
          .eq('id', task.id).eq('status', 'done');
        if (error) throw error;
      }
    },
    onSettled: invalidate,
  });

  // Salvar edição: prazo mudou → reminded_at=null (re-arma T-1 do grupo) +
  // task_reminders: remove não-enviados e insere os novos.
  const saveTask = useMutation({
    mutationFn: async (input: { id: string; title: string; description: string | null; due_date: string | null; due_time: string | null; reminderIsos: string[]; dueChanged: boolean }) => {
      const patch: Record<string, unknown> = {
        title: input.title.trim().slice(0, 200),
        description: input.description?.trim() || null,
        due_date: input.due_date, due_time: input.due_time,
      };
      if (input.dueChanged) patch.reminded_at = null;
      const { data, error } = await supabase.from('tasks').update(patch).eq('id', input.id).select('id');
      if (error) throw error;
      if (!data || data.length === 0) throw new Error('SEM_PERMISSAO'); // RLS barrou (não-membro) — nunca falhar mudo
      // Lembretes: só mexe se o prazo mudou (âncora velha não vale mais) ou se o
      // usuário escolheu chips novos — editar só o título NUNCA apaga os agendados.
      if (input.dueChanged || input.reminderIsos.length > 0) {
        const { error: de } = await supabase.from('task_reminders').delete().eq('task_id', input.id).is('sent_at', null);
        if (de) throw de;
        const futureIsos = input.reminderIsos.filter(r => r > new Date().toISOString());
        if (futureIsos.length > 0) {
          const { error: ie } = await supabase.from('task_reminders')
            .insert(futureIsos.map(r => ({ task_id: input.id, remind_at: r })));
          if (ie) throw ie;
        }
      }
    },
    onSuccess: invalidate,
  });

  const cancelTask = useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await supabase.from('tasks').update({ status: 'cancelled' }).eq('id', id).select('id');
      if (error) throw error;
      if (!data || data.length === 0) throw new Error('SEM_PERMISSAO');
    },
    onSuccess: invalidate,
  });

  return { pool, packages, buckets, stats, toggleDone, saveTask, cancelTask, invalidate };
}

// Lista /grupos: counts por grupo (1 query leve agregada em JS).
export interface GroupCounts { abertas: number; atrasadas: number; venceEmBreve: number; feitasNoMes: number; totalMes: number; }

type OverviewRow = {
  id: string; assigned_group_id: string; status: string;
  due_date: string | null; completed_at: string | null;
  is_group?: boolean; parent_task_id?: string | null;
  recurrence_parent_id?: string | null; recurrence_rule?: string | null;
};

export function useGroupsOverview(groupIds: string[]) {
  const today = todaySP();
  return useQuery({
    queryKey: ['groups-overview', [...groupIds].sort().join(','), today],
    enabled: groupIds.length > 0,
    queryFn: async (): Promise<Record<string, GroupCounts>> => {
      // Traz pool + mães de pacote + filhas (antes filtrava is_group/parent no SQL e
      // os pacotes ficavam invisíveis nos badges). O recorte por tipo é feito em JS
      // pra rodar EXATAMENTE a mesma regra do workspace.
      const { data, error } = await supabase
        .from('tasks')
        .select('id, assigned_group_id, status, due_date, completed_at, is_group, parent_task_id, recurrence_parent_id, recurrence_rule')
        .in('assigned_group_id', groupIds)
        .neq('status', 'cancelled')
        .eq('data_classification', 'real');
      if (error) throw error;
      const counts = groupCountsFromRows((data ?? []) as OverviewRow[], groupIds, today, monthStartUtcIso(today));
      const out: Record<string, GroupCounts> = {};
      for (const gid of groupIds) {
        const s = counts[gid];
        out[gid] = { ...s, totalMes: s.feitasNoMes + s.abertas };
      }
      return out;
    },
  });
}
