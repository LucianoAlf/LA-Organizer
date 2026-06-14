// Testes da rede de segurança de parcelamento. Roda: node --test src/finance/parse-installments.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const { extractInstallments, reconcileInstallments } = require('./parse-installments');

test('extrai "Nx" — caso real da Rose', () => {
  assert.equal(extractInstallments('comprei uma TV 3200 em 10x no nubank'), 10);
  assert.equal(extractInstallments('12x sem juros'), 12);
  assert.equal(extractInstallments('paguei 3 x no crédito'), 3);
});

test('extrai "N vezes" / "N parcelas"', () => {
  assert.equal(extractInstallments('parcelei em 3 vezes de 100'), 3);
  assert.equal(extractInstallments('comprei o sofá em 6 parcelas'), 6);
  assert.equal(extractInstallments('foi 1 parcela só'), null); // 1 = à vista, não parcela
});

test('extrai "parcelei/dividi em N"', () => {
  assert.equal(extractInstallments('parcelado em 4 no cartão'), 4);
  assert.equal(extractInstallments('dividido em 6'), 6);
  assert.equal(extractInstallments('dividi em 2'), 2);
});

test('NÃO dá falso-positivo (sem sinal de parcela)', () => {
  assert.equal(extractInstallments('comprei 3 camisetas por 90'), null);
  assert.equal(extractInstallments('comprei em 3 lojas diferentes'), null);
  assert.equal(extractInstallments('gastei R$ 3200 no mercado'), null);
  assert.equal(extractInstallments('reunião às 3 horas'), null);
  assert.equal(extractInstallments(''), null);
  assert.equal(extractInstallments(null), null);
});

test('reconcile: corrige quando LLM mandou 1x mas o texto diz Nx', () => {
  assert.deepEqual(reconcileInstallments(1, 'comprei TV 3200 em 10x no nubank'), { installments: 10, corrected: true });
  assert.deepEqual(reconcileInstallments(undefined, 'parcelei em 4'), { installments: 4, corrected: true });
});

test('reconcile: RESPEITA o LLM quando ele já parcelou (≥2)', () => {
  assert.deepEqual(reconcileInstallments(3, 'comprei TV em 10x'), { installments: 3, corrected: false });
  assert.deepEqual(reconcileInstallments(10, 'qualquer coisa'), { installments: 10, corrected: false });
});

test('reconcile: não mexe quando é à vista de verdade', () => {
  assert.deepEqual(reconcileInstallments(1, 'comprei um café por 8 reais'), { installments: 1, corrected: false });
});
