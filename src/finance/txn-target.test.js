const { test } = require('node:test');
const assert = require('node:assert');
const { resolveTxnTarget } = require('./txn-target');

const cands = [
  { id: 't1', amount: 30, category: 'transporte', description: 'Uber', transaction_date: '2026-05-31' },
  { id: 't2', amount: 80, category: 'alimentacao', description: 'Mercado', transaction_date: '2026-05-31' },
  { id: 't3', amount: 30, category: 'lazer', description: 'Cinema', transaction_date: '2026-05-31' },
];

test('"essa"/vazio → o mais recente', () => {
  assert.deepStrictEqual(resolveTxnTarget('exclui essa', cands), { kind: 'one', txn: cands[0] });
  assert.deepStrictEqual(resolveTxnTarget('', cands), { kind: 'one', txn: cands[0] });
  assert.deepStrictEqual(resolveTxnTarget('apaga a última', cands), { kind: 'one', txn: cands[0] });
});
test('nome único → one', () => {
  assert.deepStrictEqual(resolveTxnTarget('a do mercado', cands), { kind: 'one', txn: cands[1] });
});
test('nome ambíguo / valor repetido → many', () => {
  const r = resolveTxnTarget('a de 30', cands);
  assert.strictEqual(r.kind, 'many');
  assert.strictEqual(r.candidates.length, 2);
});
test('valor único → one', () => {
  assert.deepStrictEqual(resolveTxnTarget('era 80', cands), { kind: 'one', txn: cands[1] });
});
test('sem candidatos → none', () => {
  assert.deepStrictEqual(resolveTxnTarget('exclui essa', []), { kind: 'none' });
});
test('texto sem ref → assume o recente', () => {
  assert.deepStrictEqual(resolveTxnTarget('muda a categoria pra lazer', cands), { kind: 'one', txn: cands[0] });
});
test('artigo simples casa nome ("exclui o uber")', () => {
  assert.deepStrictEqual(resolveTxnTarget('exclui o uber', cands), { kind: 'one', txn: cands[0] });
});
test('candidato sem descrição não quebra (description null)', () => {
  const c2 = [{ id: 'x', amount: 12, category: 'outros', description: null, transaction_date: '2026-05-31' }];
  // "essa" → recente; não estoura no byName apesar de description null
  assert.deepStrictEqual(resolveTxnTarget('essa', c2), { kind: 'one', txn: c2[0] });
});

// ── FATIA #2 (16/08): fail-closed no alvo errado destrutivo (caso Rose "apaga fatura Itaú
// de R$950,21" → apagou Canva). Especificidade que não bate NÃO pode chutar o mais recente. ──
test('VALOR especificado sem match → none (não chuta o recente)', () => {
  assert.deepStrictEqual(resolveTxnTarget('era 999', cands), { kind: 'none' });
});
test('caso Rose: "apaga a fatura Itaú de R$950,21" (valor 950 não casa) → none', () => {
  assert.deepStrictEqual(resolveTxnTarget('apaga a fatura Itaú de R$950,21', cands), { kind: 'none' });
});
test('valor não casa MAS nome casa → usa o nome (não fail-closa cedo demais)', () => {
  // "a do mercado de 999": 999 não casa, mas "mercado" casa → Mercado.
  assert.deepStrictEqual(resolveTxnTarget('apaga a do mercado de 999', cands), { kind: 'one', txn: cands[1] });
});
test('NOME-ref inexistente (sem valor): "apaga a fatura do Itaú" → none', () => {
  assert.deepStrictEqual(resolveTxnTarget('apaga a fatura do Itaú', cands), { kind: 'none' });
});
test('NOME-ref inexistente: "apaga a farmácia" → none', () => {
  assert.deepStrictEqual(resolveTxnTarget('apaga a farmácia', cands), { kind: 'none' });
});
// NÃO-REGRESSÃO explícita dos caminhos legítimos (o mais delicado é o edit "pra lazer"):
test('NÃO-REGRESSÃO: "muda a categoria pra lazer" segue no mais recente', () => {
  assert.deepStrictEqual(resolveTxnTarget('muda a categoria pra lazer', cands), { kind: 'one', txn: cands[0] });
});
test('NÃO-REGRESSÃO: "apaga a última" e "exclui essa" seguem no mais recente', () => {
  assert.deepStrictEqual(resolveTxnTarget('apaga a última', cands), { kind: 'one', txn: cands[0] });
  assert.deepStrictEqual(resolveTxnTarget('exclui essa', cands), { kind: 'one', txn: cands[0] });
});
