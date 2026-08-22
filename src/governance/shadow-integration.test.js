// src/governance/shadow-integration.test.js
// Catraca de FONTE: o gov-runner tem que chamar a sonda-viva pós-ciclo, injetando as 3
// unidades + o Codex como judge, best-effort (try/catch, não quebra o ciclo).
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const SRC = fs.readFileSync(path.join(__dirname, '..', 'rituals', 'gov-runner.js'), 'utf8');

test('gov-runner chama shadowPass depois do ciclo', () => {
  assert.match(SRC, /require\('\.\.\/governance\/shadow-pass'\)/);
  assert.match(SRC, /shadowPass\(/);
});
test('gov-runner injeta as 3 unidades + Codex como judge', () => {
  assert.match(SRC, /require\('\.\.\/governance\/shadow-reproducibility'\)/);
  assert.match(SRC, /require\('\.\.\/governance\/shadow-runner'\)/);
  assert.match(SRC, /require\('\.\.\/governance\/shadow-judge'\)/);
  assert.match(SRC, /require\('\.\.\/ai\/openai'\)\.chat/);
});
test('a sonda é best-effort (try/catch com etiqueta [Shadow]) e usa a âncora do ciclo', () => {
  assert.match(SRC, /\[Shadow\][\s\S]{0,400}?catch/);
  assert.match(SRC, /gte\('verified_at', cicloInicio\)/);
});
test('gov-runner purga o cache de src/ antes de dar require no engine (senão testa código velho)', () => {
  assert.match(SRC, /delete require\.cache\[k\][\s\S]{0,200}?require\('\.\.\/engine'\)/);
});
test('gov-runner pula a sombra quando TOM_QA_PHONES não está configurado (sem fabricar default)', () => {
  assert.match(SRC, /TOM_QA_PHONES.*\|\|\s*''/);
  assert.match(SRC, /pulado: TOM_QA_PHONES não configurado/);
});
