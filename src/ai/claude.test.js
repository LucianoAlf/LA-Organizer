// src/ai/claude.test.js
// Trava o empacotamento de args do CLI (Fatia H): system prompt vai por ARQUIVO,
// nunca por argv (anti-E2BIG). Rodar: node --test src/ai/claude.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const { buildArgs } = require('./claude');

test('buildArgs: usa --append-system-prompt-file com o caminho, não o conteúdo no argv', () => {
  const args = buildArgs('oi user', '/tmp/sp.txt');
  const i = args.indexOf('--append-system-prompt-file');
  assert.ok(i !== -1, 'tem --append-system-prompt-file');
  assert.strictEqual(args[i + 1], '/tmp/sp.txt');
});

test('buildArgs: NÃO usa mais o flag inline --append-system-prompt', () => {
  const args = buildArgs('oi', '/tmp/sp.txt');
  assert.ok(!args.includes('--append-system-prompt'), 'flag inline removido');
});

test('buildArgs: mantém o resto do contrato (-p, output json, mcp off, tools off)', () => {
  const args = buildArgs('minha mensagem', '/tmp/sp.txt');
  assert.strictEqual(args[args.indexOf('-p') + 1], 'minha mensagem');
  assert.ok(args.includes('--output-format') && args.includes('json'));
  assert.ok(args.includes('--strict-mcp-config'));
  assert.ok(args.includes('--mcp-config'));
  assert.ok(args.includes('--tools'));
});

test('buildArgs: nenhum argumento carrega conteúdo gigante (prova anti-E2BIG)', () => {
  // o conteúdo do system prompt NUNCA é passado pra buildArgs — só o caminho.
  const args = buildArgs('x', '/tmp/sp.txt');
  const total = args.join('').length;
  assert.ok(total < 200, `argv pequeno (${total} chars), nada de prompt gigante`);
});
