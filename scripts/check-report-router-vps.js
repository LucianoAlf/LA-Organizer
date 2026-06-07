'use strict';
// Valida o roteador determinístico de relatórios ponta-a-ponta na VPS, simulando o caminho do
// engine (detectReportIntent → check de existência da conta → handleFinanceAction). READ-ONLY.
// Roda: set -a && . ./.env && set +a && node scripts/check-report-router-vps.js
const assert = require('assert');
const { detectReportIntent } = require('../src/finance/detect-report-intent');
const { handleFinanceAction } = require('../src/engine');
const fin = require('../src/services/financeiro-service');
const MATHEUS = 'daaa4473-81b1-4c77-a926-0fa8423b4607'; // tem NUBANK
const TODAY = new Date().toISOString().slice(0, 10);

async function routeLikeEngine(collab, text) {
  const intent = detectReportIntent(text, TODAY);
  if (!intent) return { intent: null, reply: null, routed: false };
  if ((intent.action === 'query_account_detail' || intent.action === 'query_statement') && intent.params.account) {
    const acc = await fin.findAccountByName(collab.id, intent.params.account).catch(() => null);
    if (!acc) return { intent, reply: null, routed: false };
  }
  const reply = await handleFinanceAction(collab, intent.action, intent.params);
  return { intent, reply, routed: true };
}

(async () => {
  const collab = { id: MATHEUS };
  const cases = [
    ['fechamento de maio', 'query_monthly_closing', /Fechamento de maio/],
    ['saldo do nubank', 'query_account_detail', /Saldo atual/],
    ['extrato do nubank', 'query_statement', /Extrato/],
    ['gastos da semana', 'query_weekly_summary', /Resumo da semana|Semana sem/],
    ['quanto gastei essa semana', 'query_weekly_summary', /Resumo da semana|Semana sem/],
  ];
  for (const [text, action, re] of cases) {
    const r = await routeLikeEngine(collab, text);
    assert.ok(r.routed && r.intent && r.intent.action === action, `"${text}" → ${r.intent && r.intent.action} (esp ${action}, routed=${r.routed})`);
    assert.ok(re.test(r.reply || ''), `"${text}" render não bate: ${String(r.reply).slice(0, 50)}`);
    console.log(`✅ "${text}" → ${action} → ${String(r.reply).split('\n')[0]}`);
  }
  const jogo = await routeLikeEngine(collab, 'saldo do jogo');
  assert.ok(!jogo.routed, `"saldo do jogo" NÃO deve rotear (cai no LLM); routed=${jogo.routed}`);
  console.log('✅ "saldo do jogo" → NÃO roteou (conta inexistente → LLM)');
  console.log('\nOK check-report-router-vps');
})().catch((e) => { console.error('FALHOU:', e && e.message); process.exit(1); });
