'use strict';
// ===========================================================================
// E2E da Central de Relatórios Financeiros (F0–F6).
// Dirige os 11 relatórios pelo DISPATCH REAL do engine (handleFinanceAction),
// exatamente como o webhook do WhatsApp faz — READ-ONLY (nenhuma escrita).
// Roda na VPS (precisa de env Supabase + DB). NÃO roda local sem env.
//
// Uso:
//   node scripts/e2e-relatorios.js               # pega o colaborador com mais transações
//   node scripts/e2e-relatorios.js <collabId>    # colaborador específico
//   node scripts/e2e-relatorios.js <collabId> --quiet   # sem imprimir os relatórios
// ===========================================================================
const assert = require('assert');
const engine = require('../src/engine');
const fin = require('../src/services/financeiro-service');
const { money } = require('../src/services/finance-format');
const supabase = require('../src/supabase/client');

const QUIET = process.argv.includes('--quiet');
const PASS = [];
const FAIL = [];
function check(name, cond, detail) {
  if (cond) { PASS.push(name); console.log(`  ✅ ${name}`); }
  else { FAIL.push(`${name}${detail ? ' — ' + detail : ''}`); console.log(`  ❌ ${name}${detail ? ' — ' + detail : ''}`); }
}

async function pickCollab(argId) {
  if (argId && !argId.startsWith('--')) {
    const { data } = await supabase.from('collaborators').select('id, full_name').eq('id', argId).single();
    return data;
  }
  const { data } = await supabase.from('pf_transactions').select('collaborator_id');
  const counts = {};
  for (const r of (data || [])) counts[r.collaborator_id] = (counts[r.collaborator_id] || 0) + 1;
  const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  if (!top) return null;
  const { data: c } = await supabase.from('collaborators').select('id, full_name').eq('id', top[0]).single();
  return c;
}

async function run() {
  const collab = await pickCollab(process.argv[2]);
  assert(collab && collab.id, 'colaborador não encontrado');
  const cid = collab.id;
  console.log(`\n🧪 E2E Relatórios — ${collab.full_name} (${cid})\n`);

  const accounts = await fin.listAccounts(cid);
  const acctName = accounts[0] ? accounts[0].name : 'Nubank';
  const now = new Date();
  const monthStart = `${now.toISOString().slice(0, 8)}01`;
  const today = now.toISOString().slice(0, 10);
  const periodCur = await fin.queryPeriodReport(cid, monthStart, today);
  const mcb = await fin.monthCategoryBreakdown(cid, now);

  // [action, params, assinaturas aceitas (ALGUMA deve aparecer — cobre dados E empty-state)]
  const CASES = [
    ['query_fixed_bills', {}, ['Suas Contas Fixas']],
    ['query_bills_to_pay', {}, ['Suas Contas a Pagar', 'vencem dia', 'Tá tudo pago', 'Nada em aberto']],
    ['query_checkup', {}, ['Checkup das contas']],
    ['query_accounts', {}, ['Seus Saldos', 'ainda não tem carteiras']],
    ['query_month_analysis', {}, ['Análise de']],
    ['query_period_expenses', {}, ['Gastos de', 'Gastos do período', 'Nenhum gasto']],
    ['query_account_detail', { account: acctName }, ['Saldo atual', 'Não achei essa carteira', 'ainda não tem carteiras']],
    ['query_statement', { account: acctName }, ['Extrato', 'Nenhum lançamento']],
    ['query_daily_summary', {}, ['Balanço de hoje', 'Sem movimentação hoje']],
    ['query_weekly_summary', {}, ['Resumo da semana', 'Semana sem movimentação']],
    ['query_monthly_closing', {}, ['Fechamento de']],
  ];

  const outputs = {};
  for (const [action, params, sigs] of CASES) {
    let out;
    try { out = await engine.handleFinanceAction(collab, action, params); }
    catch (e) { check(`${action}: sem exceção`, false, e.message); continue; }
    outputs[action] = out;
    check(`${action}: string não-vazia`, typeof out === 'string' && out.trim().length > 0);
    check(`${action}: assinatura presente`, sigs.some((s) => out && out.includes(s)), `esperava uma de [${sigs.join(' | ')}]`);
    if (!QUIET) console.log(`  ── ${action} ──\n${String(out || '').split('\n').map((l) => '     ' + l).join('\n')}\n`);
  }

  // ---- Reconciliação numérica (mesma fonte → mesmos números entre relatórios) ----
  if (mcb.despesas > 0) {
    check('reconcil.: month_analysis traz a despesa do mês',
      String(outputs.query_month_analysis || '').includes(money(mcb.despesas)), `desp=${money(mcb.despesas)}`);
  }
  if (periodCur.despesas > 0) {
    check('reconcil.: period_expenses traz a despesa do período',
      String(outputs.query_period_expenses || '').includes(money(periodCur.despesas)), `desp=${money(periodCur.despesas)}`);
  }
  if (mcb.despesas === 0 && periodCur.despesas === 0) {
    console.log('  (mês corrente sem despesas — reconciliação numérica pulada)');
  }

  console.log(`\n=== RESULTADO E2E (${collab.full_name}): ${PASS.length} OK, ${FAIL.length} falha(s) ===`);
  if (FAIL.length) { FAIL.forEach((f) => console.log('  ❌ ' + f)); process.exit(1); }
  console.log('PASS — 11 relatórios renderizaram pelo pipeline real do engine.');
}
run().catch((e) => { console.error('ERRO E2E:', e && e.stack || e); process.exit(1); });
