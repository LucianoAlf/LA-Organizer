'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { contarPostagensForaDoRunner } = require('./gov-postagem');

test('05/10: agente postou 4 mensagens por script + runner 2 postagens (2 msgs) → acusa', () => {
  assert.ok(contarPostagensForaDoRunner(6, 1) > 0);
});
test('runner sozinho (relatório cortado em 2 mensagens) não acusa', () => {
  assert.strictEqual(contarPostagensForaDoRunner(2, 1), 0);
  assert.strictEqual(contarPostagensForaDoRunner(3, 2), 0);
  assert.strictEqual(contarPostagensForaDoRunner(5, 0), 0);
});
test('protocolo proíbe o agente de postar sozinho', () => {
  const p = fs.readFileSync(path.join(__dirname, '..', '..', 'docs', 'ops', 'PROTOCOLO-GOVERNANCA.md'), 'utf8');
  assert.match(p, /Não poste no grupo você mesmo/);
  assert.doesNotMatch(p, /Poste o resultado no grupo e pare por aí/);
});
test('runner tem o sensor de postagem fora dele', () => {
  const r = fs.readFileSync(path.join(__dirname, '..', 'rituals', 'gov-runner.js'), 'utf8');
  assert.match(r, /GOV_POST_FORA_DO_RUNNER/);
  assert.match(r, /_postsDoRunner\+\+/);
});
