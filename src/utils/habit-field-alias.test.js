const { test } = require('node:test');
const assert = require('node:assert');
const { normalizeHabitAliases } = require('./habit-field-alias');

// HABIT-FIELD-ALIAS-HABIT (Ana Paula 08/07 21:09): o LLM emitiu
// [{"action":"log","habit":"Ir para academia"},{"action":"log","habit":"Usar bombinha Asma Alice"}]
// → schema_invalid (o fallback de aliases cobria habit_slug/title, não `habit`).
// O chokepoint segurou a mentira, mas a ação se perdeu ("não executei, me pede de novo").

test('caso Ana Paula REAL: log com `habit` → habit_name', () => {
  const a = { action: 'log', habit: 'Ir para academia' };
  normalizeHabitAliases(a);
  assert.strictEqual(a.habit_name, 'Ir para academia');
});

test('aliases atuais preservados: habit_slug (com troca de -/_) e title', () => {
  const slug = { action: 'log', habit_slug: 'usar-bombinha_asma' };
  normalizeHabitAliases(slug);
  assert.strictEqual(slug.habit_name, 'usar bombinha asma');

  const title = { action: 'delete', title: 'Beber água' };
  normalizeHabitAliases(title);
  assert.strictEqual(title.habit_name, 'Beber água');
});

test('precedência: habit_slug > habit > title', () => {
  const a = { action: 'log', habit_slug: 'do-slug', habit: 'do habit', title: 'do title' };
  normalizeHabitAliases(a);
  assert.strictEqual(a.habit_name, 'do slug');

  const b = { action: 'log', habit: 'do habit', title: 'do title' };
  normalizeHabitAliases(b);
  assert.strictEqual(b.habit_name, 'do habit');
});

test('NÃO clobber: habit_id ou habit_name presentes → intacto', () => {
  const withId = { action: 'log', habit_id: 'x1', habit: 'outra coisa' };
  normalizeHabitAliases(withId);
  assert.strictEqual(withId.habit_name, undefined);

  const withName = { action: 'log', habit_name: 'oficial', habit: 'alias' };
  normalizeHabitAliases(withName);
  assert.strictEqual(withName.habit_name, 'oficial');
});

test('create: title → name (comportamento atual); não mexe em habit_name', () => {
  const a = { action: 'create', title: 'Ir pra academia' };
  normalizeHabitAliases(a);
  assert.strictEqual(a.name, 'Ir pra academia');
  assert.strictEqual(a.habit_name, undefined);
});

test('create com name já definido → não sobrescreve', () => {
  const a = { action: 'create', name: 'Oficial', title: 'Alias' };
  normalizeHabitAliases(a);
  assert.strictEqual(a.name, 'Oficial');
});

test('query_progress também normaliza; ação fora da lista não mexe', () => {
  const q = { action: 'query_progress', habit: 'Leitura' };
  normalizeHabitAliases(q);
  assert.strictEqual(q.habit_name, 'Leitura');

  const other = { action: 'update', habit: 'Leitura' };
  normalizeHabitAliases(other);
  assert.strictEqual(other.habit_name, undefined);
});

test('defensivo: null/não-objeto/valores não-string não quebram', () => {
  assert.doesNotThrow(() => normalizeHabitAliases(null));
  assert.doesNotThrow(() => normalizeHabitAliases('x'));
  const a = { action: 'log', habit: 123 };
  normalizeHabitAliases(a);
  assert.strictEqual(a.habit_name, undefined);
});
