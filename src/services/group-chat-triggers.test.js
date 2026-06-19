// src/services/group-chat-triggers.test.js
const assert = require('node:assert');
const { test } = require('node:test');
const { detectEngageTrigger, detectDisengageTrigger, isEngaged, isVocativeTom, isAddressedToTom } = require('./group-chat-triggers');

test('engage: menção direta aciona', () => {
  assert.equal(detectEngageTrigger('fala tom, cria uma tarefa'), true);
  assert.equal(detectEngageTrigger('Tom, me ajuda aqui'), true);
  assert.equal(detectEngageTrigger('@tom resumo por favor'), true);
  assert.equal(detectEngageTrigger('tom?'), true);
  assert.equal(detectEngageTrigger('TOM CRIA ISSO'), true);
});

test('engage: NÃO aciona sem menção / dentro de palavra', () => {
  assert.equal(detectEngageTrigger('o sistema é automático'), false);
  assert.equal(detectEngageTrigger('a árvore tombou ontem'), false);
  assert.equal(detectEngageTrigger('terminamos o relatório'), false);
  assert.equal(detectEngageTrigger(''), false);
  assert.equal(detectEngageTrigger(null), false);
});

test('disengage: despedida ao TOM aciona', () => {
  assert.equal(detectDisengageTrigger('valeu tom!'), true);
  assert.equal(detectDisengageTrigger('obrigada tom'), true);
  assert.equal(detectDisengageTrigger('tchau tom'), true);
  assert.equal(detectDisengageTrigger('é isso tom, até'), true);
  assert.equal(detectDisengageTrigger('Tom, valeu demais'), true);
});

test('disengage: NÃO aciona em fala normal', () => {
  assert.equal(detectDisengageTrigger('tom, cria a tarefa'), false);
  assert.equal(detectDisengageTrigger('valeu pessoal'), false);
  assert.equal(detectDisengageTrigger(''), false);
});

test('isEngaged: sessão aberta enquanto engaged_at setado (cap 12h)', () => {
  const now = new Date('2026-06-12T12:00:00Z');
  assert.equal(isEngaged('2026-06-12T11:53:00Z', now), true);   // 7 min — sessão aberta
  assert.equal(isEngaged('2026-06-12T11:30:00Z', now), true);   // 30 min — ainda aberta (ocioso = sweep)
  assert.equal(isEngaged('2026-06-11T23:00:00Z', now), false);  // 13h — trava de segurança
  assert.equal(isEngaged(null, now), false);
  assert.equal(isEngaged(undefined, now), false);
});

test('isVocativeTom: acorda em chamado direto (vocativo)', () => {
  ['Tom, faz isso', '@tom', 'fala tom', 'Ei Tom', 'bom dia Tom!', 'Tom?', 'TOM', 'e aí tom, beleza?'].forEach((t) =>
    assert.equal(isVocativeTom(t), true, `devia acordar: ${t}`));
});

test('isVocativeTom: NÃO acorda em menção SOBRE ele nem em substring', () => {
  ['o Tom já leu', 'manda pro Tom', 'falar com o Tom', 'do Tom', 'isso é automático', 'a árvore tombou', 'fantom da ópera', '', null].forEach((t) =>
    assert.equal(isVocativeTom(t), false, `NÃO devia acordar: ${t}`));
});

test('isAddressedToTom: vocativo OU reply OU awaiting → true; nada → false', () => {
  assert.equal(isAddressedToTom({ text: 'Tom, status?' }), true);
  assert.equal(isAddressedToTom({ text: 'kkk que isso', isReplyToTom: true }), true);
  assert.equal(isAddressedToTom({ text: 'sim', tomAwaiting: true }), true);
  assert.equal(isAddressedToTom({ text: 'depois eu vejo isso' }), false);
  assert.equal(isAddressedToTom({ text: 'o Tom já respondeu' }), false);
});
