'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { classifyDupChoice, pickFreshDupBypassIntent } = require('./dup-choice');

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

// ── pickFreshDupBypassIntent (DUP-BYPASS-STALE-BIND, Arthur 23/06) ──
const dupIntent = (over = {}) => ({
  id: 'i1', kind: 'task_creation', asked_at: new Date().toISOString(),
  payload: { _dup_bypass: true, drafts: [{ title: 'X' }] }, ...over,
});

test('pickFreshDupBypassIntent: dup recente → retorna a intent', () => {
  const i = dupIntent();
  assert.strictEqual(pickFreshDupBypassIntent([i]), i);
});

test('pickFreshDupBypassIntent: dup stale (5h) → null (caso Arthur)', () => {
  const stale = dupIntent({ asked_at: new Date(Date.now() - 5 * 3600 * 1000).toISOString() });
  assert.strictEqual(pickFreshDupBypassIntent([stale]), null);
});

test('pickFreshDupBypassIntent: ignora sem _dup_bypass / sem drafts / outro kind / sem asked_at', () => {
  assert.strictEqual(pickFreshDupBypassIntent([{ kind: 'task_creation', asked_at: new Date().toISOString(), payload: {} }]), null);
  assert.strictEqual(pickFreshDupBypassIntent([dupIntent({ payload: { _dup_bypass: true, drafts: [] } })]), null);
  assert.strictEqual(pickFreshDupBypassIntent([dupIntent({ kind: 'confirmation' })]), null);
  assert.strictEqual(pickFreshDupBypassIntent([dupIntent({ asked_at: null })]), null);
});

test('pickFreshDupBypassIntent: pega a fresca ignorando a stale', () => {
  const stale = dupIntent({ id: 'old', asked_at: new Date(Date.now() - 3 * 3600 * 1000).toISOString() });
  const fresh = dupIntent({ id: 'new', asked_at: new Date().toISOString() });
  assert.strictEqual(pickFreshDupBypassIntent([stale, fresh]).id, 'new');
});

test('pickFreshDupBypassIntent: lista vazia / não-array → null', () => {
  assert.strictEqual(pickFreshDupBypassIntent([]), null);
  assert.strictEqual(pickFreshDupBypassIntent(null), null);
});
