'use strict';
// Núcleo anti-confab da action mark-item: resolver QUAL filha o TOM citou, sem chutar.
// Match errado = marcar o item errado = confabulação/corrupção. Regra: exato único > parcial
// único; 0 ou 2+ → null (TOM pergunta, não adivinha). Acento-insensível (LLM varia "matrícula").
const { test } = require('node:test');
const assert = require('node:assert');
const { resolveChildByTitle, normalize } = require('./checklist-resolve');

const C = (title, status = 'pending', sort_position = 1) => ({ id: title, title, status, sort_position });
const five = [
  C('Mensagem enviada para o aluno', 'done', 1),
  C('Aluno respondeu', 'done', 2),
  C('Aluno pagou a mensalidade', 'done', 3),
  C('Trancamento do aluno realizado', 'done', 4),
  C('Confirmar matrícula', 'pending', 5),
];

test('match exato único → retorna a filha', () => {
  assert.strictEqual(resolveChildByTitle(five, 'Confirmar matrícula').title, 'Confirmar matrícula');
});

test('acento-insensível: "confirmar matricula" casa "Confirmar matrícula"', () => {
  assert.strictEqual(resolveChildByTitle(five, 'confirmar matricula').title, 'Confirmar matrícula');
});

test('parcial único: "pagou a mensalidade" casa "Aluno pagou a mensalidade"', () => {
  assert.strictEqual(resolveChildByTitle(five, 'pagou a mensalidade').title, 'Aluno pagou a mensalidade');
});

test('parcial: a fala contém o título do item (query maior que o item)', () => {
  // TOM emite o título canônico do contexto, mas tolera a fala literal envolvendo o item.
  assert.strictEqual(resolveChildByTitle([C('Aluno respondeu')], 'o aluno respondeu sim ontem').title, 'Aluno respondeu');
});

test('ambíguo (2+ contêm "aluno") → null (não chuta)', () => {
  assert.strictEqual(resolveChildByTitle(five, 'aluno'), null);
});

test('nenhum match → null (não chuta)', () => {
  assert.strictEqual(resolveChildByTitle(five, 'comprar lanche'), null);
});

test('query vazia → null', () => {
  assert.strictEqual(resolveChildByTitle(five, ''), null);
  assert.strictEqual(resolveChildByTitle(five, null), null);
});

test('cancelled sai da resolução', () => {
  const list = [C('Comprar lanche', 'cancelled', 1), C('Reservar local', 'pending', 2)];
  assert.strictEqual(resolveChildByTitle(list, 'comprar lanche'), null); // cancelado não conta
  assert.strictEqual(resolveChildByTitle(list, 'reservar local').title, 'Reservar local');
});

test('lista vazia/nula → null', () => {
  assert.strictEqual(resolveChildByTitle([], 'x'), null);
  assert.strictEqual(resolveChildByTitle(null, 'x'), null);
});

test('exato vence parcial: "Aluno respondeu" não cai em ambiguidade de parcial', () => {
  // "Aluno respondeu" é exato de 1; mesmo que "aluno" apareça em vários, o exato manda.
  assert.strictEqual(resolveChildByTitle(five, 'Aluno respondeu').title, 'Aluno respondeu');
});

test('normalize: minúsculas, sem acento, trim', () => {
  assert.strictEqual(normalize('  Matrícula É Ótima  '), 'matricula e otima');
});
