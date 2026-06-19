// E2E do snooze_reminders contra o DB real (service_role). RODAR NA VPS:
//   node --env-file=.env scripts/e2e-snooze.js
// Cria tasks+reminders de teste, executa a MESMA sequencia de queries do branch
// applyTaskActions (select pendentes -> planReminderFloor -> update sent_at / insert),
// verifica o resultado e LIMPA tudo (finally). Nao envia WhatsApp.
'use strict';
const assert = require('node:assert/strict');
const { createClient } = require('@supabase/supabase-js');
const { planReminderFloor } = require('../src/services/reschedule-reminders');

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error('faltam SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY'); process.exit(2); }
const sb = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });

function brtYmd() {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const m = {}; for (const p of parts) m[p.type] = p.value;
  return `${m.year}-${m.month}-${m.day}`;
}
const YMD = brtYmd();
const at = (hhmm) => `${YMD}T${hhmm}:00-03:00`;
const NOW = Date.parse(at('12:00')); // "agora" simulado: meio-dia BRT

const createdTaskIds = [];
let pass = 0, fail = 0;
const t = (n, fn) => { try { fn(); pass++; console.log('  ok   ' + n); } catch (e) { fail++; console.error('  FAIL ' + n + '\n       ' + e.message); } };

async function makeTask(collabId, reminderHHMMs) {
  const { data: task, error: tErr } = await sb.from('tasks').insert({
    title: 'E2E-SNOOZE-TMP (pode deletar)', assigned_to: collabId, created_by: collabId,
    status: 'pending', context: 'work', due_date: YMD,
  }).select('id').single();
  if (tErr) throw new Error('insert task: ' + tErr.message);
  createdTaskIds.push(task.id);
  const rows = reminderHHMMs.map((h) => ({ task_id: task.id, remind_at: at(h) }));
  const { error: rErr } = await sb.from('task_reminders').insert(rows);
  if (rErr) throw new Error('insert reminders: ' + rErr.message);
  return task.id;
}

// Replica EXATAMENTE o que o branch applyTaskActions faz (sem o lookup/whatsapp).
async function applySnooze(taskId, notBefore, clearAll) {
  const { data: pend } = await sb.from('task_reminders').select('id, remind_at, label').eq('task_id', taskId).is('sent_at', null);
  const plan = planReminderFloor({ pendingRows: pend || [], taskRemindAt: null, taskRemindedAt: null, notBefore, clearAll, nowMs: NOW });
  if (plan.consumeReminderIds.length) await sb.from('task_reminders').update({ sent_at: new Date().toISOString() }).in('id', plan.consumeReminderIds);
  if (plan.insertReminder) await sb.from('task_reminders').insert({ task_id: taskId, remind_at: plan.insertReminder.remind_at, label: plan.insertReminder.label });
  const { data: after } = await sb.from('task_reminders').select('remind_at, sent_at').eq('task_id', taskId).order('remind_at');
  return after;
}

(async () => {
  try {
    const { data: collab } = await sb.from('collaborators').select('id, full_name').eq('is_active', true).limit(1).maybeSingle();
    assert.ok(collab, 'precisa de ao menos 1 collaborator ativo pra FK');

    // Cenário A — piso no meio (15h): silencia 13/14, mantém 15/16, sem insert.
    const tA = await makeTask(collab.id, ['13:00', '14:00', '15:00', '16:00']);
    const afterA = await applySnooze(tA, at('15:00'), false);
    t('A: 2 anteriores ao piso silenciados (sent_at)', () => assert.equal(afterA.filter((r) => r.sent_at !== null).length, 2));
    t('A: 2 no piso/depois seguem pendentes', () => assert.equal(afterA.filter((r) => r.sent_at === null).length, 2));
    t('A: nenhum row novo (piso ja coberto)', () => assert.equal(afterA.length, 4));

    // Cenário B — grade toda antes do piso: silencia todos + ensure-one no piso.
    const tB = await makeTask(collab.id, ['09:00', '11:00', '13:00']);
    const afterB = await applySnooze(tB, at('15:00'), false);
    t('B: 3 originais silenciados', () => assert.equal(afterB.filter((r) => r.sent_at !== null).length, 3));
    t('B: ensure-one criou 1 pendente no piso', () => {
      const pend = afterB.filter((r) => r.sent_at === null);
      assert.equal(pend.length, 1);
      assert.equal(Date.parse(pend[0].remind_at), Date.parse(at('15:00')));
    });

    // Cenário C — clearAll: silencia tudo, sem insert.
    const tC = await makeTask(collab.id, ['13:00', '16:00']);
    const afterC = await applySnooze(tC, null, true);
    t('C: clearAll silenciou todos', () => assert.equal(afterC.filter((r) => r.sent_at === null).length, 0));
  } catch (e) {
    fail++; console.error('ERRO geral: ' + e.message);
  } finally {
    for (const id of createdTaskIds) {
      await sb.from('task_reminders').delete().eq('task_id', id);
      await sb.from('tasks').delete().eq('id', id);
    }
    console.log(`  cleanup: ${createdTaskIds.length} task(s) de teste removida(s)`);
    console.log(`\ne2e-snooze: ${pass}/${pass + fail} passaram`);
    process.exit(fail ? 1 : 0);
  }
})();
