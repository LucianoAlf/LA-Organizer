'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { renderChecklistBlock, shouldAutocompleteParent } = require('./checklist-render');

const C = (title, status, sort_position) => ({ title, status, sort_position });
const five = [
  C('Mensagem enviada para o aluno', 'done', 1),
  C('Aluno respondeu', 'done', 2),
  C('Aluno pagou a mensalidade', 'done', 3),
  C('Trancamento do aluno realizado', 'done', 4),
  C('Confirmar matrícula', 'pending', 5),
];

// Paridade byte-a-byte com web/src/lib/taskChecklist.ts (renderChecklistBlock).
test('formato exato com nome (visão do delegador)', () => {
  assert.strictEqual(
    renderChecklistBlock(five, { assigneeName: 'John' }),
    '*Checklist* John: 4/5 ▓▓▓▓░\n' +
    '✅ Mensagem enviada para o aluno\n' +
    '✅ Aluno respondeu\n' +
    '✅ Aluno pagou a mensalidade\n' +
    '✅ Trancamento do aluno realizado\n' +
    '⬜ Confirmar matrícula',
  );
});
test('sem nome → label sem nome', () => {
  assert.strictEqual(renderChecklistBlock(five).split('\n')[0], '*Checklist:* 4/5 ▓▓▓▓░');
});
test('vazio → ""', () => assert.strictEqual(renderChecklistBlock([]), ''));
test('cancelled sai do total e da lista', () => {
  const out = renderChecklistBlock([C('a', 'done', 1), C('b', 'cancelled', 2), C('c', 'pending', 3)]);
  assert.strictEqual(out.split('\n')[0], '*Checklist:* 1/2 ▓░');
  assert.ok(!out.includes('b'));
});
test('ordena por sort_position', () => {
  const lines = renderChecklistBlock([C('segundo', 'pending', 2), C('primeiro', 'pending', 1)]).split('\n');
  assert.strictEqual(lines[1], '⬜ primeiro');
  assert.strictEqual(lines[2], '⬜ segundo');
});
test('N>10 escala a barra (cap 10)', () => {
  const big = Array.from({ length: 20 }, (_, i) => C(`i${i}`, i < 4 ? 'done' : 'pending', i + 1));
  assert.strictEqual(renderChecklistBlock(big).split('\n')[0], '*Checklist:* 4/20 ▓▓░░░░░░░░');
});
test('tudo feito → barra cheia', () => {
  assert.strictEqual(renderChecklistBlock([C('a', 'done', 1), C('b', 'done', 2)]).split('\n')[0], '*Checklist:* 2/2 ▓▓');
});

test('cascade: todas done → true', () => assert.strictEqual(shouldAutocompleteParent([C('a', 'done', 1), C('b', 'done', 2)]), true));
test('cascade: uma pendente → false', () => assert.strictEqual(shouldAutocompleteParent([C('a', 'done', 1), C('b', 'pending', 2)]), false));
test('cascade: vazio → false', () => assert.strictEqual(shouldAutocompleteParent([]), false));
test('cascade: cancelled ignorado, resto done → true', () => assert.strictEqual(shouldAutocompleteParent([C('a', 'done', 1), C('b', 'cancelled', 2)]), true));
test('cascade: só cancelled → false', () => assert.strictEqual(shouldAutocompleteParent([C('a', 'cancelled', 1)]), false));
