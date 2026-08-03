'use strict';
// Cobertura do extrator do id da mensagem RECEBIDA.
//
// HONESTIDADE SOBRE ESTE ARQUIVO: extractMessageId já existia e já funcionava — isto é
// cobertura retroativa, não TDD. Escrevi porque a Fatia 3 inteira (dedupe de entrada e
// claim de inbound) passa a depender dela: se alguém mexer no extrator, o claim para de
// achar id e o TOM volta a poder responder duas vezes — falha silenciosa, sem exceção.
const test = require('node:test');
const assert = require('node:assert');
const { extractMessageId } = require('./inbound-message-id');

test('formato real da UAZAPI: EventType + message singular', () => {
  assert.equal(extractMessageId({ EventType: 'messages', message: { id: '3EB0ABCDEF123456' } }), '3EB0ABCDEF123456');
});

test('formato enriquecido: EventType + messages[]', () => {
  assert.equal(extractMessageId({ EventType: 'messages', messages: [{ id: '3EB0AAA11122233' }] }), '3EB0AAA11122233');
});

test('formato antigo: data', () => {
  assert.equal(extractMessageId({ data: { id: 'ABCD1234' } }), 'ABCD1234');
});

test('corpo cru sem envelope', () => {
  assert.equal(extractMessageId({ id: 'ABCD1234' }), 'ABCD1234');
});

test('variantes de nome do campo', () => {
  assert.equal(extractMessageId({ data: { messageid: 'MID12345' } }), 'MID12345');
  assert.equal(extractMessageId({ data: { message_id: 'MID54321' } }), 'MID54321');
  assert.equal(extractMessageId({ data: { key: { id: 'KEY98765' } } }), 'KEY98765');
});

// O claim de inbound trata null como "não sei identificar" e segue processando
// (fail-open). Estes casos são o gatilho desse caminho — precisam devolver null,
// nunca string vazia ou lixo, que viraria uma chave de dedupe falsa.
test('sem id devolve null, não string vazia', () => {
  assert.equal(extractMessageId({ data: {} }), null);
  assert.equal(extractMessageId({}), null);
  assert.equal(extractMessageId(null), null);
});

test('id curto demais é recusado (chave de dedupe não pode ser lixo)', () => {
  assert.equal(extractMessageId({ data: { id: 'abc' } }), null);
});

test('id não-string é recusado', () => {
  assert.equal(extractMessageId({ data: { id: 12345678 } }), null);
});

test('mensagem enviada por mim tem id igual ao das recebidas (mesmo extrator, mesma chave)', () => {
  // O ledger indexa outbound e inbound na MESMA coluna wa_message_id. Se os dois lados
  // não usarem o mesmo formato, um claim jamais encontraria o par.
  const { extractSentMessageId } = require('./sent-message-id');
  assert.equal(extractSentMessageId({ id: '3EB0FFFEEE111222' }), '3EB0FFFEEE111222');
  assert.equal(extractMessageId({ data: { id: '3EB0FFFEEE111222' } }), '3EB0FFFEEE111222');
});
