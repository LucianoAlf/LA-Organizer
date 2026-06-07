const assert = require('assert');
const { buildBalances } = require('../src/finance/reports/balances');
const accounts = [
  { name:'Nubank', icon:'💜', balance:5221 },
  { name:'Itau', icon:'🧡', balance:4820 },
  { name:'Cheque', balance:-30 },
];
const cardsUsage = [
  { card:{ name:'Nubank' }, usage:{ available:1000, used:200, limit:1200, pct:0.16 } },
  { card:{ name:'Estourado' }, usage:{ available:-50, used:550, limit:500, pct:1.1 } }, // negativo não conta
];
const m = buildBalances(accounts, cardsUsage);
assert.strictEqual(m.accounts.length, 3);
assert.strictEqual(m.accounts[0].status, '✅');
assert.strictEqual(m.accounts[2].status, '🔴'); // saldo negativo
assert.strictEqual(m.totalSaldo, 5221 + 4820 - 30);     // 10011
assert.strictEqual(m.limiteDisponivel, 1000);            // estourado clampado a 0
assert.strictEqual(m.totalDisponivel, 10011 + 1000);     // 11011
assert.strictEqual(buildBalances([], []).totalDisponivel, 0);
console.log('PASS — buildBalances OK.');
