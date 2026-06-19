'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { updateAffected } = require('./task-update-result');

test('>=1 linha sem erro → afetado', () => {
  assert.strictEqual(updateAffected({ data: [{ id: 'a' }], error: null }), true);
  assert.strictEqual(updateAffected({ data: [{ id: 'a' }, { id: 'b' }], error: null }), true);
});

test('0 linhas → NÃO afetado (o bug do "concluí" mentiroso)', () => {
  assert.strictEqual(updateAffected({ data: [], error: null }), false);
});

test('sem .select() (data null) → NÃO afetado', () => {
  assert.strictEqual(updateAffected({ data: null, error: null }), false);
});

test('erro presente → NÃO afetado, mesmo com data', () => {
  assert.strictEqual(updateAffected({ data: [{ id: 'a' }], error: { message: 'boom' } }), false);
});

test('null/undefined → NÃO afetado', () => {
  assert.strictEqual(updateAffected(null), false);
  assert.strictEqual(updateAffected(undefined), false);
});
