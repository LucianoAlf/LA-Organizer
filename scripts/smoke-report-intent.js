'use strict';
const assert = require('assert');
const { detectReportIntent } = require('D:/la-organizer/_remote/src/finance/detect-report-intent');
const TODAY = '2026-06-07';
const R = (t) => detectReportIntent(t, TODAY);

let fail = 0;
function must(text, action, params) {
  const r = R(text);
  try {
    assert.ok(r, `DEVERIA casar: "${text}"`);
    assert.strictEqual(r.action, action, `"${text}" → ${r && r.action} (esperado ${action})`);
    if (params) for (const k of Object.keys(params)) assert.strictEqual(r.params[k], params[k], `"${text}" param ${k}=${r.params[k]} (esperado ${params[k]})`);
  } catch (e) { console.error('❌', e.message); fail++; }
}
function none(text) {
  const r = R(text);
  try { assert.strictEqual(r, null, `NÃO deveria casar: "${text}" → ${r && r.action}`); }
  catch (e) { console.error('❌', e.message); fail++; }
}

// ===== MUST MATCH (casos reais do teste do Luciano + variações) =====
must('fechamento de maio', 'query_monthly_closing', { month: '2026-05' });
must('fechamento do mês', 'query_monthly_closing');
must('resumo de abril', 'query_monthly_closing', { month: '2026-04' });
must('como fechou maio', 'query_monthly_closing', { month: '2026-05' });
must('saldo do nubank', 'query_account_detail', { account: 'nubank' });
must('qual o saldo do itau', 'query_account_detail', { account: 'itau' });
must('meus saldos', 'query_accounts');
must('meu saldo', 'query_accounts');
must('quanto tenho no total', 'query_accounts');
must('extrato do nubank', 'query_statement', { account: 'nubank' });
must('extrato', 'query_statement');
must('extrato de maio', 'query_statement', { month: '2026-05' });
must('lançamentos de maio', 'query_statement', { month: '2026-05' });
must('gastos da semana', 'query_weekly_summary');
must('quanto gastei essa semana', 'query_weekly_summary');
must('quanto gastei essa semana?', 'query_weekly_summary');
must('resumo financeiro da semana', 'query_weekly_summary');
must('resumo do dia', 'query_daily_summary');
must('balanço do dia', 'query_daily_summary');
must('quanto gastei hoje', 'query_daily_summary');
must('quanto gastei', 'query_period_expenses');
must('quanto gastei esse mês', 'query_period_expenses');
must('gastos do mês', 'query_period_expenses');
must('onde gasto mais', 'query_period_expenses');
must('quanto gastei em abril', 'query_period_expenses', { month: '2026-04' });
must('resumo do mês', 'query_month_analysis');
must('analisa minhas contas', 'query_month_analysis');
must('checkup', 'query_checkup');
must('tem problema nas contas', 'query_checkup');
must('minhas contas fixas', 'query_fixed_bills');
must('todas as contas', 'query_fixed_bills');
must('contas a pagar', 'query_bills_to_pay');
must('o que falta pagar', 'query_bills_to_pay');
must('vence dia 10', 'query_bills_to_pay', { due_day: 10 });
must('contas atrasadas', 'query_bills_to_pay');
must('quanto preciso pagar esse mês', 'query_bills_to_pay');

// ===== MUST NOT MATCH (cai no LLM) =====
none('50 de combustível no débito');
none('gastei 30 no ifood');
none('recebi 500 de comissão');
none('paguei a fatura do nubank');
none('comprei TV 3200 em 10x no nubank');
none('quanto gastei em alimentação');   // categoria, não período → query_transactions
none('minhas últimas transações');
none('meus últimos gastos');
none('últimos gastos em transporte');
none('resumo da semana');                // PURO = resumo de TRABALHO
none('bom dia, tom!');
none('marca a reunião amanhã às 10h');
none('me lembra de estudar pro simulado');
none('cria carteira nubank');
none('transferi 500 do itau pro nubank');
none('comprovante');

if (fail) { console.error(`\nFALHOU: ${fail} caso(s).`); process.exit(1); }
console.log('PASS — smoke-report-intent (must-match + must-not-match OK).');
