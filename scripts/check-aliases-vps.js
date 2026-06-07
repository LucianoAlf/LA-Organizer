'use strict';
// Valida o fix de aliases ponta-a-ponta na VPS: pega os 2 markers EXATOS que o LLM
// emitiu no teste do Luciano 07/06 (logs) e confirma parse→canon→dispatch.
// Roda na VPS com env: set -a && . ./.env && set +a && node scripts/check-aliases-vps.js
const assert = require('assert');
const { parseFinanceMarkers, handleFinanceAction } = require('../src/engine');
const MATHEUS = 'daaa4473-81b1-4c77-a926-0fa8423b4607'; // tem conta NUBANK + dados

(async () => {
  const m1 = '<<FINANCE_ACTION>>{"action":"monthly_summary","params":{"month":"2026-05"}}<<END>>';
  const m2 = '<<FINANCE_ACTION>>{"action":"query_balance","params":{"account_name":"Nubank"}}<<END>>';
  const p1 = parseFinanceMarkers(m1);
  const p2 = parseFinanceMarkers(m2);
  assert.strictEqual(p1.malformed, 0, 'm1 não deve ser malformed (antes era REJECTED)');
  assert.strictEqual(p2.malformed, 0, 'm2 não deve ser malformed');
  assert.strictEqual(p1.actions[0] && p1.actions[0].action, 'query_monthly_closing', 'monthly_summary → query_monthly_closing');
  assert.strictEqual(p2.actions[0] && p2.actions[0].action, 'query_account_detail', 'query_balance+conta → query_account_detail');

  const collab = { id: MATHEUS };
  const r1 = await handleFinanceAction(collab, p1.actions[0].action, p1.actions[0].params);
  const r2 = await handleFinanceAction(collab, p2.actions[0].action, p2.actions[0].params);
  console.log('--- m1 "fechamento de maio" →\n' + r1.split('\n').slice(0, 2).join('\n'));
  console.log('--- m2 "saldo do nubank" →\n' + r2.split('\n').slice(0, 3).join('\n'));
  assert.ok(/Fechamento de/.test(r1), 'm1 deve render o fechamento');
  assert.ok(/Saldo atual/.test(r2) && !/tive um problema/i.test(r2), 'm2 deve render o painel da conta (param account_name lido)');

  console.log('\nOK check-aliases-vps — os 2 markers que quebravam agora roteiam certo.');
})().catch((e) => { console.error('FALHOU:', e && e.message); process.exit(1); });
