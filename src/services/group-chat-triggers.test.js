// src/services/group-chat-triggers.test.js
const assert = require('node:assert');
const { test } = require('node:test');
const { detectEngageTrigger, detectDisengageTrigger, isEngaged } = require('./group-chat-triggers');

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

test('isEngaged: janela de 10 min', () => {
  const now = new Date('2026-06-12T12:00:00Z');
  assert.equal(isEngaged('2026-06-12T11:55:00Z', now), true);   // 5 min atrás
  assert.equal(isEngaged('2026-06-12T11:49:00Z', now), false);  // 11 min atrás
  assert.equal(isEngaged(null, now), false);
  assert.equal(isEngaged(undefined, now), false);
});
