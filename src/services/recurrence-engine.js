// src/services/recurrence-engine.js — Sprint 29.4
//
// Por que existe: tasks/events com recurrence_rule (template) precisam ter
// próximas ocorrências materializadas (rows reais) pra entrar em listas,
// briefings e notificações. Materialização preguiçosa: gera até 30 dias
// à frente. Idempotente — skip se instância pro mesmo timestamp já existe.
//
// Modelo:
//   TEMPLATE: row com recurrence_rule set + recurrence_parent_id null
//   INSTÂNCIA: row com recurrence_parent_id apontando pra template + recurrence_rule null
//   NÃO-RECORRENTE: ambos null (comportamento original do schema)
//
// Edit "só essa": update na instância (template intacto)
// Edit "toda série": update no template → próximo materializeAll cria com novos defaults
// Pular ocorrência única: recurrence_excluded=true na instância

const { RRule, rrulestr } = require('rrule');
const supabase = require('../supabase/client');
const { shiftReminderToInstance } = require('./recurrence-time');
const { childDueDateForCycle } = require('./task-group-dates');
const { shouldMaterializeTemplate } = require('./recurrence-guard');

const MATERIALIZE_HORIZON_DAYS = 30;
const MAX_INSTANCES_PER_RUN = 50;
const BRT_OFFSET_MS = -3 * 60 * 60 * 1000; // America/Sao_Paulo padrão (sem DST atual)

/**
 * Parse RRULE string. Aceita formato "FREQ=WEEKLY;BYDAY=MO" (sem DTSTART)
 * porque o DTSTART é injetado a partir da data do template.
 * Lança erro se RRULE inválida.
 */
function parseRule(rruleStr, dtstart) {
  if (!rruleStr || typeof rruleStr !== 'string') throw new Error('rrule_required');
  const cleaned = rruleStr.trim().replace(/^RRULE:/i, '');
  if (!/^FREQ=/i.test(cleaned)) throw new Error('rrule_must_start_with_FREQ');
  const dt = dtstart instanceof Date ? dtstart : new Date(dtstart);
  if (isNaN(dt.getTime())) throw new Error('invalid_dtstart');
  // RRule.js aceita objeto literal de opções OU string completa com DTSTART.
  // Pra controlar TZ, monto via objeto.
  try {
    return rrulestr(`DTSTART:${_toIcalUTC(dt)}\nRRULE:${cleaned}`);
  } catch (e) {
    throw new Error(`invalid_rrule: ${e.message.slice(0, 100)}`);
  }
}

