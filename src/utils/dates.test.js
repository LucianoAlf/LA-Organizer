const { test } = require('node:test');
const assert = require('node:assert');
const { withinConfirmWindow, todayYmdSP } = require('./dates');

// todayYmdSP (staged-reschedule i) — YMD de SP via Intl, robusto ao shift UTC pós-21h.
test('todayYmdSP: sem shift UTC pós-21h (16 UTC 01:00 = 15 SP 22:00 → dia 15)', () => {
  assert.strictEqual(todayYmdSP(new Date('2026-07-16T01:00:00Z')), '2026-07-15');
});
test('todayYmdSP: meio-dia SP trivial', () => {
  assert.strictEqual(todayYmdSP(new Date('2026-07-15T15:00:00Z')), '2026-07-15');
});
test('todayYmdSP: virada de mês respeita fuso', () => {
  // 2026-08-01 02:00 UTC = 2026-07-31 23:00 SP → ainda julho
  assert.strictEqual(todayYmdSP(new Date('2026-08-01T02:00:00Z')), '2026-07-31');
});

test('withinConfirmWindow: 5 min atras dentro de 20 → true', () => {
  const asked = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  assert.strictEqual(withinConfirmWindow(asked, 20), true);
});
test('withinConfirmWindow: 5h atras fora de 20 → false (caso do bug Rafinha)', () => {
  const asked = new Date(Date.now() - 5 * 3600 * 1000).toISOString();
  assert.strictEqual(withinConfirmWindow(asked, 20), false);
});
test('withinConfirmWindow: 19 min dentro de 20 → true', () => {
  const asked = new Date(Date.now() - 19 * 60 * 1000).toISOString();
  assert.strictEqual(withinConfirmWindow(asked, 20), true);
});
test('withinConfirmWindow: asked_at ausente/invalido → false (conservador)', () => {
  assert.strictEqual(withinConfirmWindow(null, 20), false);
  assert.strictEqual(withinConfirmWindow(undefined, 20), false);
  assert.strictEqual(withinConfirmWindow('lixo', 20), false);
});
