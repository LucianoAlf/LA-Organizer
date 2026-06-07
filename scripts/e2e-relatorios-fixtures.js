'use strict';
// ===========================================================================
// Bateria E2E de EDGE-CASES da Central de Relatórios — 100% pura (sem DB/env).
// Cobre os casos que dados reais nem sempre têm: vazio, vencida, projeção
// negativa, resultado no vermelho, truncamento, semáforos, fonte por linha.
// Roda local: node scripts/e2e-relatorios-fixtures.js
// ===========================================================================
const assert = require('assert');
const wa = require('../src/finance/wa-format');
const { buildMonthAnalysis } = require('../src/finance/reports/month');
const { buildBillsToPay, buildFixedBills } = require('../src/finance/reports/bills');
const { buildStatement } = require('../src/finance/reports/statement');
const { buildPeriodExpenses } = require('../src/finance/reports/expenses');
const { buildMonthlyClosing, buildWeeklySummary, buildDailySummary } = require('../src/finance/reports/summaries');

let n = 0;
function ok(name, cond, extra) { n++; if (!cond) { console.error(`❌ ${name}${extra ? ' — ' + extra : ''}`); throw new assert.AssertionError({ message: name }); } else console.log(`✅ ${name}`); }

// ---------- 1. Contas Fixas (render): 4 grupos + nota de total ----------
{
  const model = {
    count: 4,
    groups: {
      vencidas: [{ name: 'Luz', amount: 250, due_day: 5 }],
      pendentes: [{ name: 'Internet', amount: 120, due_day: 20 }],
      pagas: [{ name: 'Aluguel', amount: 1500, due_day: 10 }],
      semValor: [{ name: 'Água', amount: 0, due_day: 15 }],
    },
    totals: { aPagar: 370 }, // só vencidas + pendentes (250+120)
  };
  const out = wa.renderFixedBills(model);
  ok('fixed: mostra os 4 grupos', ['Vencidas', 'Pendentes', 'Pagas', 'Sem valor'].every((s) => out.includes(s)));
  ok('fixed: total a pagar = 370 (exclui paga/sem-valor)', out.includes(wa.money(370)));
  ok('fixed: nota "pagas e sem valor não entram"', out.includes('não entram no total'));
  ok('fixed: empty-state', wa.renderFixedBills({ count: 0 }).includes('ainda não cadastrou'));
}

// ---------- 2. Contas a Pagar (render): tudo pago / com fatura / por dia ----------
{
  ok('pagar: empty "tudo pago"', wa.renderBillsToPay({ vencidas: [], proximos7: [], restanteMes: [], cards: [], totalPendente: 0 }).includes('Tá tudo pago'));
  const out = wa.renderBillsToPay({
    vencidas: [{ name: 'Cartão Z', amount: 80, due_day: 2 }],
    proximos7: [{ name: 'Net', amount: 100, due_day: 9 }],
    restanteMes: [], cards: [{ name: 'Fatura Nubank', amount: 1200 }], totalPendente: 1380,
  });
  ok('pagar: vencidas+próximos7+faturas', out.includes('Vencidas') && out.includes('Próximos 7 dias') && out.includes('Faturas'));
  ok('pagar: total pendente 1380', out.includes(wa.money(1380)));
  const filtered = wa.renderBillsToPay({ dueDay: 10, filtered: [{ name: 'Luz', amount: 250, due_day: 10 }], totalPendente: 250 });
  ok('pagar: filtrado por dia 10', filtered.includes('vencem dia 10') && filtered.includes(wa.money(250)));
  ok('pagar: filtrado vazio', wa.renderBillsToPay({ dueDay: 3, filtered: [], totalPendente: 0 }).includes('Nada em aberto'));
  // builder null-guard (bill sem due_day / once sem data não quebra)
  const m = buildBillsToPay([{ name: 'X', amount: 50, recurrence: 'once', due_date: null }], [], '2026-06-15');
  ok('pagar builder: não quebra com once-sem-data', typeof m.totalPendente === 'number');
}

