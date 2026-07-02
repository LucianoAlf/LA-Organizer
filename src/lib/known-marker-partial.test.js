'use strict';
// UNKNOWN-MARKER-STRIPPED-SILENT-PARTIAL (Fefê 01/07) — node --test src/lib/known-marker-partial.test.js
const test = require('node:test');
const assert = require('node:assert');
const { detectKnownMarkerLoss, PARTIAL_LOSS_DISCLAIMER } = require('./known-marker-partial');

test('Fefê: names TASK_UPDATE×3 + END → lost=true (trabalho real perdido)', () => {
  const r = detectKnownMarkerLoss(['TASK_UPDATE', 'TASK_UPDATE', 'TASK_UPDATE', 'END', 'TASK_UPDATE']);
  assert.strictEqual(r.lost, true);
  assert.deepStrictEqual(r.known, ['TASK_UPDATE'], 'dedup — 1 nome conhecido');
});

test('alucinação pura (TASK_CREATE inventado) → lost=false, strip silencioso segue certo', () => {
  const r = detectKnownMarkerLoss(['TASK_CREATE']);
  assert.strictEqual(r.lost, false);
});

test('END sozinho / STICKER residual → lost=false', () => {
  assert.strictEqual(detectKnownMarkerLoss(['END']).lost, false);
  assert.strictEqual(detectKnownMarkerLoss(['STICKER']).lost, false);
});

test('misto: alucinado + conhecido → lost=true e known só o conhecido', () => {
  const r = detectKnownMarkerLoss(['TASK_CREATE', 'EVENT_UPDATE', 'END']);
  assert.strictEqual(r.lost, true);
  assert.deepStrictEqual(r.known, ['EVENT_UPDATE']);
});

test('case-insensitive defensivo + entradas vazias seguras', () => {
  assert.strictEqual(detectKnownMarkerLoss(['task_update']).lost, true);
  assert.strictEqual(detectKnownMarkerLoss([]).lost, false);
  assert.strictEqual(detectKnownMarkerLoss(null).lost, false);
});

test('disclaimer não vaza jargão de mecanismo (marker/engine/schema)', () => {
  assert.ok(!/marker|engine|schema|parse/i.test(PARTIAL_LOSS_DISCLAIMER));
});
