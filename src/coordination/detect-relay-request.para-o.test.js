'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { detectExplicitRelayRequest: d } = require('./detect-relay-request');

// Dai 16/07 12:39 (f9ffefc0) — literal do áudio transcrito. Antes: null → o TOM mandou ELA avisar.
const DAI = '[audio transcrito] Oi Tom, bom dia. Tom, avisa para o Leo que hoje nós temos uma reunião marcada às 13 horas da tarde sobre o treinamento.';

test('Dai: "avisa para o Leo que…" é recado pro Leo', () => {
  assert.deepStrictEqual(d(DAI), { recipientHint: 'leo' });
});

test('duas palavras entre verbo e nome, e "sobre" abrindo o conteúdo', () => {
  assert.deepStrictEqual(d('fala com o Rafinha sobre a troca da caixa'), { recipientHint: 'rafinha' });
  assert.deepStrictEqual(d('diz pra a Rose que o boleto chegou'), { recipientHint: 'rose' });
  assert.deepStrictEqual(d('Avisar krissya que professores estão precisando de tablet'), { recipientHint: 'krissya' });
});

test('continua NÃO casando pronome, pergunta e "fala sobre"', () => {
  assert.strictEqual(d('avisa pra ela que chego tarde'), null);
  assert.strictEqual(d('me fala sobre o projeto'), null);
  assert.strictEqual(d('Conseguiu avisar ao Clayton?'), null);
  assert.strictEqual(d('pode avisar que recebi'), null);
});
