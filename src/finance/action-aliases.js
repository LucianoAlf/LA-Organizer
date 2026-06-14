'use strict';
// Normaliza nomes de ação financeira que o LLM às vezes "inventa" (sinônimos plausíveis)
// para o nome canônico do engine. Defense-in-depth: o LLM emitiu marker VÁLIDO com nome
// fora da lista (ex.: monthly_summary, query_balance) → era rejeitado como action_invalida
// e o relatório não vinha. Em vez de culpar o LLM, o parser tolera o sinônimo.
// (Precedente: LIST-ADD-NO-MARKER 04/06 — handler tolerante a variações de nome/campo.)
// Caso real Luciano 07/06: "fechamento de maio"→monthly_summary; "saldo do nubank"→query_balance.

const ALIASES = {
  // Fechamento mensal (mês FECHADO) → query_monthly_closing
  monthly_summary: 'query_monthly_closing', month_summary: 'query_monthly_closing',
  monthly_closing: 'query_monthly_closing', month_closing: 'query_monthly_closing',
  close_month: 'query_monthly_closing', monthly_report: 'query_monthly_closing',
  monthly_close: 'query_monthly_closing', query_monthly_summary: 'query_monthly_closing',
  query_month_closing: 'query_monthly_closing', month_review: 'query_monthly_closing',
  // Resumo semanal financeiro → query_weekly_summary
  weekly_summary: 'query_weekly_summary', week_summary: 'query_weekly_summary',
  weekly_report: 'query_weekly_summary', weekly_review: 'query_weekly_summary',
  query_week_summary: 'query_weekly_summary',
  // Resumo diário → query_daily_summary
  daily_summary: 'query_daily_summary', day_summary: 'query_daily_summary',
  daily_report: 'query_daily_summary', daily_balance: 'query_daily_summary',
  query_day_summary: 'query_daily_summary',
  // Gastos do período → query_period_expenses
  period_expenses: 'query_period_expenses', expenses: 'query_period_expenses',
  spending: 'query_period_expenses', query_expenses: 'query_period_expenses',
  query_spending: 'query_period_expenses', expense_report: 'query_period_expenses',
  // Extrato → query_statement (NÃO o query_transactions antigo)
  statement: 'query_statement', account_statement: 'query_statement',
  query_account_statement: 'query_statement', extrato: 'query_statement',
  // Painel da conta → query_account_detail
  account_detail: 'query_account_detail', query_account: 'query_account_detail',
  account_panel: 'query_account_detail',
  // Saldos consolidados → query_accounts
  balances: 'query_accounts', query_balances: 'query_accounts', query_saldos: 'query_accounts',
  // Análise do mês corrente (com projeção) → query_month_analysis
  month_analysis: 'query_month_analysis',
  // Checkup → query_checkup
  checkup: 'query_checkup', bills_checkup: 'query_checkup',
  // Contas em aberto → query_bills_to_pay
  bills_to_pay: 'query_bills_to_pay', open_bills: 'query_bills_to_pay', due_bills: 'query_bills_to_pay',
  // Contas fixas (relação completa) → query_fixed_bills
  fixed_bills: 'query_fixed_bills', all_bills: 'query_fixed_bills',
  // Excluir conta fixa → delete_bill
  remove_bill: 'delete_bill', deactivate_bill: 'delete_bill', cancel_bill: 'delete_bill',
  delete_fixed_bill: 'delete_bill', remove_fixed_bill: 'delete_bill', deletar_conta: 'delete_bill',
};

// "saldo/balance" é ambíguo: 1 conta (painel) vs todas (saldos consolidados) → decide pelo param.
const SALDO_WORDS = ['query_balance', 'account_balance', 'balance', 'saldo', 'query_saldo'];

// action: nome emitido pelo LLM. params: params do marker. validList: FINANCE_ACTIONS (canônicas).
// Devolve o nome canônico (ou o original se não houver alias — aí o validador rejeita como antes).
function canonFinanceAction(action, params, validList) {
  if (!action) return action;
  const a = String(action).trim();
  const valid = Array.isArray(validList) ? validList : [];
  if (valid.includes(a)) return a; // já canônico — não mexe
  const low = a.toLowerCase();
  if (SALDO_WORDS.includes(low)) {
    const p = params || {};
    const hasAcct = !!(p.account || p.account_name || p.name || p.card);
    return hasAcct ? 'query_account_detail' : 'query_accounts';
  }
  return ALIASES[low] || a;
}

module.exports = { canonFinanceAction, ALIASES, SALDO_WORDS };
