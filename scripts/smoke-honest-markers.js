// scripts/smoke-honest-markers.js
// Fatia C — prova da LÓGICA do gate de markers honestos (FINANCE_ACTION + SHOP_ACTION).
// Replica EXATAMENTE o cálculo do engine: ação de ESCRITA que não persistiu → 'skipped';
// ação de escrita que persistiu OU ação de leitura (query_*) → 'executed'.
// Rodar: node scripts/smoke-honest-markers.js
'use strict';

// Mesmos sets literais do engine.js (mantém em sincronia).
const FIN_WRITE = new Set([
  'register_transaction', 'card_purchase', 'delete_transaction', 'edit_transaction',
  'register_bill', 'pay_bill', 'create_goal', 'update_goal', 'edit_goal', 'delete_goal',
  'set_budget', 'create_account', 'edit_account', 'create_card', 'pay_invoice', 'transfer',
]);
const SHOP_WRITE = new Set(['shop_sale', 'shop_entry', 'shop_adjust', 'shop_estorno', 'shop_reserve', 'shop_pendencia']);

function resultFor(writeSet, action, persisted) {
  return (writeSet.has(action) && !persisted) ? 'skipped' : 'executed';
}

const CASES = [
  // [writeSet, action, persisted, esperado]
  [FIN_WRITE, 'register_transaction', false, 'skipped'],   // pediu fonte / coaching → NÃO mente 'executed'
  [FIN_WRITE, 'register_transaction', true,  'executed'],   // gravou de verdade
  [FIN_WRITE, 'card_purchase',        false, 'skipped'],
  [FIN_WRITE, 'card_purchase',        true,  'executed'],
  [FIN_WRITE, 'edit_transaction',     false, 'skipped'],    // "não achei lançamento" → skipped
  [FIN_WRITE, 'transfer',             true,  'executed'],
  [FIN_WRITE, 'pay_bill',             false, 'skipped'],
  [FIN_WRITE, 'query_transactions',   false, 'executed'],   // leitura: sempre executed
  [FIN_WRITE, 'query_accounts',       false, 'executed'],
  [FIN_WRITE, 'query_statement',      false, 'executed'],
  [SHOP_WRITE, 'shop_sale',           false, 'skipped'],    // "qual produto?" → skipped
  [SHOP_WRITE, 'shop_sale',           true,  'executed'],
  [SHOP_WRITE, 'shop_entry',          true,  'executed'],
  [SHOP_WRITE, 'shop_adjust',         false, 'skipped'],
  [SHOP_WRITE, 'shop_pendencia',      true,  'executed'],
  [SHOP_WRITE, 'query_shop',          false, 'executed'],   // leitura: sempre executed
];

let ok = true;
console.log('=== Gate de markers honestos (Fatia C) ===');
for (const [set, action, persisted, esperado] of CASES) {
  const got = resultFor(set, action, persisted);
  const pass = got === esperado;
  if (!pass) ok = false;
  console.log(`${pass ? '✅' : '❌'} ${action} persisted=${persisted} → ${got} (esperado ${esperado})`);
}

console.log(ok ? '\n🟢 SMOKE PASS' : '\n🔴 SMOKE FAIL');
process.exit(ok ? 0 : 1);
