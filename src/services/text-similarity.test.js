'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { jaroWinkler, normalizeForSim } = require('./text-similarity');

test('jaroWinkler: idênticos = 1', () => {
  assert.strictEqual(jaroWinkler('lista de compras', 'lista de compras'), 1.0);
});
test('jaroWinkler: vazio = 0', () => {
  assert.strictEqual(jaroWinkler('', 'x'), 0.0);
});
test('jaroWinkler: títulos quase-iguais > 0.85 (golden C7)', () => {
  const s = jaroWinkler(normalizeForSim('Lista de compras'), normalizeForSim('Lista de compras — mercado'));
  assert.ok(s > 0.85, `esperava > 0.85, veio ${s}`);
});
test('jaroWinkler: títulos distintos < 0.7', () => {
  const s = jaroWinkler(normalizeForSim('Comprar cabos'), normalizeForSim('Revisar relatório'));
  assert.ok(s < 0.7, `esperava < 0.7, veio ${s}`);
});
test('normalizeForSim: lowercase + remove acento/pontuação/dígitos', () => {
  assert.strictEqual(normalizeForSim('Reunião 12/06!'), 'reunião');
  assert.strictEqual(normalizeForSim('  Lista, de  Compras  '), 'lista de compras');
});
