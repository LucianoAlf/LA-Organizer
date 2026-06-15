'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { truncateHistoryMsg } = require('./history-truncate');

// HIST-TRUNC-FATURA-BLIND (audit 15/06, caso Rose) — Lote C
// Regressão do TOM-SHORT-MEMORY-HISTORY5: blocos de fatura eram decapitados em 1000 chars.

test('truncateHistoryMsg: texto longo comum → trunca com marcador', () => {
  const long = 'x'.repeat(1500);
  const r = truncateHistoryMsg(long);
  assert.ok(r.length < long.length, 'deveria truncar');
  assert.ok(r.endsWith('…[mensagem longa truncada no histórico]'));
});

test('truncateHistoryMsg: [FATURA_JSON] longo → NÃO trunca (preserva inteiro) [Rose]', () => {
  const fatura = '[FATURA_JSON] ' + JSON.stringify(Array.from({ length: 31 }, (_, i) => ({ desc: 'Compra ' + i, valor: i * 10 })));
  assert.ok(fatura.length > 1000, 'fixture precisa ser > 1000 chars');
  assert.strictEqual(truncateHistoryMsg(fatura), fatura);
});

test('truncateHistoryMsg: [FATURA_TEXTO] longo → NÃO trunca', () => {
  const fatura = '[FATURA_TEXTO]\n' + 'Item de fatura linha\n'.repeat(120);
  assert.ok(fatura.length > 1000);
  assert.strictEqual(truncateHistoryMsg(fatura), fatura);
});

test('truncateHistoryMsg: mensagem curta → inalterada', () => {
  assert.strictEqual(truncateHistoryMsg('oi tudo bem'), 'oi tudo bem');
});

test('truncateHistoryMsg: null/undefined → string vazia', () => {
  assert.strictEqual(truncateHistoryMsg(null), '');
  assert.strictEqual(truncateHistoryMsg(undefined), '');
});
