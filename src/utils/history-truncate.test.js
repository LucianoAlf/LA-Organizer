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

// HIST-TRUNC-LIST-BLIND (Leo 18/06, finding 29b8751b) — Lote inventário
// Lista de 90 itens (2259 chars, 95 quebras) foi decapitada em 1000 chars no histórico →
// 4 turnos depois o TOM confabulou "a lista chegou cortada, só vejo até o item 38".
// Lista multi-linha é item-bearing igual à fatura → preserva inteira até um teto.
test('truncateHistoryMsg: lista multi-linha longa (Leo, 90 itens) → NÃO trunca', () => {
  const lista = Array.from({ length: 90 }, (_, i) => `Item numero ${i + 1} da sala\t${(i % 3) + 1}`).join('\n');
  assert.ok(lista.length > 1000, 'fixture precisa ser > 1000 chars');
  assert.ok((lista.match(/\n/g) || []).length >= 8, 'fixture precisa parecer lista');
  assert.strictEqual(truncateHistoryMsg(lista), lista);
});

test('truncateHistoryMsg: lista ACIMA do teto → corta em fronteira de linha + marcador', () => {
  const lista = Array.from({ length: 500 }, (_, i) => `Linha de item bem descritiva numero ${i + 1}`).join('\n');
  const r = truncateHistoryMsg(lista);
  assert.ok(r.length < lista.length, 'deveria truncar acima do teto');
  assert.ok(r.endsWith('…[lista longa truncada no histórico]'));
  // corte em fronteira de linha: o pedaço antes do marcador não termina no meio de uma linha
  const corpo = r.replace(/\n…\[lista longa truncada no histórico\]$/, '');
  assert.ok(lista.startsWith(corpo), 'o corpo preservado é prefixo exato da lista original');
  assert.ok(lista[corpo.length] === '\n', 'o corte cai numa quebra de linha');
});

test('truncateHistoryMsg: prosa longa com poucas quebras → ainda trunca em 1000 (custo)', () => {
  const prosa = 'palavra '.repeat(300); // ~2400 chars, 0 newlines
  const r = truncateHistoryMsg(prosa);
  assert.ok(r.length < prosa.length && r.length <= 1100, 'prosa segue truncada por custo');
  assert.ok(r.endsWith('…[mensagem longa truncada no histórico]'));
});

test('truncateHistoryMsg: mensagem curta → inalterada', () => {
  assert.strictEqual(truncateHistoryMsg('oi tudo bem'), 'oi tudo bem');
});

test('truncateHistoryMsg: null/undefined → string vazia', () => {
  assert.strictEqual(truncateHistoryMsg(null), '');
  assert.strictEqual(truncateHistoryMsg(undefined), '');
});
