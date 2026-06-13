// src/services/task-groups.js
// Cascata de conclusão de grupos no caminho do WhatsApp (paridade com o PWA).
// Chamado APÓS um complete bem-sucedido de task. Best-effort: nunca lança.
//
// Também: MOTOR de criação de pacote/grupo (createTaskGroup/addSubtasksToGroup) —
// porta fiel do web/src/lib/taskGroups.ts createGroup, reusando os helpers de data e o
// materializeSeries do backend. Usado pelo chat de grupo (TOM) e pelo script de reparo.
// supabase + deps injetados nas funções do motor (testável sem DB).
// supabase/client só existe na VPS → require LAZY dentro de maybeCompleteParentGroup
// (que roda na VPS); o motor recebe supabase por parâmetro, então carrega local p/ testes.
const { dayOfMonthToYmd, childDueDateForCycle } = require('./task-group-dates');

/**
 * Se a task concluída é FILHA de grupo e era a última aberta, conclui a mãe.
 * @returns {Promise<{groupCompleted: boolean, groupTitle: string|null}>}
 */
async function maybeCompleteParentGroup(taskId) {
  const supabase = require('../supabase/client');
  try {
    const { data: t } = await supabase
      .from('tasks').select('id, parent_task_id').eq('id', taskId).maybeSingle();
    if (!t || !t.parent_task_id) return { groupCompleted: false, groupTitle: null };

    // Premissa: grupo é single-owner (mãe e filhas do mesmo assigned_to, por construção
    // do createGroup). Service_role bypassa RLS — se grupos cruzarem donos um dia,
    // adicionar guard de assigned_to aqui.
    const { data: siblings } = await supabase
      .from('tasks').select('id, status')
      .eq('parent_task_id', t.parent_task_id).neq('status', 'cancelled');
    const open = (siblings || []).filter((s) => s.status !== 'done').length;
    if (open > 0) return { groupCompleted: false, groupTitle: null };

    const { data: mother } = await supabase
      .from('tasks')
      .update({ status: 'done', completed_at: new Date().toISOString() })
      .eq('id', t.parent_task_id).neq('status', 'done')
      .select('id, title').maybeSingle();
    if (mother) {
      console.log(`[TaskGroups] grupo auto-concluído: ${mother.title} (${String(mother.id).slice(0, 8)})`);
      return { groupCompleted: true, groupTitle: mother.title };
    }
    return { groupCompleted: false, groupTitle: null };
  } catch (e) {
    console.error('[TaskGroups] maybeCompleteParentGroup err:', e.message);
    return { groupCompleted: false, groupTitle: null };
  }
}

// ── MOTOR de criação de pacote ────────────────────────────────────────────────

function todaySP() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
}

// Dia-útil até o group_day (caso "dia N ou sexta anterior").
function weekendAdjustRrule(groupDay) {
  const days = [];
  for (let d = 1; d <= groupDay; d++) days.push(d);
  return `FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYMONTHDAY=${days.join(',')};BYSETPOS=-1`;
}

async function _insert(sb, row) {
  const { data, error } = await sb.from('tasks').insert(row).select('id').single();
  if (error) throw new Error('insert task: ' + error.message);
  return data.id;
}

