// Rodar: node --test src/services/format-note.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const { ACTIONS, MAX_INSTRUCTION, validateFormatRequest, systemPromptFor } = require('./format-note');

test('ACTIONS são as 4 esperadas', () => {
  assert.deepStrictEqual(ACTIONS, ['format', 'summarize', 'fix', 'tone']);
});

// ── validateFormatRequest ────────────────────────────────────────────────────
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
test('validateFormatRequest: válido → ok com instruction vazia e emoji default ligado', () => {
  assert.deepStrictEqual(
    validateFormatRequest({ action: 'format', html: '<p>oi</p>' }),
    { ok: true, action: 'format', html: '<p>oi</p>', instruction: '', emoji: true },
  );
});
test('validateFormatRequest: instruction string é trimada', () => {
  const r = validateFormatRequest({ action: 'format', html: 'oi', instruction: '  separa por loja  ' });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.instruction, 'separa por loja');
});
test('validateFormatRequest: instruction não-string → invalid_instruction', () => {
  assert.deepStrictEqual(
    validateFormatRequest({ action: 'format', html: 'oi', instruction: 123 }),
    { ok: false, error: 'invalid_instruction' },
  );
});
test('validateFormatRequest: instruction > MAX é truncada', () => {
  const long = 'x'.repeat(MAX_INSTRUCTION + 120);
  const r = validateFormatRequest({ action: 'format', html: 'oi', instruction: long });
  assert.strictEqual(r.instruction.length, MAX_INSTRUCTION);
});
test('validateFormatRequest: emoji:false respeitado', () => {
  const r = validateFormatRequest({ action: 'format', html: 'oi', emoji: false });
  assert.strictEqual(r.emoji, false);
});

// ── systemPromptFor ──────────────────────────────────────────────────────────
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
test('systemPromptFor: núcleo semântico (cada item = um <li>) presente nas 4 ações', () => {
  for (const a of ACTIONS) {
    const p = systemPromptFor(a);
    assert.ok(/CADA item é um <li>/i.test(p), `núcleo ausente em ${a}`);
  }
});
test('systemPromptFor: few-shot (ENTRADA:/SAÍDA:) presente nas 4 ações', () => {
  for (const a of ACTIONS) {
    const p = systemPromptFor(a);
    assert.ok(/ENTRADA:/.test(p) && /SAÍDA:/.test(p), `few-shot ausente em ${a}`);
  }
});
test('systemPromptFor: verbo certo por ação', () => {
  assert.ok(/CORRIGIR ortografia/i.test(systemPromptFor('fix')));
  assert.ok(/condense/i.test(systemPromptFor('summarize')));
  assert.ok(/tom mais claro/i.test(systemPromptFor('tone')));
});
test('systemPromptFor: instrução do usuário só quando passada', () => {
  assert.ok(!/INSTRUÇÃO DO USUÁRIO/.test(systemPromptFor('format')));
  const withInstr = systemPromptFor('format', { instruction: 'separa por loja e total no fim' });
  assert.ok(/INSTRUÇÃO DO USUÁRIO/.test(withInstr));
  assert.ok(/separa por loja e total no fim/.test(withInstr));
});
test('systemPromptFor: emoji on/off', () => {
  assert.ok(/1 emoji/i.test(systemPromptFor('format', { emoji: true })));
  assert.ok(/NÃO use emojis/i.test(systemPromptFor('format', { emoji: false })));
});
test('systemPromptFor: emoji default ligado', () => {
  assert.ok(/1 emoji/i.test(systemPromptFor('format')));
});
