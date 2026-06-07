const assert = require('assert');
const { buildFixedBills } = require('../src/finance/reports/bills');

const T = '2026-04-10';
const bills = [
  { name:'Aluguel', amount:1500, due_day:10, recurrence:'monthly', type:'expense', last_paid_at:null },
  { name:'Internet', amount:120, due_day:25, recurrence:'monthly', type:'expense', last_paid_at:null },
  { name:'Luz (paga)', amount:200, due_day:10, recurrence:'monthly', type:'expense', last_paid_at:'2026-04-02' },
  { name:'Gás (sem valor)', amount:0, due_day:25, recurrence:'monthly', type:'expense', last_paid_at:null },
  { name:'Salário', amount:5000, due_day:5, recurrence:'monthly', type:'income', last_paid_at:null }, // ignorado (income)
];
const m = buildFixedBills(bills, T);
// COMPLETA: conta todas as despesas (inclui paga e sem valor), exclui income.
assert.strictEqual(m.count, 4);
assert.deepStrictEqual(m.groups.vencidas.map((b)=>b.name), ['Aluguel']);    // vence hoje sem pagar
assert.deepStrictEqual(m.groups.pendentes.map((b)=>b.name), ['Internet']);  // futuro com valor
assert.deepStrictEqual(m.groups.pagas.map((b)=>b.name), ['Luz (paga)']);
assert.deepStrictEqual(m.groups.semValor.map((b)=>b.name), ['Gás (sem valor)']);
assert.strictEqual(m.totals.aPagar, 1620); // pendentes + vencidas (sem valor não soma)

const { buildBillsToPay } = require('../src/finance/reports/bills');
const cardInvoices = [{ cardName:'Nubank', remaining:2579, dueDay:22 }];
const p = buildBillsToPay(bills, cardInvoices, T);
assert.deepStrictEqual(p.vencidas.map((b)=>b.name), ['Aluguel']);     // delta <= 0
assert.deepStrictEqual(p.proximos7.map((b)=>b.name), []);             // nada 1–7d
assert.deepStrictEqual(p.restanteMes.map((b)=>b.name), ['Internet','Gás (sem valor)']); // >7d (sem valor entra na listagem, soma 0)
assert.deepStrictEqual(p.cards.map((c)=>c.name), ['Fatura Nubank']);
assert.strictEqual(p.totalPendente, 1500 + 120 + 0 + 2579); // vencidas+pendentes+restante+fatura
// filtro por dia (ex: "o que vence dia 10")
const d10 = buildBillsToPay(bills, [], T, { dueDay: 10 });
assert.deepStrictEqual(d10.filtered.map((b)=>b.name), ['Aluguel']);
assert.strictEqual(d10.totalPendente, 1500);

console.log('PASS — buildFixedBills OK.');
