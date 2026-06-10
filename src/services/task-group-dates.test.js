const { test } = require('node:test');
const assert = require('node:assert');
const { childDueDateForCycle, dayOfMonthToYmd } = require('./task-group-dates');

test('preserva dia-do-mês no ciclo (caso Rose)', () => {
  assert.strictEqual(childDueDateForCycle('2026-06-12', '2026-07-26'), '2026-07-12');
});
test('clamp mês curto: 31 → 30/jun', () => {
  assert.strictEqual(childDueDateForCycle('2026-05-31', '2026-06-01'), '2026-06-30');
});
test('clamp fevereiro não-bissexto', () => {
  assert.strictEqual(childDueDateForCycle('2026-12-30', '2027-02-01'), '2027-02-28');
});
test('dayOfMonthToYmd com clamp', () => {
  assert.strictEqual(dayOfMonthToYmd(12, '2026-06-09'), '2026-06-12');
  assert.strictEqual(dayOfMonthToYmd(31, '2026-06-09'), '2026-06-30');
});
