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
    if (params) for (const k of Object.keys(params)) assert.strictEqual(r.params[k], params[k], `"${text}" param ${k}=${r.params[k]} (esp ${params[k]})`);
  } catch (e) { console.error('❌', e.message); fail++; }
}
function none(text) {
  const r = R(text);
  try { assert.strictEqual(r, null, `NÃO deveria casar: "${text}" → ${JSON.stringify(r)}`); }
  catch (e) { console.error('❌', e.message); fail++; }
}

// ===================== MUST MATCH =====================
must('fechamento de maio', 'query_monthly_closing', { month: '2026-05' });
must('fechamento do mês', 'query_monthly_closing');
must('fechamento do mês passado', 'query_monthly_closing');
must('resumo de abril', 'query_monthly_closing', { month: '2026-04' });
must('resumo do mes de maio', 'query_monthly_closing', { month: '2026-05' });
must('como fechou maio', 'query_monthly_closing', { month: '2026-05' });
must('fechamento de maio de 2025', 'query_monthly_closing', { month: '2025-05' });
must('resumo de novembro de 2025', 'query_monthly_closing', { month: '2025-11' });
must('saldo do nubank', 'query_account_detail', { account: 'nubank' });
must('qual o saldo do itau', 'query_account_detail', { account: 'itau' });
must('saldo do nubank de maio', 'query_account_detail', { account: 'nubank' });
must('saldo da conta corrente', 'query_account_detail', { account: 'conta corrente' });
must('meus saldos', 'query_accounts');
must('qual o saldo', 'query_accounts');
must('quanto tenho no total', 'query_accounts');
must('saldo de todas as contas', 'query_accounts');
must('saldo total', 'query_accounts');
must('extrato do nubank', 'query_statement', { account: 'nubank' });
must('extrato', 'query_statement');
must('extrato do mes', 'query_statement');
must('extrato de maio', 'query_statement', { month: '2026-05' });
must('extrato do nubank de maio', 'query_statement', { account: 'nubank', month: '2026-05' });
must('extrato do banco do brasil de maio', 'query_statement', { account: 'banco do brasil', month: '2026-05' });
must('lançamentos de maio', 'query_statement', { month: '2026-05' });
must('gastos da semana', 'query_weekly_summary');
must('quanto gastei essa semana', 'query_weekly_summary');
must('quanto gastei essa semana?', 'query_weekly_summary');
must('resumo financeiro da semana', 'query_weekly_summary');
must('gastos de hoje', 'query_daily_summary');
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
must('quanto preciso pagar esse mês', 'query_bills_to_pay');
must('vence dia 10', 'query_bills_to_pay', { due_day: 10 });
must('o que vence essa semana', 'query_bills_to_pay');
must('contas atrasadas', 'query_bills_to_pay');

// ============ MUST NOT MATCH (regressão adversarial — 95 bugs) ============
// saldo + verbo de ajuste/transação
for (const s of ['adiciona 200 no saldo do nubank', 'poe 100 no saldo do nubank', 'coloca 200 no saldo do nubank',
  'ajusta o saldo do nubank pra 500', 'corrige o saldo do nubank', 'zera o saldo do nubank', 'seta o saldo do nubank em 1000',
  'atualiza o saldo do nubank', 'tira do saldo do nubank', 'desconta 40 do saldo do nubank', 'caiu 500 no saldo do nubank',
  'entrou 200 no saldo do nubank', 'paguei 80 com saldo do nubank', 'gastei usando o saldo do nubank',
  'o saldo do nubank ta errado conserta', 'poe no saldo do nubank mais 100', 'saldo do nubank pra 500']) none(s);
// saldo + substantivo não-conta
for (const s of ['saldo do projeto', 'qual o saldo do time', 'saldo do contrato', 'qual o saldo de horas']) none(s);
// weekly/daily/period + categoria
for (const s of ['quanto gastei essa semana em lazer', 'quanto gastei essa semana com uber', 'gastos da semana no mercado',
  'gastos da semana com alimentacao', 'balanço da semana de trabalho', 'quanto gastei hoje no ifood',
  'gastos de hoje com alimentacao', 'quanto gastei em maio com mercado', 'gastos de maio com mercado',
  'quanto gastei em junho no nubank', 'quanto gastei em alimentação', 'meus últimos gastos']) none(s);
// dia ambíguo (trabalho) → LLM decide
for (const s of ['resumo do dia', 'balanço do dia', 'resumo da semana']) none(s);
// extrato + não-conta
for (const s of ['extrato do projeto', 'extrato do trabalho', 'extrato do ano', 'extrato do meu dia', 'extrato das atividades']) none(s);
// fechamento/análise não-financeiro
for (const s of ['fechamento do contrato', 'fechamento da obra', 'fechamento do projeto', 'fechamento do mes de trabalho',
  'como fechou a reuniao', 'como fechou o trimestre', 'fechamento da semana', 'qual o resumo de maio do projeto',
  'resumo do mes de trabalho', 'analise do mes da equipe', 'analisa as contas da reuniao de amanha', 'resumo do mes passado de vendas']) none(s);
// checkup/bills não-financeiro
for (const s of ['checkup do carro', 'checkup do sistema', 'checkup geral da equipe', 'tem problema nas contas do projeto',
  'alguma conta atrasada do projeto', 'o que vence essa reuniao', 'vence dia 10 a reuniao']) none(s);
