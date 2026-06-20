'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { classifyClaudeExit } = require('./classify-claude-exit');

// ANTHROPIC-API-EXIT-1 — distinguir rate-limit / overloaded / 5xx / erro real.

test('rate limit via type nomeado no stdout', () => {
  const stdout = JSON.stringify({ type: 'result', is_error: true, subtype: 'rate_limit_error', result: 'rate limit' });
  const r = classifyClaudeExit(1, stdout, '');
  assert.strictEqual(r.kind, 'exit_rate_limit');
  assert.match(r.message, /código 1/);
  assert.match(r.message, /rate_limit_error/);
});

test('rate limit via HTTP 429 no stdout', () => {
  const r = classifyClaudeExit(1, 'API Error: 429 Too Many Requests', '');
  assert.strictEqual(r.kind, 'exit_rate_limit');
});

test('overloaded (Anthropic 529 / overloaded_error)', () => {
  const stdout = JSON.stringify({ type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } });
  const r = classifyClaudeExit(1, stdout, '');
  assert.strictEqual(r.kind, 'exit_overloaded');
  assert.match(r.message, /overloaded_error|Overloaded/i);
});

test('5xx → unavailable', () => {
  const r = classifyClaudeExit(1, 'upstream returned 503 Service Unavailable', '');
  assert.strictEqual(r.kind, 'exit_unavailable');
});

test('erro genérico desconhecido → exit', () => {
  const r = classifyClaudeExit(1, 'something broke', '');
  assert.strictEqual(r.kind, 'exit');
});

test('stdout vazio + stderr vazio → exit com (vazio)', () => {
  const r = classifyClaudeExit(1, '', '');
  assert.strictEqual(r.kind, 'exit');
  assert.match(r.message, /\(vazio\)/);
});

test('stdout não-JSON entra como snippet no detalhe', () => {
  const r = classifyClaudeExit(2, 'plain text boom', '');
  assert.match(r.message, /stdout\[0\.\.200\]: plain text boom/);
  assert.match(r.message, /código 2/);
});

test('preserva exit code numérico exato', () => {
  assert.match(classifyClaudeExit(137, '', '').message, /código 137/);
});

test('detalhe do stdout JSON expõe subtype/result', () => {
  const stdout = JSON.stringify({ subtype: 'rate_limit_error', is_error: true, result: 'slow down' });
  const r = classifyClaudeExit(1, stdout, '');
  assert.match(r.message, /subtype=rate_limit_error/);
  assert.match(r.message, /slow down/);
});

test('robustez: args nulos não quebram', () => {
  const r = classifyClaudeExit(1, null, null);
  assert.strictEqual(r.kind, 'exit');
});

// AUTH (Sentinela, 20/06) — token OAuth morto/401 deve sair como exit_auth.
test('auth: "Invalid API key · Please run /login"', () => {
  const r = classifyClaudeExit(1, 'Invalid API key · Please run /login', '');
  assert.strictEqual(r.kind, 'exit_auth');
});

test('auth: authentication_error / OAuth token expired no stdout JSON', () => {
  const stdout = JSON.stringify({ type: 'error', error: { type: 'authentication_error', message: 'OAuth token has expired' } });
  const r = classifyClaudeExit(1, stdout, '');
  assert.strictEqual(r.kind, 'exit_auth');
});

test('auth: HTTP 401 "Invalid authentication credentials" (frase do incidente 20/06)', () => {
  const r = classifyClaudeExit(1, 'API Error: 401 Invalid authentication credentials', '');
  assert.strictEqual(r.kind, 'exit_auth');
});

test('auth: Unauthorized no stderr', () => {
  const r = classifyClaudeExit(1, '', 'Unauthorized');
  assert.strictEqual(r.kind, 'exit_auth');
});

test('auth NÃO captura overloaded/rate-limit (precedência correta)', () => {
  assert.strictEqual(classifyClaudeExit(1, '429 Too Many Requests rate_limit_error', '').kind, 'exit_rate_limit');
  assert.strictEqual(classifyClaudeExit(1, 'overloaded_error 529', '').kind, 'exit_overloaded');
  // invalid_request_error (400) não é auth
  assert.strictEqual(classifyClaudeExit(1, 'invalid_request_error: bad param', '').kind, 'exit');
});
