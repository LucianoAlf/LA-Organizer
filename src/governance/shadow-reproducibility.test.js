const { test } = require('node:test');
const assert = require('node:assert');
const { isReproducible } = require('./shadow-reproducibility');

test('turno curto de confab é reproduzível', () => {
  const r = isReproducible({ category: 'confabulation', summary: 'TOM disse que criou mas nada persistiu', evidence: 'USUÁRIO: cria X\nTOM: ✅ criei', group_id: null });
  assert.strictEqual(r.ok, true);
});
test('finding de grupo NÃO é reproduzível (v1)', () => {
  assert.strictEqual(isReproducible({ category: 'confabulation', group_id: 'g1', evidence: 'x' }).ok, false);
});
test('categoria de cron/multi-turno NÃO é reproduzível', () => {
  assert.strictEqual(isReproducible({ category: 'media_fail', evidence: 'cobrança diária' }).ok, false);
  assert.strictEqual(isReproducible({ category: 'confabulation', evidence: 'fatura parte 1 parte 2 parte 3' }).ok, false);
});
test('sem evidência aferível → não reproduzível', () => {
  for (const v of [null, undefined, {}, { category: 'confabulation' }]) assert.strictEqual(isReproducible(v).ok, false);
});
