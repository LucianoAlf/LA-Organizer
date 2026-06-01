import { supabase } from './supabase';
import { todaySP } from '../utils/date';
import { planSeriesEdit, type SeriesEditScope } from './planSeriesEdit';
import { materializeSeriesClient } from './materialize-recurrence';

export interface AnchorTask {
  id: string;
  recurrence_parent_id: string | null;
  due_date: string;
}
export type TaskPatch = Partial<{
  title: string; due_time: string | null; priority: string | null;
  context: string; eisenhower_quadrant: string | null; description: string | null;
}>;
export interface EditSeriesResult { ok: boolean; error?: string; }

export async function editTaskSeries(
  anchor: AnchorTask,
  scope: SeriesEditScope,
  patch: TaskPatch,
  newRule: string | null | undefined,
  reminderTimes?: string[],
): Promise<EditSeriesResult> {
  const todayYmd = todaySP();
  const plan = planSeriesEdit({ anchor, scope, newRule, todayYmd });
  const hasPatch = Object.keys(patch).length > 0;

  try {
    if (plan.scopeOnlyThis) {
      if (hasPatch) {
        const { error } = await supabase.from('tasks')
          .update({ ...patch, recurrence_excluded: true }).eq('id', anchor.id);
        if (error) throw error;
      }
      if (reminderTimes) await replaceReminders(anchor.id, anchor.due_date, reminderTimes);
      return { ok: true };
    }

    const ids = await futurePendingIds(plan.seriesId, plan.applyFutureFromYmd as string);
    if (hasPatch && ids.length) {
      const { error } = await supabase.from('tasks').update(patch).in('id', ids);
      if (error) throw error;
    }
    if (reminderTimes && ids.length) {
      for (const id of ids) {
        const due = await dueOf(id);
        await replaceReminders(id, due, reminderTimes);
      }
    }
    if (newRule !== undefined) {
      const cancelIds = await futurePendingIds(plan.seriesId, addDay(todayYmd));
      if (cancelIds.length) {
        const { error } = await supabase.from('tasks')
          .update({ status: 'cancelled' }).in('id', cancelIds);
        if (error) throw error;
      }
      const { error: upErr } = await supabase.from('tasks')
        .update({ recurrence_rule: newRule }).eq('id', plan.seriesId);
      if (upErr) throw upErr;
      if (plan.rematerialize && newRule) {
        const { data: tpl } = await supabase.from('tasks')
          .select('id, recurrence_rule, due_date').eq('id', plan.seriesId).single();
        if (tpl) await materializeSeriesClient('tasks', tpl as { id: string; recurrence_rule: string; due_date: string });
      }
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

async function futurePendingIds(seriesId: string, fromYmd: string): Promise<string[]> {
  const { data } = await supabase.from('tasks')
    .select('id')
    .or(`id.eq.${seriesId},recurrence_parent_id.eq.${seriesId}`)
    .eq('status', 'pending')
    .gte('due_date', fromYmd);
  return (data ?? []).map((r) => (r as { id: string }).id);
}
async function dueOf(id: string): Promise<string> {
  const { data } = await supabase.from('tasks').select('due_date').eq('id', id).single();
  return String((data as { due_date: string } | null)?.due_date ?? todaySP());
}
async function replaceReminders(taskId: string, dueYmd: string, times: string[]): Promise<void> {
  await supabase.from('task_reminders').delete().eq('task_id', taskId).is('sent_at', null);
  const rows = times.map((hhmm) => ({
    task_id: taskId,
    remind_at: `${dueYmd}T${hhmm}:00-03:00`,
    label: hhmm.replace(':00', 'h'),
  }));
  if (rows.length) await supabase.from('task_reminders').insert(rows);
}
function addDay(ymd: string): string {
  const d = new Date(`${ymd}T12:00:00-03:00`); d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}
