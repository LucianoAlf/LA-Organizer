// src/services/proactive-link.test.js
// Rodar: node --test src/services/proactive-link.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const { buildProactiveLogRow } = require('./proactive-link');

test('row completa com vínculo (reusa coluna whatsapp_message_id)', () => {
  assert.deepStrictEqual(
    buildProactiveLogRow({ collaboratorId: 'c1', waMessageId: 'WA1', refType: 'task', refId: 't1', content: 'oi' }),
    { collaborator_id: 'c1', direction: 'outbound', message_type: 'text', content: 'oi', whatsapp_message_id: 'WA1', ref_type: 'task', ref_id: 't1' }
  );
});

test('sem waMessageId → grava sem vínculo (não quebra)', () => {
  assert.deepStrictEqual(
    buildProactiveLogRow({ collaboratorId: 'c1', content: 'oi' }),
    { collaborator_id: 'c1', direction: 'outbound', message_type: 'text', content: 'oi' }
  );
});

test('waMessageId sem ref → grava só o id (ainda casável)', () => {
  assert.deepStrictEqual(
    buildProactiveLogRow({ collaboratorId: 'c1', waMessageId: 'WA1', content: 'oi' }),
    { collaborator_id: 'c1', direction: 'outbound', message_type: 'text', content: 'oi', whatsapp_message_id: 'WA1' }
  );
});

test('ref sem id ou id sem type → não grava vínculo parcial', () => {
  const r = buildProactiveLogRow({ collaboratorId: 'c1', waMessageId: 'WA1', refType: 'task', content: 'oi' });
  assert.strictEqual(r.ref_type, undefined);
  assert.strictEqual(r.ref_id, undefined);
});
