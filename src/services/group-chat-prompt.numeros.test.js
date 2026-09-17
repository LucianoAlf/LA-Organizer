'use strict';
// numerosContext no prompt do grupo — o contexto novo que faz o TOM responder QUANTIDADE com o
// número da fonte, e não com o que sobrou da mensagem da pauta do dia (caso Campo Grande, 17/09).
const { test } = require('node:test');
const assert = require('node:assert');
const { buildGroupChatPrompt } = require('./group-chat-prompt');

const base = {
  soulText: 'SOUL', groupName: 'ADM Campo Grande', members: [{ name: 'Rose' }], pool: [],
  history: [], senderName: 'Rose', today: '2026-09-17',
};

test('com numerosContext: o bloco entra inteiro no prompt', () => {
  const bloco = '## NÚMEROS DA FONTE AGORA — Campo Grande\nPIX automático: 373 clientes na fonte\nNunca estime.';
  const p = buildGroupChatPrompt({ ...base, numerosContext: bloco });
  assert.ok(p.includes(bloco), 'o bloco de números tem que chegar ao prompt inteiro');
});

test('sem numerosContext: o prompt fica idêntico ao de antes (zero regressão)', () => {
  const semParam = buildGroupChatPrompt({ ...base });
  const comVazio = buildGroupChatPrompt({ ...base, numerosContext: '' });
  assert.strictEqual(semParam, comVazio);
  assert.ok(!semParam.includes('NÚMEROS DA FONTE AGORA'));
});

test('numerosContext convive com notesContext e credentialContext (um não engole o outro)', () => {
  const p = buildGroupChatPrompt({
    ...base, notesContext: 'FICHAS-AQUI', credentialContext: 'CREDENCIAL-AQUI', numerosContext: 'NUMEROS-AQUI',
  });
  assert.ok(p.includes('FICHAS-AQUI'));
  assert.ok(p.includes('CREDENCIAL-AQUI'));
  assert.ok(p.includes('NUMEROS-AQUI'));
});
