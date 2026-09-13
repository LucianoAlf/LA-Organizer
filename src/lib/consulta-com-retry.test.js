'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { consultaComRetry } = require('./consulta-com-retry');

const semDormir = { sleep: async () => {} };

test('a falha passageira da 1ª tentativa é salva pela 2ª (o caso de 12/09 15:00)', async () => {
  let n = 0;
  const r = await consultaComRetry(async () => {
    n++;
    return n === 1 ? { data: null, error: { message: 'fetch failed' } } : { data: [1, 2, 3], error: null };
  }, semDormir);
  assert.strictEqual(n, 2);
  assert.deepStrictEqual(r.data, [1, 2, 3]);
  assert.strictEqual(r.error, null);
  assert.strictEqual(r.tentativas, 2);
});

test('consulta que responde de primeira não é repetida', async () => {
  let n = 0;
  const r = await consultaComRetry(async () => { n++; return { data: [], error: null }; }, semDormir);
  assert.strictEqual(n, 1);
  assert.strictEqual(r.tentativas, 1);
});

test('se as duas falharem, o erro volta igualzinho — a falha-fechada de sempre vale', async () => {
  let n = 0;
  const r = await consultaComRetry(async () => { n++; return { data: null, error: { message: 'timeout' } }; }, semDormir);
  assert.strictEqual(n, 2);
  assert.strictEqual(r.error.message, 'timeout');
  assert.strictEqual(r.data, null);
  assert.strictEqual(r.tentativas, 2);
});

test('exceção conta como erro e também é repetida', async () => {
  let n = 0;
  const r = await consultaComRetry(async () => { n++; if (n === 1) throw new Error('ECONNRESET'); return { data: [7], error: null }; }, semDormir);
  assert.strictEqual(n, 2);
  assert.deepStrictEqual(r.data, [7]);
});

test('exceção nas duas vira erro legível, sem derrubar o ritual', async () => {
  const r = await consultaComRetry(async () => { throw new Error('ECONNRESET'); }, semDormir);
  assert.strictEqual(r.error.message, 'ECONNRESET');
  assert.strictEqual(r.data, null);
});

test('espera entre tentativas é a combinada, e só entre elas', async () => {
  const esperas = [];
  await consultaComRetry(async () => ({ data: null, error: { message: 'x' } }),
    { tentativas: 3, esperaMs: 500, sleep: async (ms) => esperas.push(ms) });
  assert.deepStrictEqual(esperas, [500, 500]);
});

const FONTE = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'rituals', 'anamnese-pauta.js'), 'utf8');
test('a pauta consulta o LA Report SEMPRE com retry — nenhuma chamada crua sobrou', () => {
  const total = FONTE.split('laReport.rpc(').length - 1;
  const comRetry = FONTE.split('consultaComRetry(() => laReport.rpc(').length - 1;
  assert.strictEqual(total, comRetry, `${total - comRetry} consulta(s) ao LA Report ainda desistem na primeira falha`);
  assert.ok(comRetry >= 5, `esperava as 5 consultas da pauta com retry (achei ${comRetry})`);
});
