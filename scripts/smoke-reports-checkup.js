'use strict';
const assert = require('assert');
const { buildCheckup } = require('../src/finance/reports/checkup');
const T = '2026-04-10';
const bills = [
  { name:'Celular', amount:99, due_day:5, recurrence:'monthly', type:'expense', last_paid_at:null },     // urgente (venceu)
  { name:'Aluguel', amount:1500, due_day:10, recurrence:'monthly', type:'expense', last_paid_at:null },   // urgente (hoje)
  { name:'Internet', amount:120, due_day:15, recurrence:'monthly', type:'expense', last_paid_at:null },    // importante (5d)
  { name:'Gas', amount:0, due_day:25, recurrence:'monthly', type:'expense', last_paid_at:null },           // importante (sem valor)
  { name:'Seguro', amount:300, due_day:28, recurrence:'monthly', type:'expense', last_paid_at:null },      // ok (>15d)
  { name:'Salario', amount:5000, due_day:5, recurrence:'monthly', type:'income', last_paid_at:null },      // income ignorado
];
const m = buildCheckup(bills, T);
assert.strictEqual(m.tiers.urgente.map((b)=>b.name).sort().join(','), 'Aluguel,Celular');
assert.strictEqual(m.tiers.importante.map((b)=>b.name).sort().join(','), 'Gas,Internet');
assert.strictEqual(m.count, 4); // urgente + importante
assert.strictEqual(m.totalRelevante, 99 + 1500 + 120); // Gas (sem valor) não soma
assert.ok(/venceu em 05\/04/.test(m.tiers.urgente.find((b)=>b.name==='Celular').message));
assert.ok(/vence hoje/.test(m.tiers.urgente.find((b)=>b.name==='Aluguel').message));
assert.ok(/valor não informado/.test(m.tiers.importante.find((b)=>b.name==='Gas').message));
assert.ok(/merecem atenção/.test(m.headline));
assert.ok(/em ordem/.test(buildCheckup([], T).headline));
console.log('PASS — buildCheckup OK.');
