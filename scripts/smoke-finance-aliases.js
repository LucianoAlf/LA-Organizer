'use strict';
const assert = require('assert');
const { canonFinanceAction } = require('D:/la-organizer/_remote/src/finance/action-aliases');
const VALID = ['query_monthly_closing', 'query_weekly_summary', 'query_daily_summary', 'query_period_expenses', 'query_statement', 'query_account_detail', 'query_accounts', 'query_month_analysis', 'query_checkup', 'query_bills_to_pay', 'query_fixed_bills', 'query_transactions', 'register_transaction'];

// casos REAIS dos logs (Luciano 07/06)
assert.strictEqual(canonFinanceAction('monthly_summary', { month: '2026-05' }, VALID), 'query_monthly_closing', 'fechamento de maio');
assert.strictEqual(canonFinanceAction('query_balance', { account_name: 'Nubank' }, VALID), 'query_account_detail', 'saldo do nubank (com conta)');
assert.strictEqual(canonFinanceAction('query_balance', {}, VALID), 'query_accounts', 'saldo sem conta → saldos consolidados');

// outros sinônimos plausíveis
assert.strictEqual(canonFinanceAction('statement', {}, VALID), 'query_statement');
assert.strictEqual(canonFinanceAction('weekly_summary', {}, VALID), 'query_weekly_summary');
assert.strictEqual(canonFinanceAction('daily_summary', {}, VALID), 'query_daily_summary');
assert.strictEqual(canonFinanceAction('expenses', {}, VALID), 'query_period_expenses');
assert.strictEqual(canonFinanceAction('account_balance', { account: 'Itau' }, VALID), 'query_account_detail');
assert.strictEqual(canonFinanceAction('month_analysis', {}, VALID), 'query_month_analysis');

// canônico e não-relatório passam direto
assert.strictEqual(canonFinanceAction('query_statement', {}, VALID), 'query_statement', 'passthrough canônico');
assert.strictEqual(canonFinanceAction('register_transaction', {}, VALID), 'register_transaction', 'ação não-relatório intacta');

// desconhecido de verdade → devolve original (validador rejeita como antes)
assert.strictEqual(canonFinanceAction('foo_bar', {}, VALID), 'foo_bar', 'desconhecido inalterado');

console.log('OK smoke-finance-aliases');
