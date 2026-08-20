// src/lib/provider-fail-reply.test.js
// Rodar: node --test src/lib/provider-fail-reply.test.js
//
// PROVIDER-ALL-FAILED-SILENCIO (Ana Paula 19/08 21:01). "Fecha" -> os dois provedores de IA
// caíram -> o engine dava `throw` sem mandar nada. Silêncio total: o único beco do engine
// sem aviso ao usuário.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { PROVIDER_FAIL_REPLY } = require('./provider-fail-reply');

test('a fala é honesta: avisa a falha, diz que NÃO registrou e pede reenvio', () => {
  assert.match(PROVIDER_FAIL_REPLY, /problema t[ée]cnico/i);
  assert.match(PROVIDER_FAIL_REPLY, /n[ãa]o registrei nada/i);
  assert.match(PROVIDER_FAIL_REPLY, /de novo/i);
});

// Catraca de FONTE: a fala só resolve o silêncio se o engine REALMENTE a enviar no
// caminho all-providers-failed, ANTES de re-lançar. Se alguém tirar o envio, volta o mudo.
const ENGINE = fs.readFileSync(path.join(__dirname, '..', 'engine.js'), 'utf8');

test('engine: manda a fala no caminho all-providers-failed antes do throw', () => {
  const iCatch = ENGINE.indexOf('FATAL all-providers-failed');
  assert.ok(iCatch > 0, 'o caminho all-providers-failed sumiu');
  const trecho = ENGINE.slice(iCatch, iCatch + 1600);
  assert.match(trecho, /PROVIDER_FAIL_REPLY/, 'a fala não é enviada nesse caminho');
  const iSend = trecho.indexOf('PROVIDER_FAIL_REPLY');
  const iThrow = trecho.indexOf('throw err');
  assert.ok(iSend > 0 && iThrow > iSend, 'o envio tem que vir ANTES do throw');
});

test('engine: o envio da fala está blindado (não mascara o erro original)', () => {
  const iCatch = ENGINE.indexOf('FATAL all-providers-failed');
  const trecho = ENGINE.slice(iCatch, iCatch + 1600);
  // o send fica dentro do seu próprio try/catch pra que uma falha de envio não engula o throw
  assert.match(trecho, /catch\s*\(_?\w*\)\s*\{[^}]*\}[\s\S]*throw err/,
    'o send precisa estar num try/catch próprio antes do throw');
});
