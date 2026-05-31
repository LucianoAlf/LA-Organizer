// src/finance/categories.data.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const { CATEGORIES, BY_SLUG, validSlugs, fallbackSlug } = require('./categories.data');

test('30 despesas + 13 receitas = 43', () => {
  assert.strictEqual(CATEGORIES.filter((c) => c.type === 'expense').length, 30);
  assert.strictEqual(CATEGORIES.filter((c) => c.type === 'income').length, 13);
});
test('slugs únicos', () => {
  assert.strictEqual(new Set(CATEGORIES.map((c) => c.slug)).size, 43);
});
test('todas têm label, emoji, color, type, keywords[]', () => {
  for (const c of CATEGORIES) {
    assert.ok(c.label && c.emoji && c.color && c.type, `incompleta: ${c.slug}`);
    assert.ok(Array.isArray(c.keywords), `keywords não-array: ${c.slug}`);
  }
});
test('fallbacks por tipo existem', () => {
  assert.strictEqual(fallbackSlug('expense'), 'outros');
  assert.strictEqual(fallbackSlug('income'), 'outras_receitas');
  assert.ok(BY_SLUG.outros && BY_SLUG.outras_receitas);
});
test('validSlugs filtra por tipo', () => {
  assert.ok(validSlugs('expense').has('beleza'));
  assert.ok(!validSlugs('expense').has('salario'));
  assert.ok(validSlugs('income').has('comissao'));
});
test('não existe categoria delivery (plataforma≠categoria)', () => {
  assert.ok(!BY_SLUG.delivery);
});
