// Sprint 29.4 — Materialização client-side de séries recorrentes.
//
// O backend tem src/services/recurrence-engine.js que roda 1x/dia. Mas quando
// user cria via PWA, queremos materialização IMEDIATA pras instâncias
// aparecerem na agenda na hora — não esperar até 00:30 BRT.
//
// Esta função espelha materializeSeries do backend mas usa supabase-js do
// browser. Idempotente: skip se instância pro mesmo dia já existe.

import { rrulestr } from 'rrule';
import { supabase } from './supabase';
import { childDueDateForCycle } from './taskGroupDates';

const HORIZON_DAYS = 30;
const MAX_INSTANCES = 50;

interface Template {
  id: string;
  recurrence_rule: string;
  [k: string]: unknown;
}

export interface MaterializeResult {
  created: number;
  skipped: number;
  error?: string;
}

export async function materializeSeriesClient(
  table: 'tasks' | 'events',
  template: Template
): Promise<MaterializeResult> {
  if (!template?.recurrence_rule || !template?.id) return { created: 0, skipped: 0 };

  // Pega DTSTART baseado no campo de data do template
  const dtstart = table === 'tasks'
    ? new Date(String(template.due_date) + 'T12:00:00-03:00')
    : new Date(String(template.start_at));
  if (isNaN(dtstart.getTime())) return { created: 0, skipped: 0, error: 'invalid_dtstart' };

  const now = new Date();
  const horizon = new Date(now.getTime() + HORIZON_DAYS * 86400000);

  let occurrences: Date[];
  try {
    const dtStr = dtstart.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
    const rule = rrulestr(`DTSTART:${dtStr}\nRRULE:${String(template.recurrence_rule).replace(/^RRULE:/i, '')}`);
    occurrences = rule.between(now, horizon, true).slice(0, MAX_INSTANCES);
  } catch (e) {
    return { created: 0, skipped: 0, error: `parse_failed: ${(e as Error).message}` };
  }
  if (occurrences.length === 0) return { created: 0, skipped: 0 };

  // Dedupe contra instâncias já materializadas
  const tsCol = table === 'tasks' ? 'due_date' : 'start_at';
  const { data: existing } = await supabase
    .from(table)
    .select(`id, ${tsCol}`)
    .eq('recurrence_parent_id', template.id);
  const existingDays = new Set<string>();
  for (const row of (existing ?? []) as Array<Record<string, unknown>>) {
    const ts = row[tsCol];
    const dayKey = typeof ts === 'string' ? ts.slice(0, 10) : new Date(String(ts)).toISOString().slice(0, 10);
    existingDays.add(dayKey);
  }
  // RECUR-TEMPLATE-DUP (caso Conciliação/Rose 10/06): o dia do PRÓPRIO template já está
  // coberto por ele — rule.between(now, horizon, true) inclui a ocorrência do dia do pai
  // quando o template é criado antes do horário do DTSTART (ex.: criado 23:44 pra 12:00
  // do dia seguinte... ou do MESMO dia). Sem isso, nasce um filho duplicado.
  {
    const tplTs = (template as Record<string, unknown>)[tsCol];
    if (tplTs) {
      const tplKey = typeof tplTs === 'string' ? tplTs.slice(0, 10) : new Date(String(tplTs)).toISOString().slice(0, 10);
      existingDays.add(tplKey);
    }
  }

  const toInsert: Array<Record<string, unknown>> = [];
  let skipped = 0;
  for (const occ of occurrences) {
    const dayKey = occ.toISOString().slice(0, 10);
    if (existingDays.has(dayKey)) { skipped++; continue; }
    toInsert.push(cloneTemplate(table, template, occ));
  }

  if (toInsert.length === 0) return { created: 0, skipped };

  const selectCols = table === 'tasks' ? 'id, due_date' : 'id, start_at';
  const { data: inserted, error } = await supabase.from(table).insert(toInsert).select(selectCols);
  if (error) return { created: 0, skipped, error: error.message };

  // Grupos: mãe-template com is_group materializa a árvore (espelho do backend).
  if (table === 'tasks' && (template as Record<string, unknown>).is_group && inserted && inserted.length > 0) {
    await materializeGroupChildrenClient(template, inserted as Array<{ id: string; due_date: string }>);
  }
  return { created: toInsert.length, skipped };
}

