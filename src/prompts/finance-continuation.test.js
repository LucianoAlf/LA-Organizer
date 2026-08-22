// src/prompts/finance-continuation.test.js · node --test src/prompts/finance-continuation.test.js
// RECUSA-FALSA-CAI-COM-SKILL (Rose 16/07). Sem palavra de dinheiro, a skill de finança caía e a
// rede que intercepta a recusa falsa caía junto. Este helper mantém finança viva na continuação
// de um fluxo de fatura/lançamento.
const { test } = require('node:test');
const assert = require('node:assert');
const { financeInvoiceContinuation } = require('./finance-continuation');

const roseOut = 'sim, rose, recebi esse também ✅ todas as partes chegaram. quer que eu passe a lista dos itens que faltam lançar (r$ 1.369,83, de 21/06 a 01/07) pra você ir';

test('CASO ROSE: outbound de fatura aberto + "lança pra mim o que falta" → continua finança', () => {
  assert.strictEqual(financeInvoiceContinuation({ userText: 'lança pra mim o que falta pfvr, tom', recentOutbound: roseOut }), true);
});

test('insistência "Lança esse pra mim por favor" também continua', () => {
  assert.strictEqual(financeInvoiceContinuation({ userText: 'Tom, você já lançou várias vezes. Lança esse pra mim por favor.', recentOutbound: roseOut }), true);
});

test('ANTI-OVERFIT: "lança" SEM fluxo de fatura no outbound NÃO ativa', () => {
  assert.strictEqual(financeInvoiceContinuation({ userText: 'lança o foguete', recentOutbound: 'bom dia! como foi o show ontem?' }), false);
});

test('ANTI-OVERFIT: fluxo de fatura aberto mas usuário fala de outra coisa → não ativa', () => {
  assert.strictEqual(financeInvoiceContinuation({ userText: 'obrigada, tom, boa noite', recentOutbound: roseOut }), false);
});

test('degenerado nunca ativa', () => {
  for (const v of [null, undefined, {}, 42]) assert.strictEqual(financeInvoiceContinuation(v), false);
});

// Catraca de FONTE: o helper só protege a Rose se o pickSkill o consultar.
const fs = require('node:fs');
const path = require('node:path');
const SYS = fs.readFileSync(path.join(__dirname, 'system.js'), 'utf8');
test('pickSkill: consulta financeInvoiceContinuation e liga finança quando true', () => {
  assert.match(SYS, /financeInvoiceContinuation\(\{ userText: lastUserMessage, recentOutbound \}\)/);
  assert.match(SYS, /\|\| invoiceContinuation\)/);
});
