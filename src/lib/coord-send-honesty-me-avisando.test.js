'use strict';
// COORD-HONESTY-ME-AVISANDO (Ana Paula 05/10 19:09 BRT) — o guard de recado leu
// "Segue me avisando os outros!" (pedido pra ELA ir avisando o TOM) como afirmação de
// envio. Apagou o "✅ Marquei o 3 … e o 8 … como resolvidos" — VERDADEIRO, TASK_UPDATE
// executed ok=2 no mesmo segundo — e anexou "eu ainda NÃO avisei ninguém".
// Com o clítico "me" o TOM é o DESTINATÁRIO do aviso, não o remetente.
const test = require('node:test');
const assert = require('node:assert');
const { enforceSendHonesty, claimsSent } = require('./coord-send-honesty');

const LITERAL = 'Fechando os itens 3 e 8 da lista de PIX automático.\n\n\n\n✅ Marquei o 3 (Thiago Luiz dos Santos Souto) e o 8 (Ricardo de Lima Agostinho) como resolvidos. Segue me avisando os outros!';

test('Ana 05/10: "Segue me avisando os outros!" não é afirmação de envio', () => {
  const r = enforceSendHonesty(LITERAL, {});
  assert.strictEqual(r.fired, false);
  assert.strictEqual(r.reply, LITERAL);
});

test('controle: "me" pedindo retorno em outras formas também não dispara', () => {
  assert.strictEqual(claimsSent('Vai me mandando os nomes que eu fecho.'), false);
  assert.strictEqual(claimsSent('Me avisando quando chegar, eu atualizo.'), false);
});

test('controle: envio afirmado segue disparando, mesmo com "me" em outro ponto da linha', () => {
  assert.strictEqual(claimsSent('📨 Avisei a Anne'), true);
  assert.strictEqual(claimsSent('Avisado! Mandando agora'), true);
  assert.strictEqual(claimsSent('Já avisei o Leo, ele vai me avisando.'), true);
  assert.strictEqual(enforceSendHonesty('📨 Repassei pro Dudu.', {}).fired, true);
});
