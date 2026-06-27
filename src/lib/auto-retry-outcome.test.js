'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { classifyAutoRetry } = require('./auto-retry-outcome');

test('ok=1, fail=0 → executed/persisted', () => {
  assert.deepEqual(classifyAutoRetry({ okCount: 1, failCount: 0 }),
    { persisted: true, status: 'executed', reason: 'ok=1 fail=0' });
});
test('ok=1, fail=1 → partial/persisted', () => {
  assert.deepEqual(classifyAutoRetry({ okCount: 1, failCount: 1 }),
    { persisted: true, status: 'partial', reason: 'ok=1 fail=1' });
});
test('ok=0 + dup_task (score 1.0) → skipped/persisted (anti confab-inverso, caso Ana)', () => {
  const r = { okCount: 0, failCount: 1, integrityPayload: { type: 'dup_task', conflicts: [{ id: 'x', title: 'T', _score: 1.0 }] } };
  assert.deepEqual(classifyAutoRetry(r),
    { persisted: true, status: 'skipped', reason: 'already_exists:dup(1.00)' });
});
test('ok=0 sem integrityPayload → rejected/não-persistido', () => {
  assert.deepEqual(classifyAutoRetry({ okCount: 0, failCount: 2 }),
    { persisted: false, status: 'rejected', reason: 'all_failed:2' });
});
test('ok=0 + payload não-dup (temporal_soft) → rejected (só dup prova existência)', () => {
  const r = { okCount: 0, failCount: 1, integrityPayload: { type: 'temporal_soft' } };
  assert.deepEqual(classifyAutoRetry(r),
    { persisted: false, status: 'rejected', reason: 'all_failed:1' });
});
test('null → rejected (defensivo)', () => {
  assert.deepEqual(classifyAutoRetry(null),
    { persisted: false, status: 'rejected', reason: 'all_failed:0' });
});
test('dup_task sem _score → dup(0.00), ainda persistido (defensivo)', () => {
  const r = { okCount: 0, failCount: 1, integrityPayload: { type: 'dup_task', conflicts: [] } };
  assert.deepEqual(classifyAutoRetry(r),
    { persisted: true, status: 'skipped', reason: 'already_exists:dup(0.00)' });
});
