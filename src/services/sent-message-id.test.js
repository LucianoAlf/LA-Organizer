// src/services/sent-message-id.test.js
// Rodar: node --test src/services/sent-message-id.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const { extractSentMessageId } = require('./sent-message-id');

test('campo id', () => assert.strictEqual(extractSentMessageId({ id: 'ABC123' }), 'ABC123'));
test('campo messageid', () => assert.strictEqual(extractSentMessageId({ messageid: 'XYZ789' }), 'XYZ789'));
test('campo message_id', () => assert.strictEqual(extractSentMessageId({ message_id: 'M42abc' }), 'M42abc'));
test('key.id aninhado', () => assert.strictEqual(extractSentMessageId({ key: { id: 'K9authz' } }), 'K9authz'));
test('message.id aninhado', () => assert.strictEqual(extractSentMessageId({ message: { id: 'NEST01' } }), 'NEST01'));
test('id curto (<4 chars) é ignorado', () => assert.strictEqual(extractSentMessageId({ id: 'ab' }), null));
test('nulo/vazio/string → null', () => {
  assert.strictEqual(extractSentMessageId(null), null);
  assert.strictEqual(extractSentMessageId({}), null);
  assert.strictEqual(extractSentMessageId('x'), null);
});
