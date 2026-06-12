// src/services/group-chat-bridge-in.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const { extractGroupJid, extractSenderPhone, isGroupMessage } = require('./group-chat-bridge-in');

test('isGroupMessage true só quando data.isGroup === true', () => {
  assert.equal(isGroupMessage({ data: { isGroup: true } }), true);
  assert.equal(isGroupMessage({ data: { isGroup: false } }), false);
  assert.equal(isGroupMessage({ data: {} }), false);
  assert.equal(isGroupMessage({}), false);
});
test('extractGroupJid pega data.chatid', () => {
  assert.equal(extractGroupJid({ data: { chatid: '12345@g.us' } }), '12345@g.us');
  assert.equal(extractGroupJid({ data: {} }), null);
});
test('extractSenderPhone tira só dígitos do participante', () => {
  assert.equal(extractSenderPhone({ data: { sender: '5521999998888@s.whatsapp.net' } }), '5521999998888');
  assert.equal(extractSenderPhone({ data: { sender: '' } }), null);
});
