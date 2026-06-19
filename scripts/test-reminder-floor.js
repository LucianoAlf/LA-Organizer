// Teste standalone do helper puro planReminderFloor (item #5 audit 15/06, caso Jereh).
// Função PURA — roda SEM Supabase/env. Uso: node scripts/test-reminder-floor.js
'use strict';
const assert = require('node:assert/strict');
const { planReminderFloor } = require('../src/services/reschedule-reminders');

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; console.log(`  ok   ${name}`); }
  catch (e) { fail++; console.error(`  FAIL ${name}\n       ${e.message}`); }
}

const NOW = Date.parse('2026-06-19T12:00:00-03:00'); // "agora" de referência
const FLOOR = '2026-06-19T15:00:00-03:00';
const r = (id, hhmm, label) => ({ id, remind_at: `2026-06-19T${hhmm}:00-03:00`, label: label || null });

// 1) Piso no meio: consome só os anteriores, mantém os >= piso, sem insert.
t('piso no meio: consome antes, mantem depois', () => {
  const p = planReminderFloor({
    pendingRows: [r('a','13:00'), r('b','14:00'), r('c','15:00'), r('d','16:00')],
    taskRemindAt: null, taskRemindedAt: null, notBefore: FLOOR, clearAll: false, nowMs: NOW,
  });
  assert.deepEqual(p.consumeReminderIds, ['a','b']);
  assert.equal(p.insertReminder, null);
  assert.equal(p.taskPatch, null);
});

// 2) Grade toda antes do piso: consome todos + ensure-one no piso (herda label).
t('grade toda antes: consome todos + ensure-one', () => {
  const p = planReminderFloor({
    pendingRows: [r('a','09:00','Reunião'), r('b','11:00'), r('c','13:00')],
    taskRemindAt: null, taskRemindedAt: null, notBefore: FLOOR, clearAll: false, nowMs: NOW,
  });
  assert.deepEqual(p.consumeReminderIds, ['a','b','c']);
  assert.deepEqual(p.insertReminder, { remind_at: FLOOR, label: 'Reunião' });
});

// 3) Piso no passado: consome anteriores, NÃO cria no passado.
t('piso no passado: sem ensure-one', () => {
  const p = planReminderFloor({
    pendingRows: [r('a','08:00'), r('b','09:00')],
    taskRemindAt: null, taskRemindedAt: null,
    notBefore: '2026-06-19T10:00:00-03:00', clearAll: false, nowMs: NOW,
  });
  assert.deepEqual(p.consumeReminderIds, ['a','b']);
  assert.equal(p.insertReminder, null);
});

// 4) clearAll: consome todos, sem insert, limpa one-shot pendente.
t('clearAll: consome tudo + limpa one-shot', () => {
  const p = planReminderFloor({
    pendingRows: [r('a','13:00'), r('b','16:00')],
    taskRemindAt: '2026-06-19T18:00:00-03:00', taskRemindedAt: null,
    notBefore: null, clearAll: true, nowMs: NOW,
  });
  assert.deepEqual(p.consumeReminderIds, ['a','b']);
  assert.equal(p.insertReminder, null);
  assert.deepEqual(p.taskPatch, { remind_at: null });
});

// 5) One-shot antes do piso (sem grade): move pro piso, sem ensure-one.
t('one-shot antes do piso: move pro piso', () => {
  const p = planReminderFloor({
    pendingRows: [],
    taskRemindAt: '2026-06-19T13:00:00-03:00', taskRemindedAt: null,
    notBefore: FLOOR, clearAll: false, nowMs: NOW,
  });
  assert.deepEqual(p.taskPatch, { remind_at: FLOOR });
  assert.equal(p.insertReminder, null);
  assert.deepEqual(p.consumeReminderIds, []);
});

// 6) One-shot já >= piso: no-op.
t('one-shot ja no/depois do piso: no-op', () => {
  const p = planReminderFloor({
    pendingRows: [],
    taskRemindAt: '2026-06-19T17:00:00-03:00', taskRemindedAt: null,
    notBefore: FLOOR, clearAll: false, nowMs: NOW,
  });
  assert.equal(p.taskPatch, null);
  assert.equal(p.insertReminder, null);
});

// 7) One-shot já disparado (reminded_at preenchido) e sem grade: no-op (não inventa lembrete).
t('one-shot ja disparado, sem grade: no-op', () => {
  const p = planReminderFloor({
    pendingRows: [],
    taskRemindAt: '2026-06-19T13:00:00-03:00', taskRemindedAt: '2026-06-19T13:00:05-03:00',
    notBefore: FLOOR, clearAll: false, nowMs: NOW,
  });
  assert.equal(p.taskPatch, null);
  assert.equal(p.insertReminder, null);
  assert.deepEqual(p.consumeReminderIds, []);
});

// 8) Idempotência: 2ª chamada com a grade já no piso → no-op.
t('idempotente: 2a chamada e no-op', () => {
  const p = planReminderFloor({
    pendingRows: [r('novo','15:00')],
    taskRemindAt: null, taskRemindedAt: null, notBefore: FLOOR, clearAll: false, nowMs: NOW,
  });
  assert.deepEqual(p.consumeReminderIds, []);
  assert.equal(p.insertReminder, null);
});

console.log(`\nplanReminderFloor: ${pass}/${pass + fail} passaram`);
process.exit(fail ? 1 : 0);