function _toIcalUTC(date) {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

/**
 * Próximas N ocorrências entre [from, until].
 */
function nextOccurrences(rruleStr, dtstart, from, until, limit = 50) {
  const rule = parseRule(rruleStr, dtstart);
  return rule.between(from, until, true).slice(0, limit);
}

/**
 * Materializa instâncias futuras de UMA série.
 * Idempotente: skip ocorrência se já existe instância no mesmo dia.
 * @param {'tasks'|'events'} table
 * @param {Object} template
 * @returns {Promise<{created:number, skipped:number, error?:string}>}
 */
async function materializeSeries(table, template) {
  if (!template?.recurrence_rule) return { created: 0, skipped: 0 };
  if (table !== 'tasks' && table !== 'events') return { created: 0, skipped: 0, error: 'bad_table' };
  // CHOKEPOINT (RECUR-RESURRECT-CALLER-GUARD, caso Gabi/equipe 24/06): molde fechado NÃO
  // materializa, venha de onde vier (cron, engine ao criar/mexer, grupo, revive). Antes o
  // guard estava só no materializeAll → as outras portas recriavam do molde done/cancelled
  // ("apago e volta"). Revive não quebra: reviveSeries reativa o molde p/ 'pending' ANTES.
  if (!shouldMaterializeTemplate(template)) return { created: 0, skipped: 0, reason: 'closed_template' };

  const dtstart = table === 'tasks'
    ? new Date(String(template.due_date) + 'T12:00:00-03:00')
    : new Date(template.start_at);
  if (isNaN(dtstart.getTime())) {
    return { created: 0, skipped: 0, error: 'invalid_template_dtstart' };
  }

  const now = new Date();
  const horizon = new Date(now.getTime() + MATERIALIZE_HORIZON_DAYS * 86400000);

  let occurrences;
  try {
    occurrences = nextOccurrences(template.recurrence_rule, dtstart, now, horizon, MAX_INSTANCES_PER_RUN);
  } catch (e) {
    console.error(`[recurrence] parse err series=${template.id}:`, e.message);
    return { created: 0, skipped: 0, error: e.message };
  }
  if (occurrences.length === 0) return { created: 0, skipped: 0 };

  // Dedupe: skip se instância já existe pro mesmo dia
  const tsCol = table === 'tasks' ? 'due_date' : 'start_at';
  const { data: existing } = await supabase
    .from(table)
    .select(`id, ${tsCol}`)
    .eq('recurrence_parent_id', template.id);

  const existingDays = new Set();
  for (const row of existing || []) {
    const ts = row[tsCol];
    const dayKey = typeof ts === 'string' ? ts.slice(0, 10) : new Date(ts).toISOString().slice(0, 10);
    existingDays.add(dayKey);
  }
  // RECUR-TEMPLATE-DUP (caso Conciliação/Rose 10/06): o dia do PRÓPRIO template já
  // está coberto por ele — sem semear aqui, nextOccurrences materializa um filho na
  // MESMA data do pai (template criado à noite → dup no briefing do dia seguinte).
  {
    const tplTs = template[tsCol];
    if (tplTs) {
      const tplKey = typeof tplTs === 'string' ? tplTs.slice(0, 10) : new Date(tplTs).toISOString().slice(0, 10);
      existingDays.add(tplKey);
    }
  }

  const toInsert = [];
  let skipped = 0;
  for (const occ of occurrences) {
    const dayKey = occ.toISOString().slice(0, 10);
    if (existingDays.has(dayKey)) { skipped++; continue; }
    toInsert.push(_cloneTemplate(table, template, occ));
  }

  if (toInsert.length === 0) return { created: 0, skipped };

  // Insere e retorna IDs + anchor (due_date/start_at) pra clonar reminders depois
  const anchorCol = table === 'tasks' ? 'due_date' : 'start_at';
  const { data: inserted, error } = await supabase
    .from(table)
    .insert(toInsert)
    .select(`id, ${anchorCol}`);
  if (error) {
    console.error(`[recurrence] insert err series=${template.id}:`, error.message);
    return { created: 0, skipped, error: error.message };
  }

  // Sprint 23 — copia task_reminders / event_reminders (múltiplos) por instância,
  // preservando o delta entre cada remind_at e o anchor do template.
  // Idempotência: a função busca reminders existentes na instância e só insere os faltantes.
  if (inserted && inserted.length > 0) {
    await _cloneRemindersForInstances(table, template, inserted).catch((e) =>
      console.error(`[recurrence] _cloneReminders unhandled:`, e.message)
    );
  }

  // Grupos (2026-06-09): mãe-template com is_group materializa a ÁRVORE —
  // pra cada mãe-instância criada, clona as filhas-template preservando o
  // dia-do-mês de cada filha no mês do ciclo. Idempotente.
  if (table === 'tasks' && template.is_group && inserted && inserted.length > 0) {
    await _materializeGroupChildren(template, inserted).catch((e) =>
      console.error(`[recurrence] groupChildren unhandled series=${template.id}:`, e.message)
    );
  }

  return { created: (inserted || toInsert).length, skipped };
}

/**
 * Sprint 23 — Copia task_reminders/event_reminders do template pra cada
 * instância recém-criada, ajustando delta de tempo em relação ao anchor.
 *
 * @param {'tasks'|'events'} table
 * @param {Object} template — row do template (tem id, due_date|start_at, etc)
 * @param {Array<{id:string, due_date?:string, start_at?:string}>} instances
 */
async function _cloneRemindersForInstances(table, template, instances) {
  const reminderTable = table === 'tasks' ? 'task_reminders' : 'event_reminders';
  const fkColumn = table === 'tasks' ? 'task_id' : 'event_id';

  // 1. Busca os reminders do template (inclui label pra preservar "1h antes" etc)
  const { data: templateReminders, error: rErr } = await supabase
    .from(reminderTable)
    .select('remind_at, label')
    .eq(fkColumn, template.id);
  if (rErr) {
    console.error(`[recurrence] reminders query err table=${reminderTable}:`, rErr.message);
    return;
  }
  if (!templateReminders || templateReminders.length === 0) return;

  // Idempotência REAL (review 09/06): busca reminders já existentes nas instâncias
  // e pula os pares (instância, remind_at) presentes — re-execução não duplica e
  // instância que ficou sem reminders (insert falhou) é completada na próxima rodada.
  const instIds = instances.map((i) => i.id);
  const { data: existingRows } = await supabase
    .from(reminderTable)
    .select(`${fkColumn}, remind_at`)
    .in(fkColumn, instIds);
  const existingPairs = new Set(
    (existingRows || []).map((r) => `${r[fkColumn]}:${new Date(r.remind_at).toISOString()}`)
  );

  // 2. Anchor do template (00:00 BRT pra tasks; start_at pra events)
  const tplAnchor = table === 'tasks'
    ? new Date(String(template.due_date) + 'T00:00:00-03:00')
    : new Date(template.start_at);
  if (isNaN(tplAnchor.getTime())) return;

  // 3. Pra cada instância, calcula novos remind_at preservando delta
  const toInsert = [];
  for (const inst of instances) {
    const instAnchor = table === 'tasks'
      ? new Date(String(inst.due_date) + 'T00:00:00-03:00')
      : new Date(inst.start_at);
    if (isNaN(instAnchor.getTime())) continue;

    for (const tr of templateReminders) {
      const tmplRemind = new Date(tr.remind_at);
      if (isNaN(tmplRemind.getTime())) continue;
      const delta = tmplRemind.getTime() - tplAnchor.getTime();
      const newRemind = new Date(instAnchor.getTime() + delta).toISOString();
      if (existingPairs.has(`${inst.id}:${newRemind}`)) continue;
      toInsert.push({ [fkColumn]: inst.id, remind_at: newRemind, label: tr.label || null });
    }
  }

  if (toInsert.length === 0) return;

  const { error: insErr } = await supabase.from(reminderTable).insert(toInsert);
  if (insErr) {
    console.error(`[recurrence] reminders insert err table=${reminderTable}:`, insErr.message);
  } else {
    console.log(`[recurrence] cloned ${toInsert.length} reminders for ${instances.length} instances (series=${template.id})`);
  }
}

/**
 * Grupos: clona as filhas-template pra cada mãe-instância recém-criada.
 * Filha-instância: parent_task_id = mãe-instância; recurrence_parent_id = filha-template;
 * due_date = dia-do-mês da filha no mês do ciclo (clamp); reminders com delta.
 * Idempotência: pula se já existe instância da filha-template apontando pra mãe-instância.
 *
 * @param {Object} motherTemplate — template da mãe (is_group=true)
 * @param {Array<{id:string, due_date:string}>} motherInstances — mães recém-inseridas
 */
async function _materializeGroupChildren(motherTemplate, motherInstances) {
  const { data: childTemplates, error: ctErr } = await supabase
    .from('tasks')
    .select('*')
    .eq('parent_task_id', motherTemplate.id)
    .order('sort_position', { ascending: true, nullsFirst: false });
  if (ctErr) {
    console.error(`[recurrence] childTemplates query err:`, ctErr.message);
    return;
  }
  if (!childTemplates || childTemplates.length === 0) return;

  // Idempotência: instâncias existentes das filhas-template → set de "tplId:motherId"
  const tplIds = childTemplates.map((c) => c.id);
  const { data: existingKids } = await supabase
    .from('tasks')
    .select('id, due_date, recurrence_parent_id, parent_task_id')
    .in('recurrence_parent_id', tplIds)
    .not('parent_task_id', 'is', null);
  const existingByKey = new Map(
    (existingKids || []).map((k) => [`${k.recurrence_parent_id}:${k.parent_task_id}`, k])
  );

  for (const mother of motherInstances) {
    for (const childTpl of childTemplates) {
      const existingKid = existingByKey.get(`${childTpl.id}:${mother.id}`);
      if (existingKid) {
        // Filha já existe — só garante os reminders (idempotente após FIX 1).
        await _cloneRemindersForInstances('tasks', childTpl, [existingKid]).catch((e) =>
          console.error(`[recurrence] child reminders (ensure) err:`, e.message)
        );
        continue;
      }
      const row = buildGroupChildRow(childTpl, mother);
      const { data: insertedKid, error: insErr } = await supabase
        .from('tasks')
        .insert(row)
        .select('id, due_date')
        .single();
      if (insErr) {
        console.error(`[recurrence] child insert err tpl=${String(childTpl.id).slice(0, 8)}:`, insErr.message);
        continue;
      }
      // Lembretes da filha: mesmo mecanismo de delta do motor.
      await _cloneRemindersForInstances('tasks', childTpl, [insertedKid]).catch((e) =>
        console.error(`[recurrence] child reminders err:`, e.message)
      );
    }
  }
  console.log(`[recurrence] group children materialized series=${motherTemplate.id} mothers=${motherInstances.length} childTpls=${childTemplates.length}`);
}

/**
 * Row da filha-instância (PURA — testável). Usa _cloneTemplate com a data do ciclo
 * e corrige os ponteiros: parent → mãe-instância (não a mãe-template).
 */
function buildGroupChildRow(childTemplate, motherInstance) {
  const childDueYmd = childDueDateForCycle(String(childTemplate.due_date), String(motherInstance.due_date));
  const occ = new Date(childDueYmd + 'T12:00:00-03:00');
  const row = _cloneTemplate('tasks', childTemplate, occ);
  row.parent_task_id = motherInstance.id;        // filha pendura na mãe-INSTÂNCIA
  row.recurrence_parent_id = childTemplate.id;   // instância-de (idempotência/série)
  row.is_group = false;
  return row;
}

/**
 * Constrói row de instância a partir da template. Ajusta data + zera campos
 * de identidade/status que devem ser independentes.
 */
function _cloneTemplate(table, template, occurrenceDate) {
  const row = { ...template };

  // Remove campos que NÃO devem ser copiados
  delete row.id;
  delete row.created_at;
  delete row.updated_at;
  delete row.completed_at;
  delete row.completed_by;
  delete row.remind_sent_at;
  delete row.followup_sent_at;
  delete row.reminded_at;
  delete row.delegated_at;
  // FATIA 2: series_ended_at é do MOLDE (ciclo de vida da série). Instância NUNCA herda —
  // senão um clone de série encerrada nasceria já "encerrado" e poluiria queries do ciclo.
  delete row.series_ended_at;

  // Marca como INSTÂNCIA (não template)
  row.recurrence_rule = null;
  row.recurrence_parent_id = template.id;
  row.recurrence_excluded = false;

  // Reseta estado operacional pra cada instância nova
  row.status = table === 'tasks' ? 'pending' : 'scheduled';
  if ('staleness_check_sent_at' in template) row.staleness_check_sent_at = null;
  if ('coordination_request_count' in template) row.coordination_request_count = 0;

  if (table === 'tasks') {
    // due_date = data da ocorrência (YYYY-MM-DD)
    row.due_date = occurrenceDate.toISOString().slice(0, 10);
    // remind_at: preserva HH:MM do template, ajusta pra nova data
    if (template.remind_at) {
      const tmpl = new Date(template.remind_at);
      const newRemind = new Date(occurrenceDate);
      newRemind.setUTCHours(tmpl.getUTCHours(), tmpl.getUTCMinutes(), 0, 0);
      row.remind_at = newRemind.toISOString();
    }
    if (template.scheduled_date) row.scheduled_date = occurrenceDate.toISOString().slice(0, 10);
  } else {
    // events: desloca start_at/end_at mantendo HH:MM e duração
    const tmplStart = new Date(template.start_at);
    const tmplEnd = template.end_at ? new Date(template.end_at) : null;
    const durationMs = tmplEnd ? (tmplEnd.getTime() - tmplStart.getTime()) : 3600000;
    const newStart = new Date(occurrenceDate);
    newStart.setUTCHours(tmplStart.getUTCHours(), tmplStart.getUTCMinutes(), 0, 0);
    row.start_at = newStart.toISOString();
    row.end_at = new Date(newStart.getTime() + durationMs).toISOString();
    // remind_at também desloca
    if (template.remind_at) {
      const tmplRemind = new Date(template.remind_at);
      const deltaFromStart = tmplRemind.getTime() - tmplStart.getTime();
      row.remind_at = new Date(newStart.getTime() + deltaFromStart).toISOString();
    }
  }

  return row;
}

/**
 * Materializa TODAS as séries ativas. Chamado pelo dispatcher diariamente 00:30 BRT.
 * Idempotente — pode rodar várias vezes sem efeito colateral.
 */
async function materializeAll() {
  const totals = { tasks_created: 0, events_created: 0, series_processed: 0, errors: 0 };
  for (const table of ['tasks', 'events']) {
    const { data: templates, error } = await supabase
      .from(table)
      .select('*')
      .not('recurrence_rule', 'is', null)
      .is('recurrence_parent_id', null)
      .eq('data_classification', 'real')
      // FATIA 2 (24/06 — flip do ciclo de vida): gera só SÉRIE ATIVA (series_ended_at IS NULL),
      // não mais por status da ocorrência. Concluir a 1ª ocorrência (status=done) NÃO congela
      // a série. "Encerrar série" (scope:'series'/endSeries) seta series_ended_at → para aqui.
      // MANTÉM recurrence_rule IS NOT NULL + data_classification (gate: se a regra cair, tarefa
      // não-recorrente vazaria).
      .is('series_ended_at', null)
      .limit(500);
    if (error) {
      console.error(`[recurrence] templates query err table=${table}:`, error.message);
      continue;
    }
    for (const tpl of templates || []) {
      try {
        const r = await materializeSeries(table, tpl);
        if (r.error) totals.errors++;
        if (table === 'tasks') totals.tasks_created += r.created;
        else totals.events_created += r.created;
        totals.series_processed++;
      } catch (e) {
        console.error(`[recurrence] series=${tpl.id} unhandled:`, e.message);
        totals.errors++;
      }
    }
  }
  console.log(`[recurrence] materializeAll done: ${JSON.stringify(totals)}`);
  return totals;
}

/**
 * FATIA 2 — Encerrar a SÉRIE 1:1 (a pedido: "para de me lembrar / encerra isso").
 * Extraído do bloco inline do engine (engine.js scope:'series') p/ ser testável e
 * acoplado ao flip: setar series_ended_at é o que de fato PARA a série pós-flip
 * (antes era o status='cancelled', que o guard novo ignora).
 *
 * Faz 3 escritas, owner-scoped:
 *  1) series_ended_at = now() no MOLDE (lifecycle) — idempotente (só se ainda null),
 *     INDEPENDENTE do status (uma ocorrência concluída [done] também pode ser encerrada).
 *  2) cancela a ocorrência-molde SE ainda aberta (preserva done = histórico).
 *  3) cancela TODAS as instâncias não-done (passado + futuro).
 *
 * FATIA 3: cancela TUDO não-done (uniformizado com o grupo endSeries), não só futuras.
 * "para de me lembrar / não preciso mais" deve matar o overdue passado também — senão
 * o atraso vira nag fantasma de uma série já encerrada. Cancel é soft (reversível via revive).
 *
 * @param {{supabase:Object, templateId:string, ownerId:string}} args
 * @returns {Promise<{ended:boolean, templateId:string, cancelled:number}>}
 */
async function endSeries1on1({ supabase, templateId, ownerId }) {
  const nowIso = new Date().toISOString();
  // 1) lifecycle: encerra a série (idempotente; qualquer status da ocorrência)
  await supabase.from('tasks')
    .update({ series_ended_at: nowIso })
    .eq('id', templateId).eq('assigned_to', ownerId).is('series_ended_at', null);
  // 2) cancela a ocorrência-molde se ainda aberta (não mexe em done)
  const rTpl = await supabase.from('tasks')
    .update({ status: 'cancelled' })
    .eq('id', templateId).eq('assigned_to', ownerId)
    .not('status', 'in', '("done","cancelled")').select('id');
  // 3) cancela TODAS as instâncias não-done (passado + futuro)
  const rKids = await supabase.from('tasks')
    .update({ status: 'cancelled' })
    .eq('recurrence_parent_id', templateId).eq('assigned_to', ownerId)
    .not('status', 'in', '("done","cancelled")').select('id');
  const cancelled = (rTpl.data ? rTpl.data.length : 0) + (rKids.data ? rKids.data.length : 0);
  return { ended: true, templateId, cancelled };
}

module.exports = { parseRule, nextOccurrences, materializeSeries, materializeAll, endSeries1on1, shiftReminderToInstance, buildGroupChildRow };
