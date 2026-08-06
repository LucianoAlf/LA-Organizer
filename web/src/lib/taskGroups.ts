// web/src/lib/taskGroups.ts
// Grupos de tarefas: criação (template + ciclo corrente), fetch das listas,
// cascata de conclusão e edição estrutural com escopo. Client-side, RLS atual.
import { supabase } from './supabase';
import { todaySP } from '../utils/date';
import { dayOfMonthToYmd, childDueDateForCycle, cycleLabel, withMonthDayAnchor } from './taskGroupDates';
import { materializeSeriesClient } from './materialize-recurrence';
import type { Task } from '../types';

export interface GroupChildInput {
  title: string;
  /** Grupo mensal: dia do mês (1-31). Sem repetição: YMD completo (due). */
  dayOfMonth?: number | null;
  due_date?: string | null;
  due_time?: string | null;        // HH:MM
  reminderTimes?: string[];        // datetime-local "YYYY-MM-DDTHH:MM" (RemindersField)
}

export interface CreateGroupInput {
  title: string;
  context: 'work' | 'personal';
  monthly: boolean;                 // v1: Mensal ou Não repete
  groupDueDay?: number | null;      // mensal: dia do prazo do grupo (opcional)
  groupDueDate?: string | null;     // sem repetição: prazo YMD (opcional)
  children: GroupChildInput[];
  collabId: string;
  /** Grupo de TRABALHO como dono (pool, 2026-06-10): mãe+filhas nascem com
   *  assigned_to NULL + assigned_group_id (CHECK tasks_exactly_one_owner). */
  assignedGroupId?: string | null;
}

const GROUP_SELECT =
  'id, title, status, context, due_date, due_time, is_group, parent_task_id, ' +
  'recurrence_rule, recurrence_parent_id, sort_position, assigned_to, created_by, completed_at, created_at, ' +
  'assigned_group_id, work_group:work_groups!tasks_assigned_group_id_fkey(name), ' +
  'subtasks:tasks!parent_task_id(id, title, status, due_date, due_time, sort_position, ' +
  'parent_task_id, recurrence_parent_id, assigned_to, created_by, completed_at, ' +
  'task_reminders(remind_at, sent_at))';

async function insertTask(row: Record<string, unknown>): Promise<{ id: string }> {
  const { data, error } = await supabase.from('tasks').insert(row).select('id').single();
  if (error) throw error;
  return data as { id: string };
}

async function insertReminders(taskId: string, localTimes: string[] | undefined): Promise<void> {
  if (!localTimes || localTimes.length === 0) return;
  const rows = localTimes.map((t) => ({ task_id: taskId, remind_at: `${t}:00-03:00` }));
  const { error } = await supabase.from('task_reminders').insert(rows);
  if (error) console.warn('[taskGroups] reminders insert err:', error.message);
}

/**
 * Cria o grupo. Mensal: cria TEMPLATE (mãe is_group + RRULE BYMONTHDAY=<âncora> + filhas)
 * e a INSTÂNCIA do ciclo corrente na hora (a Rose cria dia 9 e usa o ciclo de junho já);
 * materializeSeriesClient cuida dos próximos (dedupe por dia evita duplicar).
 * Sem repetição: cria mãe+filhas direto (sem template).
 */
