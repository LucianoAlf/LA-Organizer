'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const {
  looksLikeBoleto, extractLinhaDigitavel, validateLinhaDigitavel,
  formatLinhaDigitavel, parseBoletoValor,
} = require('./boleto-parse');

// Fixture REAL: boleto HDI (Santander) do Alf, 17/07. 47 dígitos.
const HDI = '03399745031090000927472059001015615130000099593';
const HDI_FMT = '03399.74503 10900.009274 72059.001015 6 15130000099593';

const BOLETO_TXT = `HDI SEGUROS S.A.
Beneficiário: HDI SEGUROS S.A.
Pagador: ANNE SUSAN CORDEIRO TEIXEIRA
Vencimento: 20/07/2026   Valor do Documento: R$ 995,93
Linha digitável: ${HDI_FMT}
Nosso número: 72059.001015`;

const FATURA_TXT = `Fatura Nubank
Vencimento da fatura 10/07/2026
Limite disponível R$ 3.000
Compras: 12 · total R$ 640,88
Cartão final 4520`;

test('looksLikeBoleto: TRUE no boleto real (linha digitável + vocabulário)', () => {
  assert.strictEqual(looksLikeBoleto(BOLETO_TXT), true);
});
test('looksLikeBoleto: FALSE numa fatura de cartão (regressão a evitar)', () => {
  assert.strictEqual(looksLikeBoleto(FATURA_TXT), false);
});
test('looksLikeBoleto: FALSE em texto sem linha digitável (recibo genérico)', () => {
  assert.strictEqual(looksLikeBoleto('Recibo de pagamento no valor de R$ 50,00'), false);
});
test('extractLinhaDigitavel: extrai os 47 dígitos do texto formatado', () => {
  assert.strictEqual(extractLinhaDigitavel(BOLETO_TXT), HDI);
});
test('extractLinhaDigitavel: null quando não há linha digitável', () => {
  assert.strictEqual(extractLinhaDigitavel(FATURA_TXT), null);
});
test('validateLinhaDigitavel: o boleto REAL passa (DV bate)', () => {
  const r = validateLinhaDigitavel(HDI);
  assert.strictEqual(r.valid, true);
  assert.strictEqual(r.tipo, 'bancario');
});
test('SEGURANÇA: 1 dígito trocado REPROVA (protege o pagamento)', () => {
  const adulterado = HDI.slice(0, 19) + (HDI[19] === '9' ? '8' : '9') + HDI.slice(20);
  assert.strictEqual(validateLinhaDigitavel(adulterado).valid, false);
});
test('validateLinhaDigitavel: comprimento errado (46) reprova', () => {
  assert.strictEqual(validateLinhaDigitavel(HDI.slice(0, 46)).valid, false);
});
test('parseBoletoValor: lê R$ 995,93 do campo de valor', () => {
  assert.strictEqual(parseBoletoValor(HDI), 995.93);
});
test('formatLinhaDigitavel: devolve a pontuação padrão pra copiar', () => {
  assert.strictEqual(formatLinhaDigitavel(HDI), HDI_FMT);
});
