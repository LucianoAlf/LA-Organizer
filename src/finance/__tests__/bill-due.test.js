const test = require('node:test');
const assert = require('node:assert');
const { isBillDue } = require('../bill-due');

const ctx = { dom: 10, todayStr: '2026-06-10', horizonStr: '2026-06-15', monthStart: '2026-06-01' };

test('monthly: a vencer dentro da janela', () => {
  assert.equal(isBillDue({ recurrence: 'monthly', due_day: 12, last_paid_at: null }, ctx), true);
});
test('monthly: atrasada (due_day < hoje) e não paga', () => {
  assert.equal(isBillDue({ recurrence: 'monthly', due_day: 5, last_paid_at: null }, ctx), true);
});
test('monthly: paga este mês não aparece', () => {
  assert.equal(isBillDue({ recurrence: 'monthly', due_day: 5, last_paid_at: '2026-06-03' }, ctx), false);
});
test('once: due_date dentro do horizonte aparece', () => {
  assert.equal(isBillDue({ recurrence: 'once', due_date: '2026-06-14', last_paid_at: null }, ctx), true);
});
test('once: due_date atrasada (antes de hoje) aparece', () => {
  assert.equal(isBillDue({ recurrence: 'once', due_date: '2026-06-02', last_paid_at: null }, ctx), true);
});
test('once: já paga não aparece', () => {
  assert.equal(isBillDue({ recurrence: 'once', due_date: '2026-06-14', last_paid_at: '2026-06-05' }, ctx), false);
});
test('once: muito no futuro não aparece', () => {
  assert.equal(isBillDue({ recurrence: 'once', due_date: '2026-07-20', last_paid_at: null }, ctx), false);
});
