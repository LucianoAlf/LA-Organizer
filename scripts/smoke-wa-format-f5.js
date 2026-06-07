'use strict';
const assert = require('assert');
const wa = require('D:/la-organizer/_remote/src/finance/wa-format');

// B16 periodSummary
const ps = wa.periodSummary({ label: 'Gastos de abril', total: 1234.56, count: 32, mediaDiaria: 41.15 });
assert.strictEqual(ps, '📊 *Gastos de abril* — *R$ 1.234,56*\n_32 lançamentos · R$ 41,15/dia_', 'periodSummary');
assert.ok(wa.periodSummary({ label: 'X', total: 10, count: 1, mediaDiaria: 10 }).includes('1 lançamento ·'), 'singular');

// B14 recentMovement
const rm = wa.recentMovement({
  lastIn: { desc: 'Salário', amount: 3000, date: '2026-06-05' },
  lastOut: { desc: 'Mercado', amount: 152.3, date: '2026-06-06' },
  var7d: { in: 3000, out: 152.3, net: 2847.7 },
});
assert.strictEqual(rm,
  '🔄 *Movimentação recente*\n🟢 Entrou: Salário +R$ 3.000,00 _(05/06)_\n🔴 Saiu: Mercado −R$ 152,30 _(06/06)_\n📈 7 dias: +R$ 2.847,70',
  'recentMovement cheio');
const rmNeg = wa.recentMovement({ lastIn: null, lastOut: null, var7d: { in: 0, out: 50, net: -50 } });
assert.ok(rmNeg.includes('Sem movimentação'), 'recentMovement vazio');
assert.ok(rmNeg.includes('📈 7 dias: −R$ 50,00'), 'net negativo');

// comparison com labels custom (retrocompat)
assert.ok(wa.comparison({ atual: 1, anterior: 2, variation: { label: '⬇️ -50%' } }).includes('Este mês'), 'comparison default');
assert.ok(wa.comparison({ atual: 1, anterior: 2, variation: { label: '⬇️ -50%' } }, { atual: 'Neste período', anterior: 'Período anterior' }).includes('Neste período'), 'comparison labels');

// renderPeriodExpenses
const rpe = wa.renderPeriodExpenses({
  label: 'Gastos de junho', total: 500, count: 4, mediaDiaria: 71.4,
  top5: [{ label: 'Mercado', total: 300, pct: 60 }, { label: 'Lazer', total: 200, pct: 40 }],
  porTipo: { essenciais: 300, estilo: 200, essPct: 60, estiloPct: 40 },
  comparativo: { atual: 500, anterior: 400, variation: { label: '⬆️ +25%' } },
  tip: 'Mercado puxou 60% do mês.', acoes: ['meus saldos'],
});
assert.ok(rpe.includes('📊 *Gastos de junho*') && rpe.includes('🥇 Mercado') && rpe.includes('🏷️ *Por tipo*') && rpe.includes('Variação: ⬆️ +25%') && rpe.includes('💡 *Dica do TOM*'), 'renderPeriodExpenses');
assert.ok(wa.renderPeriodExpenses({ label: 'Gastos de maio', total: 0, count: 0, mediaDiaria: 0, top5: [], porTipo: { essenciais: 0, estilo: 0, essPct: 0, estiloPct: 0 }, comparativo: null, tip: null, acoes: [] }).includes('Nenhum gasto'), 'gastos empty-state');

// renderAccountDetail
const rad = wa.renderAccountDetail({
  name: 'Nubank', icon: '💜', balance: 1958.04, status: '✅',
  movement: { lastIn: { desc: 'Salário', amount: 3000, date: '2026-06-05' }, lastOut: { desc: 'Mercado', amount: 152.3, date: '2026-06-06' }, var7d: { in: 3000, out: 152.3, net: 2847.7 } },
});
assert.ok(rad.includes('💜 *Nubank*') && rad.includes('Saldo atual: *R$ 1.958,04* ✅') && rad.includes('🔄 *Movimentação recente*') && rad.includes('⚡'), 'renderAccountDetail');

// renderStatement
const rs = wa.renderStatement({
  name: 'Nubank', icon: '💜', label: 'Extrato de junho',
  items: [
    { type: 'expense', amount: 152.3, date: '2026-06-06', desc: 'Mercado', emoji: '🛒', source: '' },
    { type: 'income', amount: 3000, date: '2026-06-05', desc: 'Salário', emoji: '💰', source: '' },
  ],
  count: 2, shown: 2, hasMore: false, totalIn: 3000, totalOut: 152.3,
});
assert.ok(rs.includes('💜 *Extrato de junho · Nubank*') && rs.includes('06/06 🛒 Mercado *−R$ 152,30*') && rs.includes('🟢 Entradas: R$ 3.000,00') && rs.includes('🔴 Saídas: R$ 152,30'), 'renderStatement');
const rsMore = wa.renderStatement({ name: null, icon: null, label: 'Extrato', items: [{ type: 'expense', amount: 10, date: '2026-06-01', desc: 'X', emoji: '📦', source: 'Itaú' }], count: 14, shown: 1, hasMore: true, totalIn: 0, totalOut: 10 });
assert.ok(rsMore.includes('+13 lançamentos') && rsMore.includes('_·Itaú_'), 'statement hasMore + source por linha');
assert.ok(wa.renderStatement({ name: 'Nubank', icon: '💜', label: 'Extrato', items: [], count: 0, shown: 0, hasMore: false, totalIn: 0, totalOut: 0 }).includes('Nenhum lançamento'), 'statement empty');

console.log('OK smoke-wa-format-f5');
