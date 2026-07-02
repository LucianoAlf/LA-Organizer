// Rodar: node --test src/lib/participant-edit.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const { planParticipantEdit } = require('./participant-edit');

test('add: só quem ainda não está', () => {
  const r = planParticipantEdit({ op: 'add', resolvedIds: ['a', 'b'], existingIds: ['a'], organizerId: 'o' });
  assert.deepStrictEqual(r.toAdd, ['b']);
  assert.deepStrictEqual(r.noops, ['a']);
  assert.deepStrictEqual(r.toRemove, []);
});

test('remove: só quem está', () => {
  const r = planParticipantEdit({ op: 'remove', resolvedIds: ['a', 'x'], existingIds: ['a', 'b'], organizerId: 'o' });
  assert.deepStrictEqual(r.toRemove, ['a']);
  assert.deepStrictEqual(r.noops, ['x']);
});

test('remover o organizador é rejeitado', () => {
  const r = planParticipantEdit({ op: 'remove', resolvedIds: ['o'], existingIds: ['o'], organizerId: 'o' });
  assert.deepStrictEqual(r.toRemove, []);
  assert.deepStrictEqual(r.rejected, ['o']);
});

test('add do organizador é rejeitado (já é dono)', () => {
  const r = planParticipantEdit({ op: 'add', resolvedIds: ['o'], existingIds: [], organizerId: 'o' });
  assert.deepStrictEqual(r.toAdd, []);
  assert.deepStrictEqual(r.rejected, ['o']);
});

test('dedup de ids repetidos na entrada', () => {
  const r = planParticipantEdit({ op: 'add', resolvedIds: ['b', 'b', 'b'], existingIds: [], organizerId: 'o' });
  assert.deepStrictEqual(r.toAdd, ['b']);
});

test('mix add: alguns novos, alguns já presentes', () => {
  const r = planParticipantEdit({ op: 'add', resolvedIds: ['a', 'b', 'c'], existingIds: ['b'], organizerId: 'o' });
  assert.deepStrictEqual(r.toAdd, ['a', 'c']);
  assert.deepStrictEqual(r.noops, ['b']);
});