// ---------- 3. Checkup (render): tiers + empty ----------
{
  ok('checkup: empty', wa.renderCheckup({ count: 0, headline: 'Tá tudo em ordem por aqui! 🎉' }).includes('Tá tudo em ordem'));
  const out = wa.renderCheckup({
    count: 2, headline: '2 contas pedindo atenção.',
    tiers: {
      urgente: [{ name: 'Luz', amount: 250, hasValue: true, dueLabel: 'venceu há 3d', message: 'resolve hoje' }],
      importante: [{ name: 'Net', amount: 100, hasValue: true, dueLabel: 'vence em 4d', message: 'se prepara' }],
      atencao: [], ok: [],
    },
  });
  ok('checkup: urgentes + importantes', out.includes('Mais urgentes') && out.includes('Importantes') && out.includes('Luz'));
}

// ---------- 4. Saldos (render): semáforo negativo + empty ----------
{
  ok('saldos: empty', wa.renderBalances({ accounts: [], limiteDisponivel: 0 }).includes('ainda não tem carteiras'));
  const out = wa.renderBalances({
    accounts: [{ name: 'Nubank', balance: 1958.03, icon: '💜' }, { name: 'Cheque', balance: -200, icon: '🏦' }],
    totalSaldo: 1758.03, limiteDisponivel: 3000, totalDisponivel: 4758.03,
  });
  ok('saldos: semáforo 🔴 em saldo negativo', out.includes('🔴'));
  ok('saldos: bloco Posição', out.includes('Posição') && out.includes('Total disponível'));
}

// ---------- 5. Análise do Mês (builder→render): projeção NEGATIVA → Dica vermelha ----------
{
  const model = buildMonthAnalysis({
    monthLabel: 'junho', despesas: 1719.69, receitas: 1735, despesasPrev: 0,
    byCategory: [{ slug: 'mercado', total: 900, count: 3 }, { slug: 'lazer', total: 819.69, count: 5 }],
    saldoAtual: 1958.04, aPagar: 7211.5, overdueCount: 2,
    goals: [{ name: 'Reserva', pct: 25, current: 500, target: 2000 }],
  });
  const out = wa.renderMonthAnalysis(model);
  ok('mês: projeção negativa (saldoProjetado < 0)', model.projecao.saldoProjetado < 0);
  ok('mês: render mostra projeção 🔴', out.includes('Projeção do mês') && out.includes('🔴'));
  ok('mês: Dica do TOM presente', out.includes('Dica do TOM'));
  ok('mês: comparativo +100% (prev 0)', out.includes('Comparativo') && out.includes('Este mês'));
}

// ---------- 6. Gastos do período (builder→render): vazio + populado ----------
{
  ok('gastos: empty-state', wa.renderPeriodExpenses(buildPeriodExpenses({ despesas: 0, byCategory: [], count: 0, days: 7, label: 'Gastos de maio' }, null)).includes('Nenhum gasto'));
  const out = wa.renderPeriodExpenses(buildPeriodExpenses({ despesas: 500, byCategory: [{ slug: 'mercado', total: 300, count: 2 }, { slug: 'lazer', total: 200, count: 1 }], count: 3, days: 7, label: 'Gastos de junho' }, { despesas: 400 }));
  ok('gastos: ranking + comparativo + média diária', out.includes('Top gastos') && out.includes('Comparativo') && out.includes('/dia'));
}

// ---------- 7. Conta (render): semáforos ----------
{
  const base = { name: 'Cofre', icon: '🐷', movement: { lastIn: null, lastOut: null, var7d: { in: 0, out: 0, net: 0 } } };
  ok('conta: saldo 0 → 🟡', wa.renderAccountDetail({ ...base, balance: 0, status: '🟡' }).includes('🟡'));
  ok('conta: saldo negativo → 🔴', wa.renderAccountDetail({ ...base, balance: -50, status: '🔴' }).includes('🔴'));
  ok('conta: sem movimentação', wa.renderAccountDetail({ ...base, balance: 100, status: '✅' }).includes('Sem movimentação'));
}

