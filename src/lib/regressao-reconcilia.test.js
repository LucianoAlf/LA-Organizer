// src/lib/regressao-reconcilia.test.js
// Rodar: node --test src/lib/regressao-reconcilia.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const { ehRegressaoConfirmada } = require('./regressao-reconcilia');

test('não-regressão pela triagem → false', () => {
  assert.strictEqual(ehRegressaoConfirmada({ auto_triage: { decision: 'keep' } }), false);
  assert.strictEqual(ehRegressaoConfirmada({ auto_triage: { decision: 'suppress', matched_code: 'X' } }), false);
});

test('regressão sem promoção → true (palpite da triagem vale até o ciclo refinar)', () => {
  assert.strictEqual(ehRegressaoConfirmada({ auto_triage: { decision: 'regression', matched_code: 'BUG-9' } }), true);
});

test('regressão promovida ao MESMO código → true (agente confirmou o KI voltando)', () => {
  assert.strictEqual(ehRegressaoConfirmada({
    promoted_code: 'BUG-9', auto_triage: { decision: 'regression', matched_code: 'BUG-9' },
  }), true);
});

// O caso 16/08: promovido a código DIFERENTE = raiz nova, não regressão do matched_code.
test('regressão promovida a código DIFERENTE → false', () => {
  assert.strictEqual(ehRegressaoConfirmada({
    promoted_code: 'CONFAB-INVERSO-OFERTA-CONDICIONAL',
    auto_triage: { decision: 'regression', matched_code: 'TOM-AFIRMA-DEPOIS-DESMENTE' },
  }), false);
});

test('entrada nula/sem auto_triage não quebra', () => {
  assert.strictEqual(ehRegressaoConfirmada(null), false);
  assert.strictEqual(ehRegressaoConfirmada({}), false);
});
