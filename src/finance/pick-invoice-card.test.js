'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { pickInvoiceCard } = require('./pick-invoice-card');

// Cartões reais da Rose (o cenário do bug 14/07)
const ROSE = [
  { id: 'matheus', name: 'Cartão Itaú Matheus' },
  { id: 'rose', name: 'Cartão Itaú Rose' },
  { id: 'latam', name: 'Latam PASS' },
  { id: 'nubank', name: 'Cartão Nubank' },
];

test('BUG Rose: emissor "Itaú" casa 3 cartões → AMBÍGUO, nunca chuta o [0]', () => {
  const r = pickInvoiceCard({ emissor: 'Itaú', userText: '', cards: ROSE });
  assert.strictEqual(r.status, 'ambiguous');
  assert.ok(r.candidates.length >= 2, 'Itaú Matheus + Itaú Rose (Latam PASS não tem "Itaú" no nome)');
});

test('BUG Rose: a FALA "essa fatura é do LATAM PASS" resolve pro Latam PASS (vence o emissor)', () => {
  const r = pickInvoiceCard({ emissor: 'Itaú', userText: 'Tom, essa fatura é do cartão LATAM PASS de julho.', cards: ROSE });
  assert.strictEqual(r.status, 'resolved');
  assert.strictEqual(r.card.id, 'latam');
  assert.strictEqual(r.via, 'user');
});

test('emissor único casa 1 cartão → resolved', () => {
  const r = pickInvoiceCard({ emissor: 'Nubank', userText: '', cards: ROSE });
  assert.strictEqual(r.status, 'resolved');
  assert.strictEqual(r.card.id, 'nubank');
  assert.strictEqual(r.via, 'emissor');
});

test('card_id confirmado antes (desambiguação prévia) vence tudo', () => {
  const r = pickInvoiceCard({ emissor: 'Itaú', userText: '', cards: ROSE, cardIdHint: 'rose' });
  assert.strictEqual(r.status, 'resolved');
  assert.strictEqual(r.card.id, 'rose');
  assert.strictEqual(r.via, 'id');
});

test('emissor que não casa nenhum cartão → notfound (pergunta, não inventa)', () => {
  const r = pickInvoiceCard({ emissor: 'C6 Bank', userText: '', cards: ROSE });
  assert.strictEqual(r.status, 'notfound');
});

test('fala ambígua ("cartão Itaú") → ambíguo por fala, não chuta', () => {
  const r = pickInvoiceCard({ emissor: 'Itaú', userText: 'é do cartão Itaú', cards: ROSE });
  assert.strictEqual(r.status, 'ambiguous');
});

test('lista de cartões vazia → notfound seguro', () => {
  assert.strictEqual(pickInvoiceCard({ emissor: 'Itaú', cards: [] }).status, 'notfound');
});

test('acento-insensível: "latam" minúsculo sem acento casa "Latam PASS"', () => {
  const r = pickInvoiceCard({ emissor: '', userText: 'poe na fatura do latam pass', cards: ROSE });
  assert.strictEqual(r.status, 'resolved');
  assert.strictEqual(r.card.id, 'latam');
});
