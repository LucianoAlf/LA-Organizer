// src/services/group-chat-bridge-in.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const { extractGroupJid, extractSenderPhone, isGroupMessage, matchMemberByName, normalizeName, resolveMentions, mediaKindFromBody } = require('./group-chat-bridge-in');

const { parseDeletedWaIds } = require('./group-chat-bridge-in');
test('parseDeletedWaIds extrai MessageIDs só com sinal de deleção (formato real UAZAPI)', () => {
  assert.deepEqual(parseDeletedWaIds({ EventType: 'messages_update', type: 'DeletedMessage', event: { MessageIDs: ['AAA'], Type: 'Deleted' } }), ['AAA']);
  assert.deepEqual(parseDeletedWaIds({ EventType: 'messages_update', state: 'Deleted', event: { MessageIDs: ['BBB', 'CCC'] } }), ['BBB', 'CCC']);
  assert.deepEqual(parseDeletedWaIds({ EventType: 'messages_update', event: { MessageIDs: ['X'], Type: 'Read' } }), []);
  assert.deepEqual(parseDeletedWaIds({ EventType: 'messages', event: { MessageIDs: ['D'] } }), []);
});

test('mediaKindFromBody detecta image/audio/pdf/null', () => {
  const detectors = {
    isAudioMessage: (b) => b.t === 'audio',
    isImageMessage: (b) => b.t === 'image',
    isDocumentMessage: (b) => b.t === 'doc',
  };
  assert.equal(mediaKindFromBody({ t: 'audio' }, detectors), 'audio');
  assert.equal(mediaKindFromBody({ t: 'image' }, detectors), 'image');
  assert.equal(mediaKindFromBody({ t: 'doc' }, detectors), 'pdf');
  assert.equal(mediaKindFromBody({ t: 'text' }, detectors), null);
});

test('resolveMentions troca @lid pelo @PrimeiroNome', () => {
  const map = { '61087554768984': 'Rose', '83245123301394': 'Ana' };
  assert.equal(
    resolveMentions('Ai @61087554768984 @83245123301394 kkk', map),
    'Ai @Rose @Ana kkk'
  );
});
test('resolveMentions deixa @lid desconhecido como está', () => {
  assert.equal(resolveMentions('oi @99999999999 tudo bem', { '11111': 'X' }), 'oi @99999999999 tudo bem');
});
test('resolveMentions sem mapa/texto não quebra', () => {
  assert.equal(resolveMentions('texto sem mencao', null), 'texto sem mencao');
  assert.equal(resolveMentions('', { a: 'b' }), '');
});

const MEMBERS = [
  { id: 'alf', full_name: 'Luciano Alf', preferred_name: 'Alf' },
  { id: 'rose', full_name: 'Rose', preferred_name: 'Rose' },
  { id: 'ana', full_name: 'Ana Paula', preferred_name: 'Ana' },
];

test('matchMemberByName: nome exato do WhatsApp casa pelo full_name', () => {
  assert.equal(matchMemberByName('Luciano Alf', MEMBERS), 'alf');
});
test('matchMemberByName: "Rose_Gerente Recreio" casa pelo começo', () => {
  assert.equal(matchMemberByName('Rose_Gerente Recreio', MEMBERS), 'rose');
});
test('matchMemberByName: "Ana Paula Recepção/ADM" pega o nome mais longo (ana paula > ana)', () => {
  assert.equal(matchMemberByName('Ana Paula Recepção/ADM', MEMBERS), 'ana');
});
test('matchMemberByName: nome de fora do grupo → null', () => {
  assert.equal(matchMemberByName('Fulano de Tal', MEMBERS), null);
  assert.equal(matchMemberByName('', MEMBERS), null);
});
test('normalizeName tira acento e símbolos', () => {
  assert.equal(normalizeName('Ana Paula Recepção/ADM'), 'ana paula recepcao adm');
});

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
