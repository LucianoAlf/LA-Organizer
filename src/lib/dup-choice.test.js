'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { classifyDupChoice } = require('./dup-choice');

// dígitos (comportamento legado preservado)
test('dígito puro 1/2/3', () => {
  assert.strictEqual(classifyDupChoice('1'), '1');
  assert.strictEqual(classifyDupChoice('2'), '2');
  assert.strictEqual(classifyDupChoice('3'), '3');
});

test('dígito com pontuação/contexto', () => {
  assert.strictEqual(classifyDupChoice('2.'), '2');
  assert.strictEqual(classifyDupChoice('2 - cria mesmo'), '2');
  assert.strictEqual(classifyDupChoice('1, é a mesma'), '1');
});

// linguagem natural — opção 2 (outro caso / são diferentes)
test('NL opção 2: caso Juliana "São duas tarefas diferentes"', () => {
  assert.strictEqual(classifyDupChoice('São duas tarefas diferentes'), '2');
});

test('NL opção 2: variações', () => {
  assert.strictEqual(classifyDupChoice('são diferentes'), '2');
  assert.strictEqual(classifyDupChoice('é outra coisa'), '2');
  assert.strictEqual(classifyDupChoice('outro caso'), '2');
  assert.strictEqual(classifyDupChoice('cria separado'), '2');
  assert.strictEqual(classifyDupChoice('pode criar a nova'), '2');
  assert.strictEqual(classifyDupChoice('não é a mesma'), '2');
});

// linguagem natural — opção 1 (mesma situação)
test('NL opção 1: mesma situação', () => {
  assert.strictEqual(classifyDupChoice('é a mesma coisa'), '1');
  assert.strictEqual(classifyDupChoice('já tá coberta'), '1');
  assert.strictEqual(classifyDupChoice('é igual, deixa assim'), '1');
});

// linguagem natural — opção 3 (cancelar)
test('NL opção 3: cancelar', () => {
  assert.strictEqual(classifyDupChoice('cancela'), '3');
  assert.strictEqual(classifyDupChoice('deixa pra lá, vou reformular'), '3');
});

// NÃO casar (sem falso-positivo)
test('null: mensagens que não são resposta de dup', () => {
  assert.strictEqual(classifyDupChoice('comprar leite amanhã'), null);
  assert.strictEqual(classifyDupChoice('Dai do pedagógico'), null);
  assert.strictEqual(classifyDupChoice('qual o status do projeto X?'), null);
  assert.strictEqual(classifyDupChoice(''), null);
  assert.strictEqual(classifyDupChoice(null), null);
});

test('null: frase longa não é tratada como escolha NL', () => {
  // mensagem comprida (descrição de nova tarefa) não deve casar mesmo contendo "nova"
  const longo = 'cria uma tarefa nova pra mim de comprar material de limpeza e organizar o estoque da sala';
  assert.strictEqual(classifyDupChoice(longo), null);
});
