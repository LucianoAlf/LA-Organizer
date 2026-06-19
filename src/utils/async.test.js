// src/utils/async.test.js
// Rodar: node --test src/utils/async.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const { promiseWithTimeout } = require('./async');

const wait = (ms, val) => new Promise((r) => setTimeout(() => r(val), ms));

test('resolve com o valor quando termina antes do timeout', async () => {
  const r = await promiseWithTimeout(wait(10, 'ok'), 100, 'fb');
  assert.strictEqual(r, 'ok');
});

test('resolve com o fallback quando estoura o timeout', async () => {
  const r = await promiseWithTimeout(wait(100, 'ok'), 20, 'fb');
  assert.strictEqual(r, 'fb');
});

test('fallback default é null', async () => {
  const r = await promiseWithTimeout(wait(100, 'ok'), 20);
  assert.strictEqual(r, null);
});
