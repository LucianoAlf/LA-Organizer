'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { detectPartialConfab } = require('./confab-partial-observe');

// ── DISPARA: falha parcial cross-tipo ──
test('dispara: PREFS rejeitado + TASK executado (caso Jhonatan)', () => {
  const hit = detectPartialConfab([
    { marker_type: 'TASK_UPDATE', result: 'executed' },
    { marker_type: 'PREFS_UPDATE', result: 'rejected' },
  ]);
  assert.deepEqual(hit, { rejected: ['PREFS_UPDATE'], executed: ['TASK_UPDATE'] });
});
test('dispara: malformed chega como rejected (schema_invalid)', () => {
  const hit = detectPartialConfab([
    { marker_type: 'TASK', result: 'executed' },
    { marker_type: 'NOTE_ACTION', result: 'rejected' }, // malformed → rejected
  ]);
  assert.ok(hit);
  assert.deepEqual(hit.rejected, ['NOTE_ACTION']);
  assert.deepEqual(hit.executed, ['TASK']);
});
test('dispara: vários executados, um rejeitado de outro tipo', () => {
  const hit = detectPartialConfab([
    { marker_type: 'TASK', result: 'executed' },
    { marker_type: 'EVENT', result: 'executed' },
    { marker_type: 'PREFS_UPDATE', result: 'rejected' },
  ]);
  assert.ok(hit);
  assert.deepEqual(hit.rejected, ['PREFS_UPDATE']);
  assert.deepEqual(hit.executed.sort(), ['EVENT', 'TASK']);
});

// ── NÃO dispara ──
test('não dispara: mesmo tipo rejeitado+executado (handler já cobre o partial)', () => {
  assert.equal(detectPartialConfab([
    { marker_type: 'TASK', result: 'executed' },
    { marker_type: 'TASK', result: 'rejected' },
  ]), null);
});
test('não dispara: só executados', () => {
  assert.equal(detectPartialConfab([
    { marker_type: 'TASK', result: 'executed' },
    { marker_type: 'EVENT', result: 'executed' },
  ]), null);
});
test('não dispara: só rejeitados (Camada 1 cobre o nothingPersisted)', () => {
  assert.equal(detectPartialConfab([
    { marker_type: 'PREFS_UPDATE', result: 'rejected' },
  ]), null);
});
test('não dispara: rejected + skipped (skipped é não-ação legítima)', () => {
  assert.equal(detectPartialConfab([
    { marker_type: 'NOTE_ACTION', result: 'skipped' },
    { marker_type: 'PREFS_UPDATE', result: 'rejected' },
  ]), null);
});
test('não dispara: META rejeitado (CHOKEPOINT) + TASK executado → CHOKEPOINT fora', () => {
  assert.equal(detectPartialConfab([
    { marker_type: 'TASK', result: 'executed' },
    { marker_type: 'CHOKEPOINT', result: 'rejected' },
  ]), null);
});
test('não dispara: ACTIONABLE_NO_MARKER (META) rejeitado sem executado real', () => {
  assert.equal(detectPartialConfab([
    { marker_type: 'ACTIONABLE_NO_MARKER', result: 'rejected' },
  ]), null);
});
test('não dispara: entrada vazia/inválida', () => {
  assert.equal(detectPartialConfab([]), null);
  assert.equal(detectPartialConfab(null), null);
  assert.equal(detectPartialConfab([{ result: 'executed' }]), null); // sem marker_type
});
