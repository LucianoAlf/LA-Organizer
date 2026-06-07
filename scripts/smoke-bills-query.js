// TDD da seleção de contas a pagar. Roda: node scripts/smoke-bills-query.js
const assert = require('assert');
const { billsToPay, isBillPaidThisCycle } = require('../src/finance/bills-query');

const monthStart = '2026-06-01';
const bills = [
  { name: 'Aluguel', amount: 1200, due_day: 10, recurrence: 'monthly', type: 'expense', last_paid_at: null, category: 'moradia' },
  { name: 'Internet', amount: 100, due_day: 10, recurrence: 'monthly', type: 'expense', last_paid_at: null, category: 'contas_consumo' },
  { name: 'Academia', amount: 90, due_day: 5, recurrence: 'monthly', type: 'expense', last_paid_at: null, category: 'esportes' },
  { name: 'Luz (paga)', amount: 200, due_day: 10, recurrence: 'monthly', type: 'expense', last_paid_at: '2026-06-03T12:00:00Z', category: 'contas_consumo' },
  { name: 'Salário recebido', amount: 5000, due_day: 10, recurrence: 'monthly', type: 'income', last_paid_at: null, category: 'salario' },
  { name: 'IPVA', amount: 800, due_date: '2026-06-10', recurrence: 'once', type: 'expense', last_paid_at: null, category: 'impostos' },
];

// Filtro por dia 10: Aluguel + Internet + IPVA (once dia 10). Exclui Luz (paga), Salário (income), Academia (dia 5).
const dia10 = billsToPay(bills, { dueDay: 10, monthStart });
assert.deepStrictEqual(dia10.items.map((b) => b.name), ['Aluguel', 'Internet', 'IPVA'], 'dia10 errado: ' + JSON.stringify(dia10.items.map((b) => b.name)));
assert.strictEqual(dia10.total, 2100, 'total dia10 errado: ' + dia10.total);
assert.strictEqual(dia10.count, 3);

// Sem filtro: todas em aberto (expense, não pagas), ordenadas por dia. Academia(5), Aluguel(10), Internet(10), IPVA(10).
const todas = billsToPay(bills, { monthStart });
assert.deepStrictEqual(todas.items.map((b) => b.name), ['Academia', 'Aluguel', 'Internet', 'IPVA'], 'todas errado: ' + JSON.stringify(todas.items.map((b) => b.name)));
assert.strictEqual(todas.total, 2190, 'total todas errado: ' + todas.total);

// Pago neste ciclo: Luz (last_paid 06-03 >= 06-01) sim; Aluguel (null) não.
assert.strictEqual(isBillPaidThisCycle(bills[3], monthStart), true);
assert.strictEqual(isBillPaidThisCycle(bills[0], monthStart), false);

// Tudo pago / nenhuma: lista vazia, total 0.
const vazio = billsToPay([{ name: 'X', amount: 50, due_day: 1, recurrence: 'monthly', type: 'expense', last_paid_at: '2026-06-02T00:00:00Z' }], { monthStart });
assert.strictEqual(vazio.count, 0);
assert.strictEqual(vazio.total, 0);

console.log('PASS — billsToPay: filtro por dia, sem filtro, pago-no-ciclo, vazio OK.');
