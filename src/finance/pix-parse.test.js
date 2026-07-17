'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { looksLikePixCopiaECola, extractPixCopiaECola, validatePixBRCode, extractPixKeyFromText } = require('./pix-parse');

// Fixture REAL: BR Code EMV válido (CRC F792 calculado pelo mesmo algoritmo). TEM espaços internos.
const BRCODE = '00020126360014BR.GOV.BCB.PIX0114+552199999999952040000530398654041.005802BR5909Fulano Tal6008Sao Paulo62070503***6304F792';

test('looksLikePixCopiaECola: TRUE num BR Code real', () => {
  assert.strictEqual(looksLikePixCopiaECola(BRCODE), true);
});
test('looksLikePixCopiaECola: FALSE em texto qualquer', () => {
  assert.strictEqual(looksLikePixCopiaECola('oi tom, paga a conta de luz'), false);
});
test('extractPixCopiaECola: extrai o BR Code de uma mensagem do zap', () => {
  assert.strictEqual(extractPixCopiaECola('paga esse pix ai tom: ' + BRCODE + ' obrigado'), BRCODE);
});
test('validatePixBRCode: o BR Code REAL passa (CRC bate)', () => {
  assert.strictEqual(validatePixBRCode(BRCODE).valid, true);
});
test('SEGURANÇA: 1 char trocado no payload REPROVA', () => {
  const adulterado = BRCODE.slice(0, 20) + (BRCODE[20] === '9' ? '8' : '9') + BRCODE.slice(21);
  assert.strictEqual(validatePixBRCode(adulterado).valid, false);
});
test('validatePixBRCode: NÃO strippa espaço interno (senão quebra o CRC do payload real)', () => {
  // o BRCODE tem "Fulano Tal" e "Sao Paulo" com espaço — se o validador stripasse, daria false
  assert.strictEqual(validatePixBRCode(BRCODE).valid, true);
});
test('extractPixKeyFromText: email após gatilho', () => {
  assert.strictEqual(extractPixKeyFromText('a chave pix é fulano@email.com'), 'fulano@email.com');
});
test('extractPixKeyFromText: CPF só-dígitos após gatilho', () => {
  assert.strictEqual(extractPixKeyFromText('chave pix 12345678901'), '12345678901');
});
test('extractPixKeyFromText: null sem gatilho', () => {
  assert.strictEqual(extractPixKeyFromText('paga amanhã por favor'), null);
});