export async function createGroup(input: CreateGroupInput): Promise<{ groupId: string }> {
  const today = todaySP();
  const gid = input.assignedGroupId ?? null;
  const base = {
    context: gid ? ('work' as const) : input.context,
    status: 'pending' as const,
    priority: 'medium' as const,
    source: 'manual' as const,
    assigned_to: gid ? null : input.collabId,
    assigned_group_id: gid,
    created_by: input.collabId,
  };

  if (!input.monthly) {
    // ——— grupo simples (sem recorrência) ———
    const mother = await insertTask({
      ...base, title: input.title.trim().slice(0, 200), is_group: true,
      due_date: input.groupDueDate ?? null,
    });
    let pos = 1;
    for (const c of input.children) {
      const kid = await insertTask({
        ...base, title: c.title.trim().slice(0, 200), parent_task_id: mother.id,
        due_date: c.due_date ?? null, due_time: c.due_time || null, sort_position: pos++,
      });
      await insertReminders(kid.id, c.reminderTimes);
    }
    return { groupId: mother.id };
  }

  // ——— grupo MENSAL: template + ciclo corrente ———
  const anchorDay = input.groupDueDay ?? 1;
  const tplDue = dayOfMonthToYmd(anchorDay, today);
  const motherTpl = await insertTask({
    ...base, title: input.title.trim().slice(0, 200), is_group: true,
    due_date: tplDue, recurrence_rule: `FREQ=MONTHLY;BYMONTHDAY=${anchorDay}`,
  });
  let pos = 1;
  const childTpls: Array<{ id: string; due: string; input: GroupChildInput }> = [];
  for (const c of input.children) {
    const due = dayOfMonthToYmd(c.dayOfMonth ?? 1, today);
    const kid = await insertTask({
      ...base, title: c.title.trim().slice(0, 200), parent_task_id: motherTpl.id,
      due_date: due, due_time: c.due_time || null, sort_position: pos++,
    });
    await insertReminders(kid.id, c.reminderTimes);
    childTpls.push({ id: kid.id, due, input: c });
  }

  // Instância do CICLO CORRENTE (explícita — o motor só olha ocorrências futuras).
  const motherInst = await insertTask({
    ...base, title: input.title.trim().slice(0, 200), is_group: true,
    due_date: tplDue, recurrence_parent_id: motherTpl.id,
  });
  let pos2 = 1;
  for (const ct of childTpls) {
    const kid = await insertTask({
      ...base, title: ct.input.title.trim().slice(0, 200), parent_task_id: motherInst.id,
      due_date: childDueDateForCycle(ct.due, tplDue), due_time: ct.input.due_time || null,
      sort_position: pos2++, recurrence_parent_id: ct.id,
    });
    await insertReminders(kid.id, ct.input.reminderTimes);
  }

  // Próximos ciclos (idempotente — o dedupe por dia pula o ciclo corrente já criado).
  const { data: tplFull } = await supabase.from('tasks').select('*').eq('id', motherTpl.id).single();
  if (tplFull) {
    const r = await materializeSeriesClient('tasks', tplFull as { id: string; recurrence_rule: string });
    if (r.error) console.warn('[taskGroups] materialize err:', r.error);
  }
  return { groupId: motherInst.id };
}

/**
 * Grupos relevantes pras listas do dia: mães-INSTÂNCIA (ou sem recorrência) do colaborador
 * com filhas embutidas. Relevante = tem filha com due<=dia não concluída, OU filha
 * concluída no dia, OU mãe com due no dia. Filtragem final em JS (volume é baixo).
 * Nota: .neq().neq() usado em vez de .not('status','in',...) — padrão seguro no supabase-js do projeto.
 */
export async function fetchGroupsForDay(collabId: string, ymd: string, workGroupIds: string[] = []): Promise<Task[]> {
  // Pool (2026-06-10): grupo atribuído a um grupo de TRABALHO tem assigned_to NULL —
  // visível pra qualquer membro (assigned_group_id) e pro criador (created_by).
  const vis = [`assigned_to.eq.${collabId}`, `created_by.eq.${collabId}`];
  if (workGroupIds.length > 0) vis.push(`assigned_group_id.in.(${workGroupIds.join(',')})`);
  const { data, error } = await supabase
    .from('tasks')
    .select(GROUP_SELECT)
    .or(vis.join(','))
    .eq('is_group', true)
    .is('recurrence_rule', null)          // esconde mãe-TEMPLATE
    .neq('status', 'cancelled')
    .eq('data_classification', 'real');
  if (error) throw error;
  const groups = ((data ?? []) as unknown as Task[]).map((g) => ({
    ...g,
    subtasks: [...(g.subtasks ?? [])].sort(
      (a, b) => (a.sort_position ?? 0) - (b.sort_position ?? 0)
    ),
  }));
  return groups.filter((g) => {
    const kids = g.subtasks ?? [];
    const kidRelevant = kids.some((k) =>
      (k.status !== 'done' && k.status !== 'cancelled' && k.due_date && k.due_date <= ymd) ||
      (k.status === 'done' && (k.completed_at ?? '').slice(0, 10) === ymd)
    );
    // Ciclo do MÊS corrente (ou atrasado de meses anteriores) fica visível o mês todo;
    // ciclos futuros já materializados (ex.: julho criado em junho) ficam fora.
    // (E2E 10/06: o critério "criada hoje" vazava o ciclo de julho → card duplicado.)
    const motherActiveCycle = g.status !== 'done' && g.due_date != null
      && g.due_date.slice(0, 7) <= ymd.slice(0, 7);
    // Grupo simples SEM prazo recém-criado aparece no dia da criação ("cadê meu grupo?").
    const motherCreatedToday = g.status !== 'done' && g.due_date == null
      && (g.created_at ?? '').slice(0, 10) === ymd;
    const motherDoneToday = g.status === 'done' && (g.completed_at ?? '').slice(0, 10) === ymd;
    return kidRelevant || motherActiveCycle || motherCreatedToday || motherDoneToday;
  });
}