// ---------- 8. Extrato (builder→render): truncamento + fonte por linha ----------
{
  const many = Array.from({ length: 14 }, (_, i) => ({ type: 'expense', amount: 10, description: `T${i}`, category: 'mercado', transaction_date: '2026-06-01', account_id: i % 2 ? 'a1' : 'a2' }));
  const out = wa.renderStatement(buildStatement(null, many, { label: 'Extrato', limit: 12, sourceMap: { a1: 'Nubank', a2: 'Itaú' } }));
  ok('extrato: trunca em 12 + "+2 ... completo"', out.includes('+2 lançamentos') && out.includes('completo'));
  ok('extrato: fonte por linha', out.includes('_·Nubank_') || out.includes('_·Itaú_'));
  ok('extrato: totais entradas/saídas', out.includes('Entradas') && out.includes('Saídas'));
  ok('extrato: empty', wa.renderStatement(buildStatement({ name: 'Nubank', icon: '💜' }, [], { label: 'Extrato' })).includes('Nenhum lançamento'));
}

// ---------- 9. Diário (builder→render): vazio + com dados ----------
{
  ok('diário: empty', wa.renderDailySummary(buildDailySummary({ label: 'Balanço de hoje', report: { receitas: 0, despesas: 0, count: 0, byCategory: [] }, saldoTotal: 100 })).includes('Sem movimentação hoje'));
  const out = wa.renderDailySummary(buildDailySummary({ label: 'Balanço de hoje', report: { receitas: 400, despesas: 152.3, count: 1, byCategory: [{ slug: 'mercado', total: 152.3, count: 1 }] }, saldoTotal: 1958.04 }));
  ok('diário: balanço + saldo total', out.includes('Balanço') && out.includes('Saldo total'));
}

// ---------- 10. Semanal (builder→render): resultado no vermelho ----------
{
  const out = wa.renderWeeklySummary(buildWeeklySummary({ label: 'Resumo da semana', report: { receitas: 100, despesas: 600, count: 8, byCategory: [{ slug: 'lazer', total: 600, count: 8 }] }, prev: { despesas: 300 } }));
  ok('semana: resultado negativo 🔴', out.includes('🔴'));
  ok('semana: comparativo "Esta semana/Semana anterior"', out.includes('Esta semana') && out.includes('Semana anterior'));
}

// ---------- 11. Fechamento mensal (builder→render): vermelho vs azul, SEM projeção ----------
{
  const verm = wa.renderMonthlyClosing(buildMonthlyClosing({ label: 'Fechamento de maio', report: { receitas: 5000, despesas: 5300, count: 40, byCategory: [{ slug: 'moradia', total: 1500, count: 1 }] }, prev: { despesas: 4800 }, goals: [{ name: 'Viagem', pct: 40, current: 2000, target: 5000 }] }));
  ok('fechamento: resultado 🔴 + dica "vermelho"', verm.includes('🔴') && /vermelho/i.test(verm));
  ok('fechamento: tem metas + Dica do TOM', verm.includes('Metas') && verm.includes('Dica do TOM'));
  ok('fechamento: NÃO tem projeção (distinção vs R-MES)', !verm.includes('Projeção'));
  const azul = wa.renderMonthlyClosing(buildMonthlyClosing({ label: 'Fechamento de abril', report: { receitas: 5000, despesas: 4000, count: 30, byCategory: [] }, prev: null, goals: [] }));
  ok('fechamento: resultado 🟢 + dica "azul"', azul.includes('🟢') && /azul/i.test(azul));
}

console.log(`\nPASS — ${n} asserts de edge-case OK (todos os 11 relatórios).`);
