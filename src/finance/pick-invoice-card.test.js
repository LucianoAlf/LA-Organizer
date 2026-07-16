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

// === Regressão Rose 16/07 01:57 (FIN-INVOICE-HINT-BEATS-USER-CORRECTION) ===
// O Intercept A abria a intent com findCard(emissor)[0] — um CHUTE gravado como card_id.
// A Rose corrigiu ("é o cartão LATAM PASS") e o hint chutado (Itaú Matheus) venceu a fala dela:
// 58 itens no cartão errado. A fala mais recente do usuário tem que vencer o hint.

test('BUG Rose 16/07: fala nomeia OUTRO cartão → vence o cardIdHint', () => {
  const r = pickInvoiceCard({
    emissor: 'Itaú',
    userText: 'Tom, é o cartão LATAM PASS. É para lançar somente o que falta. Lembra?',
    cards: ROSE,
    cardIdHint: 'matheus',
  });
  assert.strictEqual(r.status, 'resolved');
  assert.strictEqual(r.card.id, 'latam', 'a correção do usuário manda, não o hint chutado');
  assert.strictEqual(r.via, 'user');
});

test('não-regressão: "sim" (fala sem cartão) + hint → usa o hint', () => {
  const r = pickInvoiceCard({ emissor: 'Itaú', userText: 'sim', cards: ROSE, cardIdHint: 'matheus' });
  assert.strictEqual(r.status, 'resolved');
  assert.strictEqual(r.card.id, 'matheus');
  assert.strictEqual(r.via, 'id');
});

test('fala confirma o MESMO cartão do hint → resolved nele', () => {
  const r = pickInvoiceCard({ emissor: 'Itaú', userText: 'sim, pode lançar no Latam PASS', cards: ROSE, cardIdHint: 'latam' });
  assert.strictEqual(r.status, 'resolved');
  assert.strictEqual(r.card.id, 'latam');
});

// "cartão Itaú" NÃO nomeia cartão nenhum (nenhum se chama só "Itaú") — é fala genérica, cai no hint.
test('fala genérica ("cartão Itaú") não nomeia cartão → usa o hint', () => {
  const r = pickInvoiceCard({ emissor: 'Itaú', userText: 'é do cartão Itaú', cards: ROSE, cardIdHint: 'matheus' });
  assert.strictEqual(r.status, 'resolved');
  assert.strictEqual(r.card.id, 'matheus');
  assert.strictEqual(r.via, 'id');
});

test('fala cita DOIS cartões e o hint é um deles → hint desempata', () => {
  const r = pickInvoiceCard({ emissor: '', userText: 'é do Itaú Matheus ou do Itaú Rose?', cards: ROSE, cardIdHint: 'matheus' });
  assert.strictEqual(r.status, 'resolved');
  assert.strictEqual(r.card.id, 'matheus');
});

test('fala cita DOIS cartões e o hint não é nenhum → ambíguo (hint contraditado não vale)', () => {
  const r = pickInvoiceCard({ emissor: '', userText: 'é do Itaú Matheus ou do Itaú Rose?', cards: ROSE, cardIdHint: 'nubank' });
  assert.strictEqual(r.status, 'ambiguous');
  assert.strictEqual(r.candidates.length, 2);
});
