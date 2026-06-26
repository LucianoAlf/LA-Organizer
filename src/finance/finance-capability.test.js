'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { resolveFinanceCapability, EDIT_WINDOW_HOURS } = require('./finance-capability');

test('criar sempre dá (sem janela) — caso Matheus "joga esses dados"', () => {
  const v = resolveFinanceCapability({ action: 'register_transaction', params: {} }, {});
  assert.deepEqual([v.can, v.reachable], [true, true]);
});
test('card_purchase também não tem janela', () => {
  assert.equal(resolveFinanceCapability({ action: 'card_purchase', params: {} }, {}).reachable, true);
});
test('editar sem alvo recente → não alcança + redirect honesto', () => {
  const v = resolveFinanceCapability({ action: 'edit_transaction', params: {} }, { candidates: [] });
  assert.equal(v.can, true);
  assert.equal(v.reachable, false);
  assert.equal(v.reason, 'no_recent_target');
  assert.ok(v.redirect && v.redirect.app_path);
});
test('editar com 1 alvo recente → alcança', () => {
  const v = resolveFinanceCapability({ action: 'edit_transaction', params: {} }, { candidates: [{ id: 'x' }] });
  assert.equal(v.reachable, true);
});
test('editar com >1 alvo e sem which → ambíguo', () => {
  const v = resolveFinanceCapability({ action: 'edit_transaction', params: {} }, { candidates: [{ id: 'a' }, { id: 'b' }] });
  assert.equal(v.reachable, false);
  assert.equal(v.reason, 'ambiguous_target');
});
test('editar com >1 alvo MAS com which → alcança (desambiguado)', () => {
  const v = resolveFinanceCapability({ action: 'edit_transaction', params: { which: 'mercado' } }, { candidates: [{ id: 'a' }, { id: 'b' }] });
  assert.equal(v.reachable, true);
});
test('delete fora de alcance → redirect', () => {
  const v = resolveFinanceCapability({ action: 'delete_transaction', params: {} }, { candidates: [] });
  assert.equal(v.reachable, false);
  assert.equal(v.reason, 'no_recent_target');
});
test('ação desconhecida → não pode', () => {
  assert.equal(resolveFinanceCapability({ action: 'foo' }, {}).can, false);
});
test('EDIT_WINDOW_HOURS exportado (fonte única da janela)', () => {
  assert.equal(EDIT_WINDOW_HOURS, 2);
});
