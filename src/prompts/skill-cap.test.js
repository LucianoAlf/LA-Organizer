// src/prompts/skill-cap.test.js
// Trava o teto de skills (Fatia A). Rodar: node --test src/prompts/skill-cap.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const { capSkill, SKILL_MAX_CHARS } = require('./skill-cap');

test('teto é 40960 (checklist-tarefas passou de 32k em 07/07 e estava sendo TRUNCADA)', () => {
  assert.strictEqual(SKILL_MAX_CHARS, 40960);
});

test('conteúdo ≤ teto volta INTEIRO (não corta mais nas skills reais)', () => {
  const s = 'a'.repeat(20000); // ~financeiro-pessoal (19.865) cabe inteiro
  assert.strictEqual(capSkill(s, 'x').length, 20000);
});

test('conteúdo no limiar antigo (8192-23475) volta inteiro, não cortado em 8192', () => {
  const s = 'b'.repeat(23475); // checklist-tarefas
  assert.strictEqual(capSkill(s, 'checklist-tarefas').length, 23475);
});

test('checklist-tarefas atual (34.5k) volta INTEIRA — o caso real de 07/07', () => {
  const s = 'd'.repeat(34518);
  assert.strictEqual(capSkill(s, 'checklist-tarefas').length, 34518);
});

test('conteúdo > teto corta no teto (rede de proteção)', () => {
  const s = 'c'.repeat(50000);
  assert.strictEqual(capSkill(s, 'gigante').length, 40960);
});

test('null/undefined/vazio → "" sem quebrar', () => {
  assert.strictEqual(capSkill(null, 'x'), '');
  assert.strictEqual(capSkill(undefined, 'x'), '');
  assert.strictEqual(capSkill('', 'x'), '');
});

test('teto custom respeitado', () => {
  assert.strictEqual(capSkill('abcdef', 'x', 3), 'abc');
});
