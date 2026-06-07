'use strict';
const assert = require('assert');
const wa = require('D:/la-organizer/_remote/src/finance/wa-format');

// B13 dayBalance
assert.strictEqual(wa.dayBalance(3000, 1719.69, 1280.31),
  '📊 *Balanço*\n🟢 Entrou: R$ 3.000,00\n🔴 Saiu: R$ 1.719,69\n💵 Resultado: *+R$ 1.280,31* 🟢', 'dayBalance positivo');
assert.ok(wa.dayBalance(100, 250, -150).includes('💵 Resultado: *−R$ 150,00* 🔴'), 'dayBalance negativo');

// renderDailySummary
const d = wa.renderDailySummary({ label: 'Balanço de hoje', receitas: 400, despesas: 152.3, resultado: 247.7, saldoTotal: 1958.03, count: 2, top: [{ label: 'Mercado', total: 152.3, pct: 100 }], temAtividade: true });
assert.ok(d.includes('📅 *Balanço de hoje*') && d.includes('📊 *Balanço*') && d.includes('🏆 *Top do dia*') && d.includes('🏦 Saldo total: *R$ 1.958,03*'), 'renderDailySummary');
assert.ok(wa.renderDailySummary({ label: 'Balanço de hoje', receitas: 0, despesas: 0, resultado: 0, saldoTotal: 100, count: 0, top: [], temAtividade: false }).includes('Sem movimentação'), 'diário vazio');

// renderWeeklySummary
const w = wa.renderWeeklySummary({ label: 'Resumo da semana', receitas: 1000, despesas: 600, resultado: 400, count: 8, top: [{ label: 'Mercado', total: 400, pct: 67 }], porTipo: { essenciais: 400, estilo: 200, essPct: 67, estiloPct: 33 }, comparativo: { atual: 600, anterior: 500, variation: { label: '⬆️ +20%' } }, temAtividade: true, acoes: ['meus saldos'] });
assert.ok(w.includes('🗓️ *Resumo da semana*') && w.includes('Esta semana: R$ 600,00') && w.includes('Semana anterior: R$ 500,00') && w.includes('🏷️ *Por tipo*'), 'renderWeeklySummary + labels');
assert.ok(wa.renderWeeklySummary({ label: 'Resumo da semana', receitas: 0, despesas: 0, resultado: 0, count: 0, top: [], porTipo: { essenciais: 0, estilo: 0, essPct: 0, estiloPct: 0 }, comparativo: null, temAtividade: false, acoes: [] }).includes('sem movimentação'), 'semana vazia');

// renderMonthlyClosing
const c = wa.renderMonthlyClosing({ label: 'Fechamento de maio', receitas: 5000, despesas: 5300, resultado: -300, count: 40, top: [{ label: 'Moradia', total: 1500, pct: 28 }], porTipo: { essenciais: 4000, estilo: 1300, essPct: 75, estiloPct: 25 }, comparativo: { atual: 5300, anterior: 4800, variation: { label: '⬆️ +10%' } }, metas: [{ name: 'Viagem', pct: 40, current: 2000, target: 5000 }], tip: 'Fechou no vermelho: gastou mais do que ganhou. Bora ajustar o próximo mês?', acoes: ['resumo do mês'] });
assert.ok(c.includes('📆 *Fechamento de maio*') && c.includes('💵 Resultado: *−R$ 300,00* 🔴') && c.includes('🏆 *Onde foi o dinheiro*') && c.includes('🎯 *Metas*') && c.includes('💡 *Dica do TOM*'), 'renderMonthlyClosing');
assert.ok(!c.includes('Projeção'), 'fechamento NÃO tem projeção'); // distinção vs R-MES

console.log('OK smoke-wa-format-f6');
