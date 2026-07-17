'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { buildBoletoPreview } = require('./boleto-preview');

test('prévia com código válido mostra ✅ e pergunta recorrência', () => {
  const msg = buildBoletoPreview({ beneficiario:'HDI Seguros', valor:995.93, vencimento:'2026-07-20', barcodeOk:true });
  assert.match(msg, /HDI Seguros/);
  assert.match(msg, /995,93/);
  assert.match(msg, /20\/07/);
  assert.match(msg, /✅/);
  assert.match(msg, /repete/i);
});

test('prévia com código ilegível mostra ⚠️ (não promete o número)', () => {
  const msg = buildBoletoPreview({ beneficiario:'HDI', valor:995.93, vencimento:'2026-07-20', barcodeOk:false });
  assert.match(msg, /⚠️|confere no boleto/i);
});

test('formata valor pt-BR e data dd/mm', () => {
  const msg = buildBoletoPreview({ beneficiario:'X', valor:1234.5, vencimento:'2026-12-05', barcodeOk:true });
  assert.match(msg, /1\.234,50/);
  assert.match(msg, /05\/12/);
});

test('sem beneficiário usa fallback "Boleto"', () => {
  const msg = buildBoletoPreview({ beneficiario:'', valor:10, vencimento:'2026-01-01', barcodeOk:true });
  assert.match(msg, /Boleto/);
});