// Cria um pacote. input: { title, recurrence:'monthly'|null, groupDay, weekendAdjust,
// groupDueDate, subtasks:[{title, day|dueDate, remindAt}] }. supabase + deps injetados.
async function createTaskGroup({ supabase: sb, groupId, createdBy, input, deps }) {
  const materializeSeries = (deps && deps.materializeSeries)
    || require('./recurrence-engine').materializeSeries;
  const today = todaySP();
  const base = {
    assigned_group_id: groupId, assigned_to: null, created_by: createdBy,
    context: 'work', status: 'pending', source: 'manual', priority: 'medium',
    data_classification: 'real',
  };
  const title = String(input.title || '').trim().slice(0, 200);

  // ── grupo simples (sem recorrência) ──
  if (input.recurrence !== 'monthly') {
    const motherId = await _insert(sb, { ...base, title, is_group: true, due_date: input.groupDueDate || null });
    const childIds = [];
    let pos = 1;
    for (const c of input.subtasks || []) {
      const cid = await _insert(sb, {
        ...base, title: String(c.title).trim().slice(0, 200), parent_task_id: motherId,
        due_date: c.dueDate || null, remind_at: c.remindAt || null, sort_position: pos++,
      });
      childIds.push(cid);
    }
    return { groupId: motherId, motherTemplateId: null, childIds };
  }

  // ── grupo MENSAL: template + ciclo corrente + materializa futuros ──
  const anchorDay = input.groupDay || 1;
  const rrule = input.weekendAdjust === 'previous_friday'
    ? weekendAdjustRrule(anchorDay)
    : `FREQ=MONTHLY;BYMONTHDAY=${anchorDay}`;
  const tplDue = dayOfMonthToYmd(anchorDay, today);

  const tplId = await _insert(sb, { ...base, title, is_group: true, due_date: tplDue, recurrence_rule: rrule });

  const childTpls = [];
  let pos = 1;
  for (const c of input.subtasks || []) {
    const due = dayOfMonthToYmd(c.day || anchorDay, today);
    const cid = await _insert(sb, {
      ...base, title: String(c.title).trim().slice(0, 200), parent_task_id: tplId,
      due_date: due, sort_position: pos++,
    });
    childTpls.push({ id: cid, due, c });
  }

  const instId = await _insert(sb, { ...base, title, is_group: true, due_date: tplDue, recurrence_parent_id: tplId });
  let pos2 = 1;
  const childIds = [];
  for (const ct of childTpls) {
    const cid = await _insert(sb, {
      ...base, title: String(ct.c.title).trim().slice(0, 200), parent_task_id: instId,
      due_date: childDueDateForCycle(ct.due, tplDue), remind_at: ct.c.remindAt || null,
      recurrence_parent_id: ct.id, sort_position: pos2++,
    });
    childIds.push(cid);
  }

  // Próximos ciclos (idempotente — dedupe por dia pula o ciclo corrente já criado).
  try {
    const { data: tplFull } = await sb.from('tasks').select('*').eq('id', tplId).single();
    if (tplFull) await materializeSeries('tasks', tplFull);
  } catch (e) { console.warn('[task-groups] materialize:', e.message); }

  return { groupId: instId, motherTemplateId: tplId, childIds };
}

// groupId = id da mãe-INSTÂNCIA visível (ou mãe simples). Insere subtarefas novas.
async function addSubtasksToGroup({ supabase: sb, groupId, subtasks }) {
  const { data: mother } = await sb.from('tasks').select('*').eq('id', groupId).single();
  if (!mother) throw new Error('grupo não encontrado');
  const base = {
    assigned_group_id: mother.assigned_group_id, assigned_to: null, created_by: mother.created_by,
    context: 'work', status: 'pending', source: 'manual', priority: 'medium', data_classification: 'real',
  };
  const added = [];
  const isMonthly = Boolean(mother.recurrence_parent_id); // instância de série
  const tplId = mother.recurrence_parent_id;
  let tplDue = mother.due_date;
  if (isMonthly) {
    const { data: tpl } = await sb.from('tasks').select('*').eq('id', tplId).single();
    if (tpl) tplDue = tpl.due_date;
  }
  for (const c of subtasks || []) {
    const title = String(c.title).trim().slice(0, 200);
    if (!isMonthly) {
      const cid = await _insert(sb, { ...base, title, parent_task_id: groupId, due_date: c.dueDate || null, remind_at: c.remindAt || null });
      added.push(cid);
      continue;
    }
    const tplChildDue = dayOfMonthToYmd(c.day || 1, tplDue);
    const tplChildId = await _insert(sb, { ...base, title, parent_task_id: tplId, due_date: tplChildDue });
    const instChildId = await _insert(sb, {
      ...base, title, parent_task_id: groupId, due_date: childDueDateForCycle(tplChildDue, mother.due_date),
      remind_at: c.remindAt || null, recurrence_parent_id: tplChildId,
    });
    added.push(instChildId);
  }
  return { added };
}

module.exports = { maybeCompleteParentGroup, createTaskGroup, addSubtasksToGroup, weekendAdjustRrule, todaySP };
