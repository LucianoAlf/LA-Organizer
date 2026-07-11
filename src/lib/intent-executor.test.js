'use strict';
// INTENT-CLOBBER-BATCH-COMPLETE (Fabi 30/06) — rodar: node --test src/lib/intent-executor.test.js
const test = require('node:test');
const assert = require('node:assert');
const { intentCarriesDeterministicExecutor } = require('./intent-executor');

test('Fabi: intent com batch_complete NÃO-vazio é executor determinístico (não pode ser clobrada)', () => {
  assert.strictEqual(
    intentCarriesDeterministicExecutor({ batch_complete: ['6fcd866e', '238e5045'] }),
    true
  );
});

test('anchor (guarda temporal) continua protegido — GUARD-CONFIRM-LOOP', () => {
  assert.strictEqual(
    intentCarriesDeterministicExecutor({ anchor: { type: 'task', id: 'abc', title: 'x' }, action: 'complete' }),
    true
  );
});

test('intent genérica de rastreio (last_tom_reply/last_user_text) NÃO é executor → pode abrir', () => {
  assert.strictEqual(
    intentCarriesDeterministicExecutor({ last_tom_reply: 'Confirma?', last_user_text: 'trabalhos feitos' }),
    false
  );
});

test('batch_complete VAZIO não conta (nada a executar)', () => {
  assert.strictEqual(intentCarriesDeterministicExecutor({ batch_complete: [] }), false);
});

test('batch_complete não-array não conta', () => {
  assert.strictEqual(intentCarriesDeterministicExecutor({ batch_complete: 'x' }), false);
});

test('anchor null explícito não conta', () => {
  assert.strictEqual(intentCarriesDeterministicExecutor({ anchor: null }), false);
});

test('payload nulo/indefinido/não-objeto é seguro (false)', () => {
  assert.strictEqual(intentCarriesDeterministicExecutor(null), false);
  assert.strictEqual(intentCarriesDeterministicExecutor(undefined), false);
  assert.strictEqual(intentCarriesDeterministicExecutor('batch_complete'), false);
  assert.strictEqual(intentCarriesDeterministicExecutor(42), false);
});

test('payload de finance_source (source hint) NÃO é executor de fechamento', () => {
  assert.strictEqual(intentCarriesDeterministicExecutor({ card: 'nubank', amount: 100 }), false);
});

// COORD-CONFIRM-INTENT-CLOBBER (Fabi 11/07): a rede de coordenação é o 3º executor determinístico.
test('COORD (Fabi 11/07): intent com coordination.items é executor determinístico (não pode ser clobrada)', () => {
  assert.strictEqual(
    intentCarriesDeterministicExecutor({ coordination: { items: [{ recipient_name: 'Luciano', mode: 'relay_assisted' }] } }),
    true
  );
});

test('coordination.items VAZIO não conta', () => {
  assert.strictEqual(intentCarriesDeterministicExecutor({ coordination: { items: [] } }), false);
});

test('coordination sem items / items não-array não conta', () => {
  assert.strictEqual(intentCarriesDeterministicExecutor({ coordination: {} }), false);
  assert.strictEqual(intentCarriesDeterministicExecutor({ coordination: { items: 'x' } }), false);
});
