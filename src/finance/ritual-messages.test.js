const { test } = require('node:test');
const assert = require('node:assert');
const { buildMonthlyFinance, buildBillReminder, buildMonthlyReport, buildBriefingFinanceLine } = require('./ritual-messages');

test('buildMonthlyFinance inclui saldo com sinal e nome', () => {
  const m = buildMonthlyFinance({ nome: 'Alf', receitas: 3200, despesas: 2100, goals: [] });
  assert.match(m, /\+R\$1100/);
  assert.match(m, /Alf/);
});
test('buildMonthlyFinance com meta mostra progresso', () => {
  const m = buildMonthlyFinance({ nome: 'Alf', receitas: 1000, despesas: 500, goals: [{ name: 'Carro', current_amount: 500, target_amount: 5000 }] });
  assert.match(m, /Carro/);
  assert.match(m, /10%/);
});
test('buildBillReminder previo', () => {
  const m = buildBillReminder({ nome: 'Alf', bill: { name: 'Aluguel', amount: 1200, due_day: 10 }, mode: 'previo', dias: 2 });
  assert.match(m, /Aluguel/); assert.match(m, /1200/); assert.match(m, /2 dias/);
});
test('buildBillReminder atrasada', () => {
  const m = buildBillReminder({ nome: 'Alf', bill: { name: 'Netflix', amount: 40, due_day: 5 }, mode: 'atrasada', dias: -3 });
  assert.match(m, /venceu/i); assert.match(m, /Netflix/);
});
test('buildMonthlyReport gastou mais que ganhou', () => {
  const m = buildMonthlyReport({ nome: 'Alf', mes: 'abril', receitas: 1000, despesas: 1500, top: [['lazer', 800]], goals: [] });
  assert.match(m, /Gastou mais/i);
  assert.match(m, /abril/);
});
test('buildBriefingFinanceLine vazio quando sem contas', () => {
  assert.strictEqual(buildBriefingFinanceLine([]), '');
});
test('buildBriefingFinanceLine lista contas de hoje', () => {
  const m = buildBriefingFinanceLine([{ name: 'Aluguel', amount: 1200 }]);
  assert.match(m, /Vence hoje/i); assert.match(m, /Aluguel/);
});
