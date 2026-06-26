'use strict';
// Caminho 2 / Fatia 1 — cobertura das frases que caíram no LLM no E2E do Alf (review 24/06).
// detectFinanceEditIntent (intent loose p/ redirect) + detectCorrection estendido (execute in-window).
const test = require('node:test');
const assert = require('node:assert');
const { detectCorrection, detectFinanceEditIntent } = require('./detect-correction');

// ── detectFinanceEditIntent (gate do redirect honesto, não precisa do alvo) ──
test('intent: "altera o valor do lançamento de ontem" → edit (caiu no LLM antes)', () => {
  assert.deepEqual(detectFinanceEditIntent('altera o valor do lançamento de ontem pra 50'), { op: 'edit' });
});
test('intent: "corrige a categoria daquele gasto da semana passada" → edit (caiu no LLM antes)', () => {
  assert.deepEqual(detectFinanceEditIntent('corrige a categoria daquele gasto da semana passada'), { op: 'edit' });
});
test('intent: "apaga o lançamento de 3 dias atrás" → delete', () => {
  assert.deepEqual(detectFinanceEditIntent('apaga o lançamento de lanche de 3 dias atrás'), { op: 'delete' });
});
test('intent: "muda a categoria do lançamento de 2 dias atrás" → edit', () => {
  assert.deepEqual(detectFinanceEditIntent('muda a categoria do meu lançamento de 2 dias atrás pra alimentação'), { op: 'edit' });
});
test('intent NÃO flagra META (não é transação) — anti falso-positivo', () => {
  assert.equal(detectFinanceEditIntent('altera o valor da meta pra 50'), null);
});
test('intent NÃO flagra conversa solta', () => {
  assert.equal(detectFinanceEditIntent('muda de assunto'), null);
  assert.equal(detectFinanceEditIntent('corrige aí o texto pra mim'), null);
});

// ── detectCorrection estendido (execute in-window) ──
test('detectCorrection: "altera o valor pra 50" → edit amount (verbo novo)', () => {
  assert.deepEqual(detectCorrection('altera o valor pra 50'), { op: 'edit', amount: 50 });
});
test('detectCorrection: "corrige a categoria pra lazer" → edit category (verbo novo)', () => {
  assert.deepEqual(detectCorrection('corrige a categoria pra lazer'), { op: 'edit', category: 'lazer' });
});
test('detectCorrection: regressão — "era 25" segue funcionando', () => {
  assert.deepEqual(detectCorrection('era 25'), { op: 'edit', amount: 25 });
});
