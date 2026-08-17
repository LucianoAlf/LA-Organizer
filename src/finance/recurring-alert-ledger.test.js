'use strict';
// GOVFIN-RECURRING-ALERTA-ETERNO (raiz — Rose/Light 13→20/08): o alerta proativo não tinha
// memória de "já avisei". A janela refYmd só trocava ~30 dias de repetição (Canva) por ~8 dias
// (Light). Este helper PURO é o gate de idempotência: dada a lista detectada + o que já foi
// alertado (ledger pf_recurring_alerts), decide o que ANUNCIAR e o que GRAVAR — uma recorrência
// nova avisa UMA vez; price creep re-avisa só quando sobe pra um valor NOVO.
const { test } = require('node:test');
const assert = require('node:assert');

const { keyOf, selectNewAlerts } = require('./recurring-alert-ledger');

const novaLight = { merchant: 'light', isNewSubscription: true, priceCreep: false, lastAmount: 364.29, prevAmount: 356.16 };

test('keyOf: assinatura nova → kind new_subscription, dedup_key estável "sub" (independe do valor)', () => {
  const k = keyOf(novaLight);
  assert.strictEqual(k.kind, 'new_subscription');
  assert.strictEqual(k.dedup_key, 'sub');
  assert.strictEqual(k.merchant, 'light');
  assert.strictEqual(k.amount_cents, 36429);
});

test('keyOf: price creep → dedup_key inclui o valor novo (re-avisa só em valor novo)', () => {
  const k = keyOf({ merchant: 'netflix', isNewSubscription: false, priceCreep: true, lastAmount: 55.90, prevAmount: 44.90 });
  assert.strictEqual(k.kind, 'price_creep');
  assert.strictEqual(k.dedup_key, 'creep:5590');
  assert.strictEqual(k.amount_cents, 5590);
});

test('keyOf: item que não é nem assinatura nem creep → null', () => {
  assert.strictEqual(keyOf({ merchant: 'uber', isNewSubscription: false, priceCreep: false, lastAmount: 20 }), null);
});

test('selectNewAlerts: Light 1ª vez (ledger vazio) → anuncia e devolve a chave pra gravar', () => {
  const { items, keys } = selectNewAlerts([novaLight], []);
  assert.strictEqual(items.length, 1);
  assert.strictEqual(items[0].merchant, 'light');
  assert.deepStrictEqual(keys, [{ merchant: 'light', kind: 'new_subscription', amount_cents: 36429, dedup_key: 'sub' }]);
});

test('selectNewAlerts: Light já no ledger → NÃO repete (o bug da Rose)', () => {
  const ledger = [{ merchant: 'light', dedup_key: 'sub' }];
  const { items, keys } = selectNewAlerts([novaLight], ledger);
  assert.strictEqual(items.length, 0);
  assert.strictEqual(keys.length, 0);
});

test('selectNewAlerts: price creep no MESMO valor já avisado → suprime', () => {
  const item = { merchant: 'netflix', isNewSubscription: false, priceCreep: true, lastAmount: 55.90, prevAmount: 44.90 };
  const ledger = [{ merchant: 'netflix', dedup_key: 'creep:5590' }];
  const { items } = selectNewAlerts([item], ledger);
  assert.strictEqual(items.length, 0);
});

test('selectNewAlerts: price creep sobe pra valor NOVO → re-avisa (mesmo com creep antigo no ledger)', () => {
  const item = { merchant: 'netflix', isNewSubscription: false, priceCreep: true, lastAmount: 62.90, prevAmount: 55.90 };
  const ledger = [{ merchant: 'netflix', dedup_key: 'creep:5590' }];
  const { items, keys } = selectNewAlerts([item], ledger);
  assert.strictEqual(items.length, 1);
  assert.strictEqual(keys[0].dedup_key, 'creep:6290');
});

test('selectNewAlerts: item duplicado no mesmo lote → anuncia uma vez só', () => {
  const { items } = selectNewAlerts([novaLight, novaLight], []);
  assert.strictEqual(items.length, 1);
});

test('selectNewAlerts: itens não-alertáveis (nem sub nem creep) são ignorados sem quebrar', () => {
  const ruido = { merchant: 'uber', isNewSubscription: false, priceCreep: false, lastAmount: 20 };
  const { items, keys } = selectNewAlerts([ruido, novaLight], []);
  assert.strictEqual(items.length, 1);
  assert.strictEqual(items[0].merchant, 'light');
  assert.strictEqual(keys.length, 1);
});
