// node --test — resolveShareNames (nomes→ids, padrão comunicados: valida, não chuta)
const { test } = require('node:test');
const assert = require('node:assert');
const { resolveShareNames } = require('./notes');

const roster = [
  { id: 'id-ana', full_name: 'Ana Paula', preferred_name: null, is_active: true },
  { id: 'id-kri', full_name: 'Krissya', preferred_name: null, is_active: true },
  { id: 'id-anne', full_name: 'Anne', preferred_name: null, is_active: true },
  { id: 'id-rose', full_name: 'Rose', preferred_name: 'Rose', is_active: true },
];
const fakeSupabase = { from: () => ({ select: () => ({ eq: () => Promise.resolve({ data: roster }) }) }) };

test('match único por nome, case/acento-insensível', async () => {
  const r = await resolveShareNames(fakeSupabase, ['krissya']);
  assert.deepEqual(r.ids, ['id-kri']);
  assert.deepEqual(r.unresolved, []);
});

test('exato vence prefixo: "Ana" resolve Ana Paula (primeiro nome exato), não fica ambíguo com Anne', async () => {
  const r = await resolveShareNames(fakeSupabase, ['Ana']);
  assert.deepEqual(r.ids, ['id-ana']);
  assert.deepEqual(r.unresolved, []);
});

test('prefixo ambíguo (An → Ana Paula/Anne) vai pra unresolved', async () => {
  const r = await resolveShareNames(fakeSupabase, ['An']);
  assert.deepEqual(r.ids, []);
  assert.deepEqual(r.unresolved, ['An']);
});

test('não encontrado vai pra unresolved, demais resolvem; dedup de ids', async () => {
  const r = await resolveShareNames(fakeSupabase, ['Zé', 'Anne', 'anne']);
  assert.deepEqual(r.ids, ['id-anne']);
  assert.deepEqual(r.unresolved, ['Zé']);
});

test('preferred_name conta como exato', async () => {
  const r = await resolveShareNames(fakeSupabase, ['rose']);
  assert.deepEqual(r.ids, ['id-rose']);
});
