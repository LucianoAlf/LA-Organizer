const { test } = require('node:test');
const assert = require('node:assert');
const { hasFresherOutboundAfterRequest } = require('./coord-recency');

const REQ = '2026-06-22T23:34:50.000Z'; // recado do Yuri (20:34 BRT)

test('caso Alf: fechamento 27min depois do recado → suprime (true)', () => {
  // 21:01 BRT = 00:01Z do dia seguinte; bem depois do recado + buffer
  assert.strictEqual(
    hasFresherOutboundAfterRequest(REQ, ['2026-06-23T00:01:00.000Z']), true);
});

test('só a entrega do próprio recado (2s depois) → NÃO suprime (dentro do buffer)', () => {
  assert.strictEqual(
    hasFresherOutboundAfterRequest(REQ, ['2026-06-22T23:34:52.000Z']), false);
});

test('nada outbound depois → NÃO suprime', () => {
  assert.strictEqual(hasFresherOutboundAfterRequest(REQ, []), false);
  assert.strictEqual(hasFresherOutboundAfterRequest(REQ, undefined), false);
});

test('request nulo/inválido → NÃO suprime (fail-safe: mantém comportamento atual)', () => {
  assert.strictEqual(hasFresherOutboundAfterRequest(null, ['2026-06-23T00:01:00.000Z']), false);
  assert.strictEqual(hasFresherOutboundAfterRequest('lixo', ['2026-06-23T00:01:00.000Z']), false);
});

test('outbound logo no limite do buffer (4min) → NÃO suprime; 6min → suprime', () => {
  const t4 = new Date(new Date(REQ).getTime() + 4 * 60 * 1000).toISOString();
  const t6 = new Date(new Date(REQ).getTime() + 6 * 60 * 1000).toISOString();
  assert.strictEqual(hasFresherOutboundAfterRequest(REQ, [t4]), false);
  assert.strictEqual(hasFresherOutboundAfterRequest(REQ, [t6]), true);
});
