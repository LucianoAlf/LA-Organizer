'use strict';
// Testes do classificador de register_bill (bug CARD-DUE-RECURRING-GAP).
// Roda com: node --test src/finance/register-bill-classify.test.js
const test = require('node:test');
const assert = require('node:assert');
const { classifyRegisterBill, hasValidAmount, validDueDay } = require('./register-bill-classify');

// ── O caso real que quebrou (Rose 11/06): lembrete de vencimento de cartão SEM amount ──
test('caso Rose: register_bill sem amount casando cartão com due_day → confirma (não crasha)', () => {
  const card = { id: 'c1', name: 'Nubank', due_day: 10 };
  const r = classifyRegisterBill({ name: 'Nubank', due_day: 10 }, card);
  assert.strictEqual(r.kind, 'card_confirm');
  assert.strictEqual(r.dueDay, 10);
  assert.strictEqual(r.card.id, 'c1');
});

test('cartão SEM due_day + LLM informou o dia → seta due_day', () => {
  const card = { id: 'c2', name: 'Inter', due_day: null };
  const r = classifyRegisterBill({ card: 'Inter', due_day: 15 }, card);
  assert.strictEqual(r.kind, 'card_set');
  assert.strictEqual(r.dueDay, 15);
});

test('cartão SEM due_day e sem dia informado → pede o dia', () => {
  const card = { id: 'c3', name: 'Itaú', due_day: null };
  const r = classifyRegisterBill({ name: 'Itaú' }, card);
  assert.strictEqual(r.kind, 'card_ask_day');
  assert.strictEqual(r.card.id, 'c3');
});

test('NÃO é cartão e sem valor → pede o valor (nunca crasha, nunca cadastra)', () => {
  const r = classifyRegisterBill({ name: 'Aluguel', due_day: 5 }, null);
  assert.strictEqual(r.kind, 'ask_value');
  assert.strictEqual(r.name, 'Aluguel');
});

test('conta legítima COM amount → segue createBill normal', () => {
  const r = classifyRegisterBill({ name: 'Aluguel', amount: 1200, due_day: 5 }, null);
  assert.strictEqual(r.kind, 'bill');
});

test('amount válido tem prioridade mesmo casando cartão (compra/fatura com valor)', () => {
  const card = { id: 'c1', name: 'Nubank', due_day: 10 };
  const r = classifyRegisterBill({ name: 'Nubank', amount: 350 }, card);
  assert.strictEqual(r.kind, 'bill');
});

// ── due_day NÃO deve ser clobberado quando o cartão já tem um (anti-destrutivo) ──
test('cartão com due_day=10 e LLM manda due_day=20 → confirma o EXISTENTE (10), não altera', () => {
  const card = { id: 'c1', name: 'Nubank', due_day: 10 };
  const r = classifyRegisterBill({ name: 'Nubank', due_day: 20 }, card);
  assert.strictEqual(r.kind, 'card_confirm');
  assert.strictEqual(r.dueDay, 10);
});

// ── helpers ──
test('hasValidAmount', () => {
  assert.strictEqual(hasValidAmount(null), false);
  assert.strictEqual(hasValidAmount(undefined), false);
  assert.strictEqual(hasValidAmount(''), false);
  assert.strictEqual(hasValidAmount(0), false);
  assert.strictEqual(hasValidAmount(-5), false);
  assert.strictEqual(hasValidAmount('abc'), false);
  assert.strictEqual(hasValidAmount(120), true);
  assert.strictEqual(hasValidAmount('120.50'), true);
});

test('validDueDay', () => {
  assert.strictEqual(validDueDay(null), null);
  assert.strictEqual(validDueDay(0), null);
  assert.strictEqual(validDueDay(32), null);
  assert.strictEqual(validDueDay(10), 10);
  assert.strictEqual(validDueDay('15'), 15);
  assert.strictEqual(validDueDay(10.5), null);
});
