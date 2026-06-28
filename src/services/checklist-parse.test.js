'use strict';
// Backstop determinístico anti-confab (CHECKLIST-CREATE-CONFAB-NOSUBTASKS): deriva os itens de
// checklist da FALA do user quando o LLM emite create sem subtasks. Conservador — match errado =
// itens fantasma. Exige gatilho explícito ("com [os] itens/passos/...:" ou "com:") + >=2 itens.
const { test } = require('node:test');
const assert = require('node:assert');
const { parseInlineChecklist } = require('./checklist-parse');

test('caso Alf: "com os itens: A, B, C" → 3', () => {
  assert.deepStrictEqual(
    parseInlineChecklist('cria uma tarefa de teste com os itens: ligar pro aluno, mandar a mensagem, confirmar matrícula'),
    ['ligar pro aluno', 'mandar a mensagem', 'confirmar matrícula']
  );
});

test('"A, B e C" — último item com "e"', () => {
  assert.deepStrictEqual(parseInlineChecklist('tarefa com os itens: a, b e c'), ['a', 'b', 'c']);
});

test('"com:" simples', () => {
  assert.deepStrictEqual(parseInlineChecklist('cria tarefa X com: reservar local, mandar convite'), ['reservar local', 'mandar convite']);
});

test('gatilho "passos"', () => {
  assert.deepStrictEqual(parseInlineChecklist('abre a mudança com os passos: empacotar, alugar van, carregar'), ['empacotar', 'alugar van', 'carregar']);
});

test('gatilho com número: "com 3 itens:"', () => {
  assert.deepStrictEqual(parseInlineChecklist('cria tarefa com 3 itens: x, y, z'), ['x', 'y', 'z']);
});

test('bullets / quebra de linha', () => {
  assert.deepStrictEqual(parseInlineChecklist('tarefa com os itens:\n- comprar\n- montar\n- testar'), ['comprar', 'montar', 'testar']);
});

test('gatilho "checklist"', () => {
  assert.deepStrictEqual(parseInlineChecklist('cria com checklist: a, b'), ['a', 'b']);
});

// --- NEGATIVOS (anti over-trigger) ---
test('sem gatilho: "com manteiga" NÃO é lista', () => {
  assert.deepStrictEqual(parseInlineChecklist('cria tarefa de comprar pão com manteiga'), []);
});

test('só 1 item → [] (não é checklist)', () => {
  assert.deepStrictEqual(parseInlineChecklist('cria tarefa com os itens: só uma coisa'), []);
});

test('gatilho sem dois-pontos → [] (evita falso positivo)', () => {
  assert.deepStrictEqual(parseInlineChecklist('cria tarefa com os itens essenciais hoje'), []);
});

test('vazio / null → []', () => {
  assert.deepStrictEqual(parseInlineChecklist(''), []);
  assert.deepStrictEqual(parseInlineChecklist(null), []);
});

test('cap em 15 itens', () => {
  const many = Array.from({ length: 20 }, (_, i) => `item${i}`).join(', ');
  assert.strictEqual(parseInlineChecklist(`com os itens: ${many}`).length, 15);
});

test('descarta item gigante (>80 chars), mantém os válidos (>=2)', () => {
  const big = 'x'.repeat(90);
  assert.deepStrictEqual(parseInlineChecklist(`com os itens: ${big}, normal um, normal dois`), ['normal um', 'normal dois']);
});