/** Grupo individual (detalhe/gestão): mãe-instância ou simples, com filhas. */
export async function fetchGroup(groupId: string): Promise<Task | null> {
  const { data, error } = await supabase.from('tasks').select(GROUP_SELECT).eq('id', groupId).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const g = data as unknown as Task;
  g.subtasks = [...(g.subtasks ?? [])].sort((a, b) => (a.sort_position ?? 0) - (b.sort_position ?? 0));
  return g;
}

/** Toggle de FILHA com cascata: última aberta concluída → mãe conclui; reabrir → mãe reabre. */
export async function toggleChildWithCascade(child: Task, done: boolean): Promise<{ groupCompleted: boolean }> {
  const patch = done
    ? { status: 'done', completed_at: new Date().toISOString() }
    : { status: 'pending', completed_at: null };
  const { error } = await supabase.from('tasks').update(patch).eq('id', child.id);
  if (error) throw error;
  if (!child.parent_task_id) return { groupCompleted: false };

  // Re-checa contagem no servidor (idempotente sob corrida PWA×WhatsApp).
  const { data: siblings } = await supabase
    .from('tasks').select('id, status')
    .eq('parent_task_id', child.parent_task_id).neq('status', 'cancelled');
  const open = (siblings ?? []).filter((s) => s.status !== 'done').length;

  if (done && open === 0) {
    await supabase.from('tasks')
      .update({ status: 'done', completed_at: new Date().toISOString() })
      .eq('id', child.parent_task_id).neq('status', 'done');
    return { groupCompleted: true };
  }
  if (!done) {
    await supabase.from('tasks')
      .update({ status: 'pending', completed_at: null })
      .eq('id', child.parent_task_id).eq('status', 'done');
  }
  return { groupCompleted: false };
}

/** Conclui a mãe fechando as N filhas abertas (chamado após ConfirmDialog na UI). */
export async function completeGroupCascade(groupId: string): Promise<void> {
  const now = new Date().toISOString();
  // Usa neq encadeado (padrão seguro do projeto) em vez de .not(...'in'...)
  const { error: e1 } = await supabase.from('tasks')
    .update({ status: 'done', completed_at: now })
    .eq('parent_task_id', groupId)
    .neq('status', 'done')
    .neq('status', 'cancelled');
  if (e1) throw e1;
  const { error: e2 } = await supabase.from('tasks')
    .update({ status: 'done', completed_at: now }).eq('id', groupId);
  if (e2) throw e2;
}

/** Adiciona subtarefa à INSTÂNCIA; escopo 'future' também adiciona ao template. */
export async function addSubtask(
  group: Task, title: string, dayOfMonth: number | null, scope: 'only_this' | 'this_and_future',
): Promise<void> {
  const kids = group.subtasks ?? [];
  const nextPos = kids.length ? Math.max(...kids.map((k) => k.sort_position ?? 0)) + 1 : 1;
  const due = dayOfMonth && group.due_date ? dayOfMonthToYmd(dayOfMonth, group.due_date) : null;
  // Grupo-pool (2026-06-10): assigned_to é NULL — filha nova herda o grupo de
  // trabalho da mãe e o created_by cai pro criador da mãe.
  const groupWorkId = (group as unknown as { assigned_group_id?: string | null }).assigned_group_id ?? null;
  const base = {
    title: title.trim().slice(0, 200), context: group.context, status: 'pending',
    priority: 'medium', source: 'manual',
    assigned_to: group.assigned_to, assigned_group_id: groupWorkId,
    created_by: group.assigned_to ?? (group as unknown as { created_by?: string | null }).created_by ?? null,
  };
  let tplChildId: string | null = null;
  if (scope === 'this_and_future' && group.recurrence_parent_id) {
    const { data: tplMother } = await supabase.from('tasks')
      .select('id, due_date').eq('id', group.recurrence_parent_id).single();
    if (tplMother) {
      const tplDue = dayOfMonth ? dayOfMonthToYmd(dayOfMonth, String(tplMother.due_date)) : null;
      const tplKid = await insertTask({ ...base, parent_task_id: tplMother.id, due_date: tplDue, sort_position: nextPos });
      tplChildId = tplKid.id;
    }
  }
  await insertTask({
    ...base, parent_task_id: group.id, due_date: due, sort_position: nextPos,
    recurrence_parent_id: tplChildId,
  });
}

/** Remove subtarefa da instância; escopo 'future' remove o template-filho (cascata futura). */
export async function removeSubtask(child: Task, scope: 'only_this' | 'this_and_future'): Promise<void> {
  const { error } = await supabase.from('tasks').delete().eq('id', child.id);
  if (error) throw error;
  if (scope === 'this_and_future' && child.recurrence_parent_id) {
    await supabase.from('tasks').delete().eq('id', child.recurrence_parent_id);
  }
}

