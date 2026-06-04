// src/services/short-id-match.test.js
// Encoda o caso REAL cadeira da ADM (03/06): o LLM emitiu um UUID com head correto
// (1aede3b5) e tail alucinado; o matcher antigo (startsWith do uuid inteiro) não casava.
//
// Rodar: node --test src/services/short-id-match.test.js

const { test } = require('node:test');
const assert = require('node:assert');
const { matchRowsByShortId, normHex } = require('./short-id-match');

const REAL_ID = '1aede3b5-7ac1-4889-9bc3-030a834d3b4d';
const HALLUCINATED = '1aede3b5-f1f8-4b5e-9b1a-2c3d4e5f6a7b'; // head OK, tail inventado
const rows = [{ id: REAL_ID, title: 'Cadeira ADM' }];

test('short-id de 8 chars casa (caminho normal)', () => {
  const m = matchRowsByShortId(rows, '1aede3b5');
  assert.strictEqual(m.length, 1);
  assert.strictEqual(m[0].id, REAL_ID);
});

test('UUID completo CORRETO casa', () => {
  const m = matchRowsByShortId(rows, REAL_ID);
  assert.strictEqual(m.length, 1);
  assert.strictEqual(m[0].id, REAL_ID);
});

test('caso cadeira ADM: UUID com tail ALUCINADO recua pro head de 8 e casa', () => {
  const m = matchRowsByShortId(rows, HALLUCINATED);
  assert.strictEqual(m.length, 1);
  assert.strictEqual(m[0].id, REAL_ID);
});

test('id totalmente errado (head diferente) NÃO casa', () => {
  const m = matchRowsByShortId(rows, 'deadbeef-0000-0000-0000-000000000000');
  assert.strictEqual(m.length, 0);
});

test('ambiguidade: 2 rows com mesmo head de 8 → retorna ambos (caller rejeita)', () => {
  const two = [
    { id: '1aede3b5-7ac1-4889-9bc3-030a834d3b4d' },
    { id: '1aede3b5-aaaa-4889-9bc3-030a834d3b4d' },
  ];
  // head-fallback só dispara se o EXATO falhar; uuid alucinado bate nos 2 pelo head.
  const m = matchRowsByShortId(two, '1aede3b5-f1f8-4b5e-9b1a-2c3d4e5f6a7b');
  assert.strictEqual(m.length, 2);
});

test('short de 8 chars NÃO faz fallback (precisão preservada p/ ids curtos)', () => {
  // "1aede3b5" não casa nenhum → não recua (head só pra id comprido >=12 hex)
  const m = matchRowsByShortId([{ id: 'ffffffff-7ac1-4889-9bc3-030a834d3b4d' }], '1aede3b5');
  assert.strictEqual(m.length, 0);
});

test('rows vazio/nulo ou shortId vazio → []', () => {
  assert.deepStrictEqual(matchRowsByShortId([], '1aede3b5'), []);
  assert.deepStrictEqual(matchRowsByShortId(null, '1aede3b5'), []);
  assert.deepStrictEqual(matchRowsByShortId(rows, ''), []);
});

test('normHex remove hífens e baixa caixa', () => {
  assert.strictEqual(normHex('1AEDE3B5-7AC1'), '1aede3b57ac1');
  assert.strictEqual(normHex(null), '');
});
