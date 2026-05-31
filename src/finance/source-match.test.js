const { test } = require('node:test');
const assert = require('node:assert');
const { matchSourceReply } = require('./source-match');

const listPayload = {
  form: 'list',
  candidates: [
    { kind: 'account', id: 'a1', name: 'Itaú' },
    { kind: 'card',    id: 'c1', name: 'Nubank' },
    { kind: 'cash',    id: null, name: 'Dinheiro' },
  ],
};

test('list: casa por número 1-based', () => {
  assert.deepStrictEqual(matchSourceReply('2', listPayload), { kind: 'card', id: 'c1', name: 'Nubank' });
});
test('list: casa por nome (substring, case-insensitive)', () => {
  assert.deepStrictEqual(matchSourceReply('no nubank', listPayload), { kind: 'card', id: 'c1', name: 'Nubank' });
});
test('list: "dinheiro" casa o candidato cash', () => {
  assert.deepStrictEqual(matchSourceReply('foi em dinheiro', listPayload), { kind: 'cash', id: null, name: 'Dinheiro' });
});
test('list: resposta off-topic não casa', () => {
  assert.strictEqual(matchSourceReply('amanhã te falo', listPayload), null);
});
test('list: número fora do range não casa', () => {
  assert.strictEqual(matchSourceReply('9', listPayload), null);
});

const binaryPayload = {
  form: 'binary',
  account: { kind: 'account', id: 'a9', name: 'Nubank' },
  card:    { kind: 'card',    id: 'c9', name: 'Nubank' },
};

test('binary: "cartão" → card', () => {
  assert.deepStrictEqual(matchSourceReply('foi no cartão', binaryPayload), { kind: 'card', id: 'c9', name: 'Nubank' });
});
test('binary: "crédito" → card', () => {
  assert.deepStrictEqual(matchSourceReply('crédito', binaryPayload), { kind: 'card', id: 'c9', name: 'Nubank' });
});
test('binary: "conta"/"carteira"/"débito" → account', () => {
  assert.deepStrictEqual(matchSourceReply('na conta', binaryPayload), { kind: 'account', id: 'a9', name: 'Nubank' });
  assert.deepStrictEqual(matchSourceReply('foi no débito', binaryPayload), { kind: 'account', id: 'a9', name: 'Nubank' });
});
test('binary: ambíguo continua null', () => {
  assert.strictEqual(matchSourceReply('sei lá', binaryPayload), null);
});
test('texto vazio/longo não casa', () => {
  assert.strictEqual(matchSourceReply('', listPayload), null);
  assert.strictEqual(matchSourceReply('x'.repeat(250), listPayload), null);
});