/** Reordena filhas (DnD) — bulk update de sort_position. */
export async function reorderSubtasks(ordered: Array<{ id: string; sort_position: number }>): Promise<void> {
  await Promise.all(ordered.map((o) =>
    supabase.from('tasks').update({ sort_position: o.sort_position }).eq('id', o.id)
  ));
}

/** Renomeia o grupo (instância); escopo 'this_and_future' renomeia o template também. */
export async function renameGroup(group: Task, newTitle: string, scope: 'only_this' | 'this_and_future'): Promise<void> {
  const title = newTitle.trim().slice(0, 200);
  if (!title) return;
  const { error } = await supabase.from('tasks').update({ title }).eq('id', group.id);
  if (error) throw error;
  if (scope === 'this_and_future' && group.recurrence_parent_id) {
    await supabase.from('tasks').update({ title }).eq('id', group.recurrence_parent_id);
  }
}

/**
 * Edita o PRAZO do grupo (pedido Rose 05/08: não havia onde clicar depois de criado).
 *
 * `due_date` é coluna da MÃE-container — não é agregado das filhas. Então salvar
 * altera 1 registro: a mãe. **As filhas NÃO são tocadas** — cada uma tem prazo
 * próprio (dia do mês configurado na criação) e se edita pelo EditTaskSheet dela.
 *
 * 'this_and_future' (só recorrente) reancora a série: template (due_date +
 * BYMONTHDAY da RRULE) e as instâncias FUTURAS já materializadas, cada uma no
 * próprio mês. Sem isso o próximo ciclo renasceria no dia velho.
 */
export async function setGroupDueDate(
  group: Task, newDue: string | null, scope: 'only_this' | 'this_and_future',
): Promise<void> {
  const prevDue = group.due_date ?? null;
  const { error } = await supabase.from('tasks').update({ due_date: newDue }).eq('id', group.id);
  if (error) throw error;
  if (scope !== 'this_and_future' || !group.recurrence_parent_id || !newDue) return;

  const day = Number(newDue.slice(8, 10));
  const { data: tpl } = await supabase.from('tasks')
    .select('id, due_date, recurrence_rule').eq('id', group.recurrence_parent_id).single();
  if (!tpl) return;
  const patch: Record<string, unknown> = {};
  if (tpl.due_date) patch.due_date = dayOfMonthToYmd(day, String(tpl.due_date));
  const rule = withMonthDayAnchor(tpl.recurrence_rule as string | null, day);
  if (rule) patch.recurrence_rule = rule;
  if (Object.keys(patch).length) {
    await supabase.from('tasks').update(patch).eq('id', group.recurrence_parent_id);
  }

  // Ciclos futuros JÁ materializados: reancora cada um no próprio mês (o dia muda,
  // o mês do ciclo não). Atrasados/passados ficam como estão.
  const { data: futureInstances } = await supabase
    .from('tasks').select('id, due_date')
    .eq('recurrence_parent_id', group.recurrence_parent_id)
    .neq('id', group.id)
    .neq('status', 'done')
    .gt('due_date', prevDue ?? newDue);
  for (const inst of futureInstances ?? []) {
    if (!inst.due_date) continue;
    await supabase.from('tasks')
      .update({ due_date: dayOfMonthToYmd(day, String(inst.due_date)) }).eq('id', inst.id);
  }
}

/**
 * Apaga o grupo. 'only_this' = só a instância (cascade remove filhas).
 * 'this_and_future' = também o template (cascade remove filhas-template) e as
 * instâncias FUTURAS não concluídas da série.
 */
export async function deleteGroup(group: Task, scope: 'only_this' | 'this_and_future'): Promise<void> {
  if (scope === 'this_and_future' && group.recurrence_parent_id) {
    // Instâncias futuras não concluídas da série (exceto a corrente, apagada abaixo).
    const { data: futureInstances } = await supabase
      .from('tasks').select('id, status')
      .eq('recurrence_parent_id', group.recurrence_parent_id)
      .neq('id', group.id)
      .neq('status', 'done');
    for (const inst of futureInstances ?? []) {
      await supabase.from('tasks').delete().eq('id', inst.id);
    }
    await supabase.from('tasks').delete().eq('id', group.recurrence_parent_id); // template (cascade filhas-template)
  }
  const { error } = await supabase.from('tasks').delete().eq('id', group.id); // instância corrente (cascade filhas)
  if (error) throw error;
}

export { cycleLabel };
