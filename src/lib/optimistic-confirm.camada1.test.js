'use strict';
// Camada 1 — chokepoint anti-confabulação (CONFAB-NOMARKER-CHOKEPOINT).
// Testa hasCompletionClaim (gate verbo-baseado) + enforceNoMarkerHonesty.
const test = require('node:test');
const assert = require('node:assert');
const { hasCompletionClaim, enforceNoMarkerHonesty } = require('./optimistic-confirm');

const PERSIST_NO = { nothingPersisted: true, infoGathering: false, awaitingConfirm: false };

test('hasCompletionClaim: Ana (✅ + verbo no fim) = true', () => {
  assert.strictEqual(hasCompletionClaim('✅ Alice com a bombinha em dia — as duas doses confirmadas!'), true);
});
test('hasCompletionClaim: Rose (✅ + lançado) = true', () => {
  assert.strictEqual(hasCompletionClaim('✅ Lançado nas parcelas jul/ago/set'), true);
});
test('hasCompletionClaim: ✅ decorativo sem verbo = false', () => {
  assert.strictEqual(hasCompletionClaim('✅ Boa! Tá tudo certo por aí?'), false);
});
test('hasCompletionClaim: referência a ação passada sem ✅ = false', () => {
  assert.strictEqual(hasCompletionClaim('O evento que você criou semana passada tá lá na agenda'), false);
});

test('enforce: Ana rebaixa (remove a linha falsa + aviso)', () => {
  const out = enforceNoMarkerHonesty('✅ as duas doses confirmadas!', PERSIST_NO);
  assert.ok(!/confirmadas/i.test(out), 'a confirmação falsa devia sumir: ' + out);
  assert.ok(/n[ãa]o consegui registrar/i.test(out), 'devia ter aviso honesto: ' + out);
});
test('enforce: Rose rebaixa', () => {
  const out = enforceNoMarkerHonesty('✅ Lançado nas parcelas jul/ago/set', PERSIST_NO);
  assert.ok(!/lançado/i.test(out), out);
  assert.ok(/n[ãa]o consegui registrar/i.test(out), out);
});
test('enforce NÃO mexe: ✅ decorativo', () => {
  const t = '✅ Boa! Tá tudo certo por aí?';
  assert.strictEqual(enforceNoMarkerHonesty(t, PERSIST_NO), t);
});
test('enforce NÃO mexe: algo persistiu (nothingPersisted=false)', () => {
  const t = '✅ Tarefa criada!';
  assert.strictEqual(enforceNoMarkerHonesty(t, { nothingPersisted: false, infoGathering: false, awaitingConfirm: false }), t);
});
test('enforce NÃO mexe: infoGathering', () => {
  const t = '✅ Criado! Quer que eu marque a hora?';
  assert.strictEqual(enforceNoMarkerHonesty(t, { nothingPersisted: true, infoGathering: true, awaitingConfirm: false }), t);
});
test('enforce NÃO mexe: awaitingConfirm', () => {
  const t = '✅ Confirmado, crio as duas?';
  assert.strictEqual(enforceNoMarkerHonesty(t, { nothingPersisted: true, infoGathering: false, awaitingConfirm: true }), t);
});
