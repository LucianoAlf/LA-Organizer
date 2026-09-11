'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { resolveTxnTarget } = require('./txn-target');

// Rose (4bf44931): pacote de 6 lançamentos criado de uma vez; "desfaz esses lançamentos q vc fez
// agr" apagava SÓ o mais recente. Candidatos recente→antigo, como listRecentTransactions devolve.
const T0 = Date.parse('2026-07-20T01:17:35Z');
const at = (s) => new Date(T0 - s * 1000).toISOString();
const PACOTE = [
  { id: 'a', amount: 34.9, description: 'Assinatura app', created_at: at(0) },
  { id: 'b', amount: 145.87, description: 'Posto', created_at: at(2) },
  { id: 'c', amount: 500, description: 'Marcenaria', created_at: at(4) },
  { id: 'd', amount: 80, description: 'Mercado', created_at: at(6) },
  { id: 'e', amount: 60, description: 'Farmácia', created_at: at(8) },
  { id: 'f', amount: 129.5, description: 'Restaurante', created_at: at(10) },
];
const ANTIGO = { id: 'z', amount: 12, description: 'Café', created_at: at(3600) };
const ROSE = 'tom, desfaz esses lancamentos q vc fez agr pf';

test('Rose: "desfaz esses lançamentos" = o pacote inteiro (6), não o último', () => {
  const r = resolveTxnTarget(ROSE, [...PACOTE, ANTIGO]);
  assert.strictEqual(r.kind, 'batch');
  assert.deepStrictEqual(r.candidates.map((c) => c.id), ['a', 'b', 'c', 'd', 'e', 'f']);
});

test('"apaga todos" também pega só a última rajada (o café de 1h antes fica)', () => {
  const r = resolveTxnTarget('apaga todos', [...PACOTE, ANTIGO]);
  assert.strictEqual(r.kind, 'batch');
  assert.ok(!r.candidates.some((c) => c.id === 'z'));
});

test('singular, valor e nome continuam como antes', () => {
  assert.deepStrictEqual(resolveTxnTarget('apaga isso', PACOTE), { kind: 'one', txn: PACOTE[0] });
  assert.deepStrictEqual(resolveTxnTarget('apaga a de 500', PACOTE), { kind: 'one', txn: PACOTE[2] });
  assert.deepStrictEqual(resolveTxnTarget('apaga o posto', PACOTE), { kind: 'one', txn: PACOTE[1] });
});

test('plural com um lançamento só na rajada → é aquele um', () => {
  const r = resolveTxnTarget('desfaz esses lançamentos', [PACOTE[0], ANTIGO]);
  assert.deepStrictEqual(r, { kind: 'one', txn: PACOTE[0] });
});

const ENG = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'engine.js'), 'utf8');
test('engine: lote confirma antes (txn_batch) e o "sim" apaga todos', () => {
  assert.match(ENG, /if \(r\.kind === 'batch'\) \{[\s\S]{0,400}form: 'txn_batch', op: 'delete'/);
  assert.match(ENG, /finOpen\.payload\.form === 'txn_batch' && finOpen\.payload\.op === 'delete'/);
  assert.match(ENG, /txn_batch_delete:\$\{_nOk\}\/\$\{_cands\.length\}/);
});
