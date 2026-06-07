'use strict';
const assert = require('assert');
const { shiftDays } = require('D:/la-organizer/_remote/src/finance/report-domain');
const { buildAccountDetail } = require('D:/la-organizer/_remote/src/finance/reports/account');

assert.strictEqual(shiftDays('2026-06-07', -7), '2026-05-31', 'shiftDays cruza mês');
assert.strictEqual(shiftDays('2026-06-07', 0), '2026-06-07', 'shiftDays 0');
assert.strictEqual(shiftDays('2026-03-01', -1), '2026-02-28', 'shiftDays fev');

const acc = { name: 'Nubank', icon: '💜', balance: 1958.04 };
const txns = [
  { type: 'expense', amount: 152.3, description: 'Mercado', category: 'mercado', transaction_date: '2026-06-06' },
  { type: 'income', amount: 3000, description: 'Salário', category: 'salario', transaction_date: '2026-06-05' },
  { type: 'expense', amount: 80, description: 'Uber', category: 'transporte', transaction_date: '2026-05-20' }, // fora da janela 7d
];
const m = buildAccountDetail(acc, txns, '2026-06-07');
assert.strictEqual(m.name, 'Nubank');
assert.strictEqual(m.status, '✅', 'saldo positivo');
assert.strictEqual(m.movement.lastOut.desc, 'Mercado', 'última saída');
assert.strictEqual(m.movement.lastIn.desc, 'Salário', 'última entrada');
assert.strictEqual(m.movement.var7d.in, 3000, '7d in só Salário');
assert.strictEqual(m.movement.var7d.out, 152.3, '7d out só Mercado (Uber fora)');
assert.ok(Math.abs(m.movement.var7d.net - 2847.7) < 1e-9, '7d net');

const vazio = buildAccountDetail({ name: 'Cofre', icon: '🐷', balance: 0 }, [], '2026-06-07');
assert.strictEqual(vazio.status, '🟡', 'saldo zero');
assert.strictEqual(vazio.movement.lastIn, null);
assert.strictEqual(vazio.movement.var7d.net, 0);

console.log('OK smoke-reports-account');
