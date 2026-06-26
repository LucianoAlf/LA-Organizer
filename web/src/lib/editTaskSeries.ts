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
        if (error) throw new Error(`only_this update: ${error.message}`);
      }
      if (reminderTimes) await replaceReminders(anchor.id, anchor.due_date, reminderTimes);
      return { ok: true };
    }

    // this_and_future — alvos: futuras pendentes da série (template + filhas) a
    // partir da data da âncora.
    const ids = await futurePendingIds(plan.seriesId, plan.applyFutureFromYmd as string);
    if (hasPatch && ids.length) {
      const { data: pRows, error } = await supabase.from('tasks').update(patch).in('id', ids).select('id');
      if (error) throw new Error(`future patch update (${ids.length} ids): ${error.message}`);
      if (!pRows || pRows.length === 0) {
        throw new Error(`future patch update afetou 0 de ${ids.length} linhas (RLS bloqueou?)`);
      }
    }
    if (reminderTimes && ids.length) {
      for (const id of ids) {
        const due = await dueOf(id);
        await replaceReminders(id, due, reminderTimes);
      }
    }
    if (newRule !== undefined) {
      // cancela futuras pendentes estritamente após hoje
      const cancelIds = await futurePendingIds(plan.seriesId, addDay(todayYmd));
      if (cancelIds.length) {
        const { error } = await supabase.from('tasks')
          .update({ status: 'cancelled' }).in('id', cancelIds);
        if (error) throw new Error(`cancel futures (${cancelIds.length}): ${error.message}`);
      }
      // Sprint 26 pattern — .select('id') + checagem de linha pra pegar silent
      // fail de RLS (update sem erro mas que afeta 0 linhas).
      // FATIA 3 (ciclo de vida): desligar (newRule===null) ENCERRA a série → series_ended_at=now()
      // (cinto-e-suspensório: o rule=null já para o materializeAll via filtro rule IS NOT NULL,
      // mas o guard passa a concordar). Re-ativar com regra nova LIMPA series_ended_at (volta a gerar).
      const seriesEndedAt = newRule === null ? new Date().toISOString() : null;
      const { data: upRows, error: upErr } = await supabase.from('tasks')
        .update({ recurrence_rule: newRule, series_ended_at: seriesEndedAt }).eq('id', plan.seriesId).select('id');
      if (upErr) throw new Error(`template rule update: ${upErr.message}`);
      if (!upRows || upRows.length === 0) {
        throw new Error(`template rule update afetou 0 linhas (RLS bloqueou? id=${plan.seriesId})`);
      }
      // Sprint 23 — DESLIGAR a série (newRule === null): as ocorrências que
      // sobrevivem (hoje + passado, não-canceladas) viram tarefas AVULSAS.
      // Sem zerar recurrence_parent_id elas continuam "filhas" de um template
      // sem regra, e o card segue mostrando o selo 🔁 (isRecurring = rule ||
      // parent_id) — dando a impressão de que "nada mudou". Causa raiz do bug
      // de 02/06: o backend desligava certo, mas a UI continuava recorrente.
      // 0 linhas aqui é OK (série pode não ter filhas vivas) — não estoura.
      if (newRule === null) {
        const { error: unlinkErr } = await supabase.from('tasks')
          .update({ recurrence_parent_id: null })
          .eq('recurrence_parent_id', plan.seriesId)
          .neq('status', 'cancelled');
        if (unlinkErr) throw new Error(`unlink survivors: ${unlinkErr.message}`);
      }
      if (plan.rematerialize && newRule) {
        const { data: tpl, error: tErr } = await supabase.from('tasks')
          .select('id, recurrence_rule, due_date, series_ended_at').eq('id', plan.seriesId).single();
        if (tErr) throw new Error(`reload template: ${tErr.message}`);
        if (tpl) {
          const r = await materializeSeriesClient('tasks', tpl as { id: string; recurrence_rule: string; due_date: string });
          if (r.error) throw new Error(`rematerialize: ${r.error}`);
        }
      }
    }
    return { ok: true };
  } catch (e) {
    // Sprint 23 — NUNCA falhar em silêncio (bug 01/06: erro engolido fazia o save
    // "dar certo" sem gravar nada). Loga no console e devolve o motivo pra UI.
    console.error('[editTaskSeries] FAIL:', e, { scope, newRule, anchor });
    return { ok: false, error: (e as Error).message };
  }
}

// Futuras pendentes da série (template id=seriesId + filhas parent=seriesId) com
// due_date >= fromYmd. Bug 01/06: usava `.or(id.eq,parent.eq)` que retornava vazio
// silenciosamente → save não gravava nada. Trocado por 2 queries explícitas com
// checagem de erro.
async function futurePendingIds(seriesId: string, fromYmd: string): Promise<string[]> {
  const { data: kids, error: e1 } = await supabase.from('tasks')
    .select('id')
    .eq('recurrence_parent_id', seriesId)
    .eq('status', 'pending')
    .gte('due_date', fromYmd);
  if (e1) throw new Error(`futurePendingIds kids: ${e1.message}`);
  const { data: tpl, error: e2 } = await supabase.from('tasks')
    .select('id')
    .eq('id', seriesId)
    .eq('status', 'pending')
    .gte('due_date', fromYmd);
  if (e2) throw new Error(`futurePendingIds tpl: ${e2.message}`);
  const out: string[] = [];
  for (const r of (kids ?? [])) out.push((r as { id: string }).id);
  for (const r of (tpl ?? [])) out.push((r as { id: string }).id);
  return out;
}

async function dueOf(id: string): Promise<string> {
  const { data, error } = await supabase.from('tasks').select('due_date').eq('id', id).single();
  if (error) throw new Error(`dueOf: ${error.message}`);
  return String((data as { due_date: string } | null)?.due_date ?? todaySP());
}

async function replaceReminders(taskId: string, dueYmd: string, times: string[]): Promise<void> {
  const { error: delErr } = await supabase.from('task_reminders').delete().eq('task_id', taskId).is('sent_at', null);
  if (delErr) throw new Error(`reminders delete: ${delErr.message}`);
  // REMINDER-STALE-PAST (caso Geraldo/Rose 10/06): task retroativa (due no passado)
  // gerava remind_at já vencido que o dispatcher disparava NA HORA, de madrugada.
  // O dispatcher tem guarda própria; aqui evitamos nem criar a linha morta.
  const nowMs = Date.now();
  const rows = times
    .filter((hhmm) => new Date(`${dueYmd}T${hhmm}:00-03:00`).getTime() > nowMs)
    .map((hhmm) => ({
    task_id: taskId,
    remind_at: `${dueYmd}T${hhmm}:00-03:00`,
    label: hhmm.replace(':00', 'h'),
  }));
  if (rows.length) {
    const { error: insErr } = await supabase.from('task_reminders').insert(rows);
    if (insErr) throw new Error(`reminders insert: ${insErr.message}`);
  }
}

function addDay(ymd: string): string {
  const d = new Date(`${ymd}T12:00:00-03:00`); d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}
