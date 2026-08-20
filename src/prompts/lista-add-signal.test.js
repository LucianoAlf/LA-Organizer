// src/prompts/lista-add-signal.test.js
// Rodar: node --test src/prompts/lista-add-signal.test.js
//
// LISTA-TRABALHO-ROUTING-AUDIO (Rafinha 17/08 12:44 BRT). O fix de 18/08 roteia
// "coloca no checklist" pra listas-pessoais, mas só na frase LIMPA — a mensagem de
// áudio chega com "[áudio transcrito]" e o short-circuit tratamento-audio a rouba antes.
const { test } = require('node:test');
const assert = require('node:assert');
const { isExplicitListAdd, stripAudioPrefix } = require('./lista-add-signal');

test('CASO RAFINHA REAL: com o prefixo de áudio ainda é adição de lista', () => {
  const real = '[áudio transcrito] Então, coloca no checklist aí, telão de LED finalizado, ok? Tudo certo pra sexta-feira.';
  assert.strictEqual(isExplicitListAdd(real), true);
});

test('a MESMA frase sem prefixo (o que o teste de 18/08 usava) também casa', () => {
  assert.strictEqual(isExplicitListAdd('Então, coloca no checklist aí, telão de LED finalizado, ok?'), true);
});

test('outras adições explícitas, com e sem áudio', () => {
  assert.strictEqual(isExplicitListAdd('[áudio transcrito] coloca na minha lista aí, consertar a caixa de contrabaixo'), true);
  assert.strictEqual(isExplicitListAdd('Coloca o Merodaque na lista por favor'), true);
  assert.strictEqual(isExplicitListAdd('minha lista de mercado: arroz'), true);
});

test('ANTI-OVERFIT: retrieve "manda a lista" NÃO é adição (nem por áudio)', () => {
  assert.strictEqual(isExplicitListAdd('Me manda a lista das tarefas de amanhã'), false);
  assert.strictEqual(isExplicitListAdd('[áudio transcrito] me reenvia como ficou a lista'), false);
});

test('sem substantivo de lista não casa (não rouba criar-tarefa comum)', () => {
  assert.strictEqual(isExplicitListAdd('[áudio transcrito] cria uma tarefa de comprar cabo'), false);
  assert.strictEqual(isExplicitListAdd('marca a reunião pras 14h'), false);
});

test('stripAudioPrefix: só o prefixo do INÍCIO, case/acento-insensível; sem prefixo é no-op', () => {
  assert.strictEqual(stripAudioPrefix('[áudio transcrito] oi'), 'oi');
  assert.strictEqual(stripAudioPrefix('[Audio transcrito]   oi'), 'oi');
  assert.strictEqual(stripAudioPrefix('oi [áudio transcrito] no meio'), 'oi [áudio transcrito] no meio');
  assert.strictEqual(stripAudioPrefix('sem prefixo'), 'sem prefixo');
});

test('entrada degenerada nunca casa', () => {
  for (const v of [null, undefined, 42, '', '   ']) assert.strictEqual(isExplicitListAdd(v), false);
});
