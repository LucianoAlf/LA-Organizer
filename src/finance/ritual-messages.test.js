const { test } = require('node:test');
const assert = require('node:assert');
const { buildMonthlyFinance, buildBillReminder, buildMonthlyReport, buildBriefingFinanceLine, buildHealthScoreLine } = require('./ritual-messages');

test('buildMonthlyFinance inclui saldo com sinal e nome', () => {
  const m = buildMonthlyFinance({ nome: 'Alf', receitas: 3200, despesas: 2100, goals: [] });
  assert.match(m, /\+R\$1\.100,00/);
  assert.match(m, /Alf/);
});
test('buildMonthlyFinance com meta mostra progresso', () => {
  const m = buildMonthlyFinance({ nome: 'Alf', receitas: 1000, despesas: 500, goals: [{ name: 'Carro', current_amount: 500, target_amount: 5000 }] });
  assert.match(m, /Carro/);
  assert.match(m, /10%/);
});
test('buildBillReminder previo', () => {
  const m = buildBillReminder({ nome: 'Alf', bill: { name: 'Aluguel', amount: 1200, due_day: 10 }, mode: 'previo', dias: 2 });
  assert.match(m, /Aluguel/); assert.match(m, /1\.200,00/); assert.match(m, /2 dias/);
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
test('buildHealthScoreLine mostra score + maior alavanca', () => {
  const m = buildHealthScoreLine({ score: 72, band: '🟡', topLever: { key: 'credito', label: 'Uso do cartão', hint: 'a fatura do cartão tá puxando' } });
  assert.match(m, /72\/100/);
  assert.match(m, /🟡/);
  assert.match(m, /Maior alavanca/i);
  assert.match(m, /fatura do cartão/);
});
test('buildHealthScoreLine saudável (sem topLever) elogia, sem "Maior alavanca"', () => {
  const m = buildHealthScoreLine({ score: 95, band: '🟢', topLever: null });
  assert.match(m, /95\/100/);
  assert.doesNotMatch(m, /Maior alavanca/i);
});
test('buildHealthScoreLine score null → vazio', () => {
  assert.strictEqual(buildHealthScoreLine({ score: null }), '');
  assert.strictEqual(buildHealthScoreLine(null), '');
});
test('buildMonthlyFinance anexa a seção de saúde quando health vem', () => {
  const m = buildMonthlyFinance({ nome: 'Alf', receitas: 1000, despesas: 500, goals: [], health: { score: 80, band: '🟢', topLever: null } });
  assert.match(m, /Saúde financeira: 80\/100/);
});

test('buildBriefingFinanceLine vazio quando sem contas', () => {
  assert.strictEqual(buildBriefingFinanceLine([]), '');
});
test('buildBriefingFinanceLine lista contas de hoje', () => {
  const m = buildBriefingFinanceLine([{ name: 'Aluguel', amount: 1200 }]);
  assert.match(m, /Vence hoje/i); assert.match(m, /Aluguel/);
});
