'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { enforceNoMarkerHonesty } = require('./optimistic-confirm');

// INVENTORY-CONFAB-INVERSO-NOMARKER (27/06) — prova o MECANISMO do fix do Adjacente: quando o
// cadastro de inventário PERSISTE, o engine passa a logar INVENTORY_ACTION executed →
// marker_emitted setado (via a query 11355) → nothingPersisted=false → o chokepoint NÃO rebaixa
// a verdade. Antes: inventário não logava sucesso → nothingPersisted=true → "✅ Item adicionado"
// virava "não consegui registrar" (inverse-confab, primo do #1 / FIN-CONFAB-INVERSO-MARKER-EMITTED).
// Strings reais do bloco INVENTORY_ACTION (engine 10335 add_item / 10361 shop_movement).

const OPTS = { infoGathering: false, awaitingConfirm: false };
const ITEM_OK = '✅ Item adicionado: Teclado Yamaha';
const SHOP_OK = '✅ Estoque atualizado. Saldo agora: 12 un.';

test('FIX: persistiu (nothingPersisted:false) → "✅ Item adicionado" SOBREVIVE intacto', () => {
  assert.equal(enforceNoMarkerHonesty(ITEM_OK, { nothingPersisted: false, ...OPTS }), ITEM_OK);
});
test('FIX: persistiu (nothingPersisted:false) → "✅ Estoque atualizado" SOBREVIVE intacto', () => {
  assert.equal(enforceNoMarkerHonesty(SHOP_OK, { nothingPersisted: false, ...OPTS }), SHOP_OK);
});
test('BUG documentado: SEM marker (nothingPersisted:true) → "✅ Item adicionado" seria rebaixado', () => {
  const out = enforceNoMarkerHonesty(ITEM_OK, { nothingPersisted: true, ...OPTS });
  assert.notEqual(out, ITEM_OK);
  assert.match(out, /não consegui registrar/i);
});
test('BUG documentado: SEM marker → "✅ Estoque atualizado" seria rebaixado', () => {
  assert.match(enforceNoMarkerHonesty(SHOP_OK, { nothingPersisted: true, ...OPTS }), /não consegui registrar/i);
});
