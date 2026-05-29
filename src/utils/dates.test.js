const { test } = require('node:test');
const assert = require('node:assert');
const { withinConfirmWindow } = require('./dates');

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
