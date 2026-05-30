const { test } = require('node:test');
const assert = require('node:assert');
const { makeSelicClient } = require('./selic');

test('busca e cacheia (1 fetch para 2 chamadas)', async () => {
  let calls = 0;
  const fakeFetch = async () => { calls++; return { ok: true, json: async () => [{ data: '29/05/2026', valor: '10.50' }] }; };
  const selic = makeSelicClient({ fetchImpl: fakeFetch, ttlMs: 60000, now: () => 1000 });
  assert.strictEqual(await selic.getAnnualRate(), 10.5);
  assert.strictEqual(await selic.getAnnualRate(), 10.5);
  assert.strictEqual(calls, 1, 'segunda chamada deve usar cache');
});
test('fallback para constante quando fetch falha e cache vazio', async () => {
  const fakeFetch = async () => { throw new Error('BCB down'); };
  const selic = makeSelicClient({ fetchImpl: fakeFetch, fallbackAnnual: 10.5 });
  assert.strictEqual(await selic.getAnnualRate(), 10.5);
});
test('monthlyRate converte a.a. -> a.m. (taxa equivalente)', async () => {
  const fakeFetch = async () => ({ ok: true, json: async () => [{ data: 'x', valor: '12.00' }] });
  const selic = makeSelicClient({ fetchImpl: fakeFetch });
  const m = await selic.getMonthlyRate();
  assert.ok(m > 0.0094 && m < 0.0096, `mensal inesperado: ${m}`);
});
test('aceita valor com virgula decimal', async () => {
  const fakeFetch = async () => ({ ok: true, json: async () => [{ data: 'x', valor: '9,75' }] });
  const selic = makeSelicClient({ fetchImpl: fakeFetch });
  assert.strictEqual(await selic.getAnnualRate(), 9.75);
});
