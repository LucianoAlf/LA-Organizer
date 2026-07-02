// Rodar: node --test src/lib/outbound-queue.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const { planSchedule } = require('./outbound-queue');

// rng determinístico: 0.5 → jitter = 0 (centro do range)
const rngHalf = () => 0.5;

test('planSchedule: espaçamento base, jitter zero em 0.5', () => {
  const off = planSchedule(4, { baseGapMs: 30000, jitterMs: 8000, rng: rngHalf });
  assert.deepStrictEqual(off, [0, 30000, 60000, 90000]);
});

test('planSchedule: monotônico e ≥0 mesmo com jitter negativo (rng=0)', () => {
  const off = planSchedule(5, { baseGapMs: 30000, jitterMs: 8000, rng: () => 0 }); // jitter = -8000
  for (let i = 1; i < off.length; i++) assert.ok(off[i] >= off[i - 1], `mono @${i}`);
  assert.ok(off.every((o) => o >= 0), 'todos ≥ 0');
});

test('planSchedule: jitter fica no range (rng=1 → +jitterMs)', () => {
  const off = planSchedule(3, { baseGapMs: 30000, jitterMs: 8000, rng: () => 1 });
  // i=0: 0 + 8000 = 8000; i=1: 30000+8000; i=2: 60000+8000
  assert.deepStrictEqual(off, [8000, 38000, 68000]);
});

test('planSchedule: count 0 e 1', () => {
  assert.deepStrictEqual(planSchedule(0, {}), []);
  assert.deepStrictEqual(planSchedule(1, { rng: rngHalf }), [0]);
});
