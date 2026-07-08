const { test } = require('node:test');
const assert = require('node:assert');
const { snoozeNotBefore } = require('./snooze-fields');

// Audit 08/07 (Matheus B): o LLM manda "until"/"snooze_until" em vez de "not_before".
test('not_before direto', () => {
  assert.strictEqual(snoozeNotBefore({ not_before: '2026-07-13T00:00:00-03:00' }), '2026-07-13T00:00:00-03:00');
});

test('alias until (marker real do Matheus)', () => {
  assert.strictEqual(snoozeNotBefore({ until: '2026-07-13T00:00:00-03:00' }), '2026-07-13T00:00:00-03:00');
});

test('alias snooze_until', () => {
  assert.strictEqual(snoozeNotBefore({ snooze_until: '2026-07-13T09:00:00-03:00' }), '2026-07-13T09:00:00-03:00');
});

test('not_before tem precedência sobre until', () => {
  assert.strictEqual(snoozeNotBefore({ not_before: 'A', until: 'B' }), 'A');
});

test('nenhum alias → undefined (cai no clear_all/rejeição normal)', () => {
  assert.strictEqual(snoozeNotBefore({ clear_all: true }), undefined);
  assert.strictEqual(snoozeNotBefore({}), undefined);
});

test('não-objeto → undefined', () => {
  assert.strictEqual(snoozeNotBefore(null), undefined);
  assert.strictEqual(snoozeNotBefore(undefined), undefined);
});

test('valor não-string é ignorado (validação de formato fica no engine)', () => {
  assert.strictEqual(snoozeNotBefore({ until: 123 }), undefined);
  assert.strictEqual(snoozeNotBefore({ not_before: '' }), undefined);
});
