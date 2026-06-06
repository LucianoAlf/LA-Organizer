// src/services/reply-classify.test.js
// Sprint 31.10 — testes do classificador de reply usado pelo detector
// ACTIONABLE_NO_MARKER. Encoda os casos REAIS que viraram falso positivo na
// auditoria 03/06 (C1 reincidente) pra travar a regressão de vez.
//
// Rodar: node --test src/services/reply-classify.test.js

const { test } = require('node:test');
const assert = require('node:assert');
const { hasTrailingQuestion, isInfoGatheringReply } = require('./reply-classify');

// ─────────────────────────────────────────────────────────────────
// Sprint 31.19 — pedido de CONFIRMAÇÃO no meio da msg não é promessa quebrada (caso Dai 05/06)
// ─────────────────────────────────────────────────────────────────
test('isInfoGatheringReply: caso Dai — "Certo? Se confirmar, fecho a tarefa antiga..." → true', () => {
  const reply = 'Entendi do áudio:\n\n• ✅ Plano mudou — vai fazer um *kit* de comida (não mais a lista avulsa)\n• 🗓️ Compra do kit: segunda, 08/06, a partir das 14h — já registrada no app\n\nCerto? Se confirmar, fecho a tarefa antiga da "lista de comida" que tava em atraso.';
  assert.strictEqual(isInfoGatheringReply(reply), true);
});
test('isInfoGatheringReply: "Marco pra terça. Certo? Aí confirmo." (certo? no meio) → true', () => {
  assert.strictEqual(isInfoGatheringReply('Marco pra terça. Certo? Aí confirmo.'), true);
});
test('isInfoGatheringReply: "Se você ok eu arquivo a lista." → true', () => {
  assert.strictEqual(isInfoGatheringReply('Se você ok eu arquivo a lista.'), true);
});
test('isInfoGatheringReply: confabulação real "✅ Fechado! Lista antiga encerrada." → false (deve seguir flagável)', () => {
  assert.strictEqual(isInfoGatheringReply('✅ Fechado! Lista antiga encerrada.'), false);
});
test('isInfoGatheringReply: "Criei a tarefa e marquei pra amanhã." → false (afirmação de ação)', () => {
  assert.strictEqual(isInfoGatheringReply('Criei a tarefa e marquei pra amanhã.'), false);
});

// ─────────────────────────────────────────────────────────────────
// hasTrailingQuestion — pergunta É info-gathering mesmo com lixo após o "?"
// ─────────────────────────────────────────────────────────────────
test('hasTrailingQuestion: pergunta terminando em ")" (caso Anne 03:27)', () => {
  const reply = 'Entendi — estudar pra simulado de TCC, lembrete amanhã à tarde. Que horas? (14h, 15h?)';
  assert.strictEqual(hasTrailingQuestion(reply), true);
});

test('hasTrailingQuestion: pergunta com parêntese de exemplos no fim (caso Anne 03:26)', () => {
  const reply = 'Entendi, pago amanhã de manhã também — mas *o que* você precisa pagar? (boleto, conta específica, outro?)';
  assert.strictEqual(hasTrailingQuestion(reply), true);
});

test('hasTrailingQuestion: pergunta simples terminando em "?"', () => {
  assert.strictEqual(hasTrailingQuestion('Quer que eu cadastre no inventário?'), true);
});

test('hasTrailingQuestion: pergunta seguida de emoji/asterisco', () => {
  assert.strictEqual(hasTrailingQuestion('Qual a unidade?*'), true);
  assert.strictEqual(hasTrailingQuestion('Confirma? 🤔'), true);
});

test('hasTrailingQuestion: NÃO é pergunta (confirmação de inventário)', () => {
  assert.strictEqual(hasTrailingQuestion('✅ Item adicionado: Guitarra Condor GX 📷 foto anexada'), false);
});

test('hasTrailingQuestion: NÃO é pergunta (convite no futuro)', () => {
  assert.strictEqual(hasTrailingQuestion('Pode mandar, Rafinha! Vai listando os gastos que eu vou registrando um por um.'), false);
});

test('hasTrailingQuestion: "?" no meio mas afirmação no fim NÃO conta', () => {
  assert.strictEqual(hasTrailingQuestion('Você perguntou? Então tá registrado.'), false);
});

// ─────────────────────────────────────────────────────────────────
// isInfoGatheringReply — TOM pede algo pro user pra poder agir (≠ já agiu)
// ─────────────────────────────────────────────────────────────────
test('isInfoGatheringReply: "Vai listando" (caso Rafinha)', () => {
  const reply = 'Pode mandar, Rafinha! Vai listando os gastos que eu vou registrando um por um.';
  assert.strictEqual(isInfoGatheringReply(reply), true);
});

test('isInfoGatheringReply: "Me manda ela de novo" (caso Anne professores)', () => {
  const reply = 'O problema é que essa listagem não tá mais visível pra mim. Me manda ela de novo que eu insiro os professores nos lugares certos:';
  assert.strictEqual(isInfoGatheringReply(reply), true);
});

test('isInfoGatheringReply: "Me diz a unidade e a sala" (caso Luciano guitarra)', () => {
  const reply = 'Vi uma guitarra Condor GX 👀 Quer que eu cadastre no inventário? Me diz a unidade e a sala que eu registro certinho.';
  assert.strictEqual(isInfoGatheringReply(reply), true);
});

test('isInfoGatheringReply: NÃO é info-gathering (ação concluída)', () => {
  assert.strictEqual(isInfoGatheringReply('✅ Item adicionado: Guitarra Condor GX 📷 foto anexada'), false);
});

test('isInfoGatheringReply: NÃO é info-gathering (pergunta pura sem pedir envio)', () => {
  // Essa é coberta por hasTrailingQuestion, não aqui — garante que não há over-match.
  assert.strictEqual(isInfoGatheringReply('Entendi, pago amanhã de manhã também — mas o que você precisa pagar?'), false);
});

// Robustez: entradas vazias/nulas não quebram.
test('entradas vazias/nulas retornam false sem lançar', () => {
  for (const v of [null, undefined, '', '   ']) {
    assert.strictEqual(hasTrailingQuestion(v), false);
    assert.strictEqual(isInfoGatheringReply(v), false);
  }
});
