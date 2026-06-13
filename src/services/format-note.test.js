// Rodar: node --test src/services/format-note.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const { ACTIONS, validateFormatRequest, systemPromptFor } = require('./format-note');

test('ACTIONS são as 4 esperadas', () => {
  assert.deepStrictEqual(ACTIONS, ['format', 'summarize', 'fix', 'tone']);
});
test('validateFormatRequest: ação inválida → erro', () => {
  assert.deepStrictEqual(validateFormatRequest({ action: 'x', html: 'oi' }), { ok: false, error: 'invalid_action' });
});
test('validateFormatRequest: html vazio → erro', () => {
  assert.deepStrictEqual(validateFormatRequest({ action: 'fix', html: '   ' }), { ok: false, error: 'invalid_html' });
});
test('validateFormatRequest: html > 20000 → too_long', () => {
  const big = 'a'.repeat(20001);
  assert.deepStrictEqual(validateFormatRequest({ action: 'fix', html: big }), { ok: false, error: 'too_long' });
});
test('validateFormatRequest: válido → ok com action/html', () => {
  assert.deepStrictEqual(validateFormatRequest({ action: 'format', html: '<p>oi</p>' }), { ok: true, action: 'format', html: '<p>oi</p>' });
});
test('systemPromptFor: cada ação tem prompt string não-vazio', () => {
  for (const a of ACTIONS) assert.ok(typeof systemPromptFor(a) === 'string' && systemPromptFor(a).length > 30);
});
test('systemPromptFor: todos pedem só HTML e proíbem inventar', () => {
  for (const a of ACTIONS) {
    const p = systemPromptFor(a);
    assert.ok(/APENAS o HTML/i.test(p));
    assert.ok(/NÃO invente/i.test(p));
  }
});
