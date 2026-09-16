'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { detectBoletoConfirm } = require('./boleto-confirm');

// ── BOLETO-CONFIRM-FAIL-OPEN (Rose 15/09) ────────────────────────────────────────────────
// 21:16:48 BRT a Rose mandou 5 mensagens em rajada, uma delas um PDF do Simples Nacional da
// ESCOLA DE MUSICA L A LTDA. O leitor abriu a intent bill_from_boleto (21:16:49) e perguntou.
// 21:17:16 ela escreveu "meu nome é Rose, tom" — respondendo a OUTRA coisa, o TOM tinha errado
// o nome dela. O consumidor só sabia recusar palavra de cancelamento: tudo o mais criava a
// conta. R$ 401,45 entraram na carteira PESSOAL dela às 21:17:17. 14 segundos depois ela
// escreveu "não tom, não era pra criar nada".
//
// A porta ao lado (detectLaunchConfirm, launch-confirm.js:82) já é fail-closed desde 12/07 e
// 14/07, pelos mesmos dois motivos: negação e pergunta nunca decidem. O mecanismo existia e
// não estava ligado aqui.

test('Rose 15/09: "meu nome é Rose, tom" não é confirmação — não cria a conta', () => {
  assert.strictEqual(detectBoletoConfirm('meu nome é Rose, tom', null), null);
});

test('afirmação confirma: o "sim" genérico e o verbo curto de criar', () => {
  assert.strictEqual(detectBoletoConfirm('sim', 'yes'), 'yes');
  assert.strictEqual(detectBoletoConfirm('pode criar', 'yes'), 'yes');
  assert.strictEqual(detectBoletoConfirm('cria sim', 'yes'), 'yes');
  assert.strictEqual(detectBoletoConfirm('cadastra essa', null), 'yes');
});

test('recorrência é afirmação: "repete" e "todo mês" criam (mensal)', () => {
  assert.strictEqual(detectBoletoConfirm('repete', null), 'yes');
  assert.strictEqual(detectBoletoConfirm('todo mês', null), 'yes');
});

test('negação e cancelamento nunca criam', () => {
  assert.strictEqual(detectBoletoConfirm('não', 'no'), 'no');
  assert.strictEqual(detectBoletoConfirm('não era pra criar nada', null), 'no');
  assert.strictEqual(detectBoletoConfirm('cancela', null), 'no');
  assert.strictEqual(detectBoletoConfirm('deixa', null), 'no');
  assert.strictEqual(detectBoletoConfirm('esquece isso', null), 'no');
  assert.strictEqual(detectBoletoConfirm('não precisa', null), 'no');
});

test('pergunta não decide: o LLM responde e a intent segue aberta', () => {
  assert.strictEqual(detectBoletoConfirm('de quanto é essa conta?', null), null);
  assert.strictEqual(detectBoletoConfirm('qual o vencimento', null), null);
});

test('assunto alheio não decide — é o caso da Rose generalizado', () => {
  assert.strictEqual(detectBoletoConfirm('esse boleto é da escola, não meu', null), 'no');
  assert.strictEqual(detectBoletoConfirm('to indo almoçar já volto', null), null);
  assert.strictEqual(detectBoletoConfirm('bom dia tom', null), null);
});