// Grupos (2026-06-09) — espelho de _materializeGroupChildren do backend.
// Mantém paridade: idempotência por (recurrence_parent_id filha-template + parent_task_id mãe-instância).
async function materializeGroupChildrenClient(
  motherTemplate: Template,
  motherInstances: Array<{ id: string; due_date: string }>
): Promise<void> {
  const { data: childTemplates } = await supabase
    .from('tasks')
    .select('*')
    .eq('parent_task_id', motherTemplate.id)
    .order('sort_position', { ascending: true, nullsFirst: false });
  if (!childTemplates || childTemplates.length === 0) return;

  const tplIds = childTemplates.map((c: { id: string }) => c.id);
  const { data: existingKids } = await supabase
    .from('tasks')
    .select('recurrence_parent_id, parent_task_id')
    .in('recurrence_parent_id', tplIds)
    .not('parent_task_id', 'is', null);
  const existingKeys = new Set(
    ((existingKids ?? []) as Array<{ recurrence_parent_id: string; parent_task_id: string }>)
      .map((k) => `${k.recurrence_parent_id}:${k.parent_task_id}`)
  );

  for (const mother of motherInstances) {
    for (const childTpl of childTemplates as Array<Record<string, unknown> & { id: string; due_date: string }>) {
      if (existingKeys.has(`${childTpl.id}:${mother.id}`)) continue;
      const childDueYmd = childDueDateForCycle(String(childTpl.due_date), String(mother.due_date));
      const occ = new Date(childDueYmd + 'T12:00:00-03:00');
      const row = cloneTemplate('tasks', childTpl as unknown as Template, occ);
      row.parent_task_id = mother.id;
      row.recurrence_parent_id = childTpl.id;
      row.is_group = false;
      const { data: kid, error: insErr } = await supabase.from('tasks').insert(row).select('id, due_date').single();
      if (insErr || !kid) continue;
      // Lembretes da filha-template → instância (delta a partir do due 00:00 BRT).
      // Idempotência (review 09/06): busca remind_at já existentes do kid e pula os presentes.
      const { data: tplReminders } = await supabase
        .from('task_reminders').select('remind_at, label').eq('task_id', childTpl.id);
      if (tplReminders && tplReminders.length > 0) {
        const { data: kidExisting } = await supabase
          .from('task_reminders').select('remind_at').eq('task_id', kid.id);
        const kidPairs = new Set(
          ((kidExisting ?? []) as Array<{ remind_at: string }>).map(r => new Date(r.remind_at).toISOString())
        );
        const tplAnchor = new Date(String(childTpl.due_date) + 'T00:00:00-03:00').getTime();
        const instAnchor = new Date(String(kid.due_date) + 'T00:00:00-03:00').getTime();
        const rows = tplReminders
          .map((r: { remind_at: string; label: string | null }) => ({
            task_id: kid.id,
            remind_at: new Date(instAnchor + (new Date(r.remind_at).getTime() - tplAnchor)).toISOString(),
            label: r.label ?? null,
          }))
          .filter((r: { remind_at: string }) => !kidPairs.has(r.remind_at));
        if (rows.length > 0) {
          await supabase.from('task_reminders').insert(rows);
        }
      }
    }
  }
}

function cloneTemplate(
  table: 'tasks' | 'events',
  template: Template,
  occurrence: Date
): Record<string, unknown> {
  const row: Record<string, unknown> = { ...template };
  // Remove campos que não devem ser copiados
  delete row.id;
  delete row.created_at;
  delete row.updated_at;
  delete row.completed_at;
  delete row.completed_by;
  delete row.remind_sent_at;
  delete row.followup_sent_at;
  delete row.reminded_at;
  delete row.delegated_at;

  // Instância: aponta pra template, NÃO carrega rrule
  row.recurrence_rule = null;
  row.recurrence_parent_id = template.id;
  row.recurrence_excluded = false;
  row.status = table === 'tasks' ? 'pending' : 'scheduled';
  if ('staleness_check_sent_at' in template) row.staleness_check_sent_at = null;
  if ('coordination_request_count' in template) row.coordination_request_count = 0;

  if (table === 'tasks') {
    row.due_date = occurrence.toISOString().slice(0, 10);
    if (template.remind_at) {
      const tmpl = new Date(String(template.remind_at));
      const newRemind = new Date(occurrence);
      newRemind.setUTCHours(tmpl.getUTCHours(), tmpl.getUTCMinutes(), 0, 0);
      row.remind_at = newRemind.toISOString();
    }
    if (template.scheduled_date) row.scheduled_date = occurrence.toISOString().slice(0, 10);
  } else {
    const tmplStart = new Date(String(template.start_at));
    const tmplEnd = template.end_at ? new Date(String(template.end_at)) : null;
    const durationMs = tmplEnd ? (tmplEnd.getTime() - tmplStart.getTime()) : 3600000;
    const newStart = new Date(occurrence);
    newStart.setUTCHours(tmplStart.getUTCHours(), tmplStart.getUTCMinutes(), 0, 0);
    row.start_at = newStart.toISOString();
    row.end_at = new Date(newStart.getTime() + durationMs).toISOString();
    if (template.remind_at) {
      const tmplRemind = new Date(String(template.remind_at));
      const delta = tmplRemind.getTime() - tmplStart.getTime();
      row.remind_at = new Date(newStart.getTime() + delta).toISOString();
    }
  }
  return row;
}
