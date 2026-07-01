// Rodar: node --test src/lib/resolve-attendees.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const { resolveAttendees } = require('./resolve-attendees');

// resolvedor-stub: nomes conhecidos → resolved; resto → not_found
const DB = { 'anne': { id: 'a1', full_name: 'Anne' }, 'quintela': { id: 'q1', full_name: 'Quintela' }, 'yuri': { id: 'y1', full_name: 'Yuri' } };
const stub = async (name) => {
  const c = DB[name.trim().toLowerCase()];
  return c ? { status: 'resolved', collaborator: c } : { status: 'not_found', collaborator: null };
};

test('todos resolvem', async () => {
  const r = await resolveAttendees(['Anne', 'Quintela', 'Yuri'], stub);
  assert.strictEqual(r.resolved.length, 3);
  assert.deepStrictEqual(r.unresolved, []);
  assert.strictEqual(r.resolved[0].collaborator.id, 'a1');
});

test('parcial: 2 resolvem, 1 não → unresolved preserva o nome', async () => {
  const r = await resolveAttendees(['Anne', 'Fulano', 'Yuri'], stub);
  assert.strictEqual(r.resolved.length, 2);
  assert.deepStrictEqual(r.unresolved, ['Fulano']);
});

test('dedup: mesma pessoa duas vezes entra uma vez', async () => {
  const r = await resolveAttendees(['Anne', 'anne', 'ANNE'], stub);
  assert.strictEqual(r.resolved.length, 1);
});

test('vazio/nulo/espaços → seguro', async () => {
  assert.deepStrictEqual(await resolveAttendees([], stub), { resolved: [], unresolved: [] });
  assert.deepStrictEqual(await resolveAttendees(null, stub), { resolved: [], unresolved: [] });
  const r = await resolveAttendees(['  ', 'Anne'], stub);
  assert.strictEqual(r.resolved.length, 1);
  assert.deepStrictEqual(r.unresolved, []);
});