// registro de transação / não-finanças
for (const s of ['50 de combustível no débito', 'gastei 30 no ifood', 'recebi 500 de comissão', 'paguei a fatura do nubank',
  'comprei TV 3200 em 10x no nubank', 'minhas últimas transações', 'bom dia, tom!', 'marca a reunião amanhã às 10h',
  'me lembra de estudar pro simulado', 'cria carteira nubank', 'transferi 500 do itau pro nubank', 'comprovante']) none(s);

// ===== Rodada adversarial 2 — misses corrigidos (MUST) =====
must('saldo atual do nubank', 'query_account_detail', { account: 'nubank' });
must('saldo atual da conta corrente', 'query_account_detail', { account: 'conta corrente' });
must('qual o saldo atual do nubank', 'query_account_detail', { account: 'nubank' });
must('saldo disponivel do nubank', 'query_account_detail', { account: 'nubank' });
must('me ve o saldo do nubank', 'query_account_detail', { account: 'nubank' });
must('ve o saldo do nubank', 'query_account_detail', { account: 'nubank' });
must('saldo do c6', 'query_account_detail', { account: 'c6' });

// ===== Rodada adversarial 2 — over-matches (NONE) =====
for (const s of [
  'meu saldo do nubank diminuiu', 'saldo do nubank subiu', 'saldo do nubank zerou', 'saldo da poupanca caiu', 'saldo da carteira acabou',
  'ver extrato do nubank pra pagar', 'extrato do nubank ta errado', 'extrato do nubank ja paguei', 'extrato do itau foi debitado',
  'extrato de maio eu ja conferi', 'lancamentos de maio foram pagos', 'extrato de junho ja conferido',
  'fechamento de maio paguei tudo', 'fechamento de abril ja quitei', 'fechamento de maio ja recebi',
  'paga minhas contas fixas', 'quita todas as contas',
  'onde gasto mais no nubank', 'onde gasto mais no ifood', 'onde gasto mais com uber', 'onde gasto mais em alimentacao', 'onde gasto mais tempo', 'onde gasto mais minha energia',
  'fechamento de maio do projeto', 'fechamento de maio do contrato', 'fechamento de junho do show', 'como fechou maio no projeto', 'como fechou o mês de maio do projeto',
  'resumo do mês de maio do projeto', 'resumo do mês de junho do time',
  'extrato da reunião', 'saldo da reunião',
]) none(s);

// ===== Rodada adversarial 3 — misses corrigidos (MUST) =====
must('fechamento do mês de maio', 'query_monthly_closing', { month: '2026-05' });
must('como fechou o mês de maio', 'query_monthly_closing', { month: '2026-05' });
must('resumo financeiro de maio', 'query_monthly_closing', { month: '2026-05' });
must('resumo financeiro do mês de maio', 'query_monthly_closing', { month: '2026-05' });
must('saldo do nubank hoje', 'query_account_detail', { account: 'nubank' });
must('saldo do nubank agora', 'query_account_detail', { account: 'nubank' });
must('saldo do nubank por favor', 'query_account_detail', { account: 'nubank' });
must('me ve o extrato do nubank', 'query_statement', { account: 'nubank' });

// ===== Rodada adversarial 3 — prefixos não-consulta (NONE) =====
for (const s of [
  'ja paguei o que vence hoje', 'ja paguei as contas a pagar', 'ja paguei minhas contas fixas', 'ja quitei as contas a pagar',
  'nao tenho contas a pagar', 'lembra que vence dia 10', 'essa conta vence dia 10', 'o boleto vence dia 15',
  'cadastra minhas contas fixas', 'cadastrar minhas contas fixas', 'quero cadastrar minhas contas fixas', 'vou cadastrar minhas contas fixas',
  'ja conferi meus saldos', 'meus saldos estao errados', 'ja vi o extrato do nubank', 'ja fiz o fechamento de maio',
  'tenho ideia de quanto gastei', 'to assustado com quanto gastei', 'me arrependi do quanto gastei', 'deus sabe quanto gastei esse mes',
  'nem sei quanto gastei essa semana', 'nem quero saber quanto gastei essa semana', 'nao acredito no quanto gastei essa semana',
  'perdi a conta de quanto gastei hoje', 'esqueci quanto gastei hoje', 'ja sei quanto gastei',
]) none(s);

// ===== Rodada adversarial 4 — mês corrente + ano + strips =====
// today=2026-06-07 → junho = mês CORRENTE → analysis; meses passados → closing
must('resumo de junho', 'query_month_analysis');
must('como fechou junho', 'query_month_analysis');
must('analise de junho', 'query_month_analysis');
must('analise de maio', 'query_monthly_closing', { month: '2026-05' });
must('resumo do mes atual', 'query_month_analysis');
must('resumo do mês anterior', 'query_monthly_closing');
must('resumo do mês passado', 'query_monthly_closing');
must('quanto gastei em maio de 2025', 'query_period_expenses', { month: '2025-05' });
must('gastos de maio de 2026', 'query_period_expenses', { month: '2026-05' });
must('extrato do nubank maio', 'query_statement', { account: 'nubank', month: '2026-05' });
must('saldo do nubank ontem', 'query_account_detail', { account: 'nubank' });
must('extrato do nubank de ontem', 'query_statement', { account: 'nubank' });
must('saldo da conta', 'query_accounts');
must('saldo da minha conta', 'query_accounts');
must('saldo na conta', 'query_accounts');
for (const s of ['extrato do nubank transferi', 'saldo do nubank comprei', 'extrato do nubank ja paguei']) none(s);

if (fail) { console.error(`\nFALHOU: ${fail} caso(s).`); process.exit(1); }
console.log('PASS — smoke-report-intent (must + 170+ regressões adversariais OK).');
