'use strict';
// RECADO-CORRECAO-BARRADA-COMO-DUPLICATA (triagem 11/09 — 8f939d97).
const { test } = require('node:test');
const assert = require('node:assert');
const { ehRetratacao } = require('./retratacao');

// Os dois recados da Fefê pra Anne (10/08). A CORREÇÃO é o texto literal do payload; do PRIMEIRO
// o log guardou só os 160 primeiros caracteres — o fim ("(dia …), porque…") é reconstruído a
// partir do pedido dela, e o teste só exige que ele NÃO seja retratação.
const PRIMEIRO = 'sobre os cheques da família Bezerra Siqueira — o responsável pediu pra adiar o depósito pra sexta-feira (dia 14), porque ele está com um probleminha na conta dele';
const CORRECAO = 'desconsidere a mensagem anterior sobre o depósito do cheque da família Bezerra Siqueira — o Clayton já falou com você diretamente sobre isso.';

test('Fefê 10/08: a correção é retratação; o recado original não é', () => {
  assert.strictEqual(ehRetratacao(CORRECAO), true);
  assert.strictEqual(ehRetratacao(PRIMEIRO), false);
});
test('outras formas de correção/cancelamento', () => {
  for (const t of ['Esquece o que eu mandei antes, já resolvi', 'Na verdade a reunião é às 15h', 'Cancela o pedido de ontem', 'Não precisa mais levar o som']) {
    assert.strictEqual(ehRetratacao(t), true, t);
  }
  assert.strictEqual(ehRetratacao('Me confirma se recebeu o boleto?'), false);
});

const ENG = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'engine.js'), 'utf8');
test('engine: o dedup de relay pula recado de correção', () => {
  assert.match(ENG, /const _retrata = ehRetratacao\(parsed\.message_body \|\| ''\);\s*for \(const prev of \(_retrata \? \[\] : recent\)\) \{/);
});
test('engine: confirmação de recado barrado pelo dedup NÃO diz "Recado enviado"', () => {
  assert.match(ENG, /if \(_r\.ok && _r\.reason === 'dedup_recent_relay'\) _jaIa\.push\(_it\.recipient_name\);/);
  assert.match(ENG, /já tinha ido pra \*\$\{_jaIa\.join\(', '\)\}\* agora há pouco — não mandei de novo pra não duplicar\./);
});
