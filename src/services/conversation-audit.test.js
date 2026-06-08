// src/services/conversation-audit.test.js
// Trava os helpers puros + o parser de saída do LLM da Auditoria de Qualidade de Conversa.
// Rodar: node --test src/services/conversation-audit.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const {
  normalizeSummary, signatureFor, parseFindings,
} = require('./conversation-audit');

// ── normalize + signature ───────────────────────────────────────────
test('normalizeSummary: remove acento/pontuação/número, baixa, colapsa', () => {
  assert.strictEqual(
    normalizeSummary('TOM negou salvar 2 gastos!!!'),
    'tom negou salvar gastos',
  );
});
test('signatureFor: mesma entrada (variando espaço/pontuação/caixa) → mesma assinatura', () => {
  const a = signatureFor('confabulation', 'c1', 'TOM negou salvar gasto');
  const b = signatureFor('confabulation', 'c1', 'tom  negou salvar  gasto.');
  assert.strictEqual(a, b);
});
test('signatureFor: categoria diferente → assinatura diferente', () => {
  assert.notStrictEqual(
    signatureFor('confabulation', 'c1', 'x'),
    signatureFor('wrong_refusal', 'c1', 'x'),
  );
});
test('signatureFor: colaborador diferente → assinatura diferente', () => {
  assert.notStrictEqual(signatureFor('x', 'c1', 's'), signatureFor('x', 'c2', 's'));
});

// ── parseFindings ───────────────────────────────────────────────────
test('parseFindings: extrai JSON válido e filtra categoria inválida/sem evidence', () => {
  const raw = 'lixo antes {"findings":[' +
    '{"category":"confabulation","severity":"alto","summary":"negou salvar","evidence":"TOM: não consigo salvar"},' +
    '{"category":"inventada","severity":"alto","summary":"x","evidence":"y"},' +
    '{"category":"frustration","severity":"baixo","summary":"sem prova"}' +
    ']} lixo depois';
  const out = parseFindings(raw);
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].category, 'confabulation');
});
test('parseFindings: severity inválida vira "medio"', () => {
  const out = parseFindings('{"findings":[{"category":"frustration","severity":"urgente","summary":"s","evidence":"e"}]}');
  assert.strictEqual(out[0].severity, 'medio');
});
test('parseFindings: JSON quebrado → []', () => {
  assert.deepStrictEqual(parseFindings('não é json'), []);
});
test('parseFindings: lista vazia → []', () => {
  assert.deepStrictEqual(parseFindings('{"findings":[]}'), []);
});
test('parseFindings: null/undefined → []', () => {
  assert.deepStrictEqual(parseFindings(null), []);
  assert.deepStrictEqual(parseFindings(undefined), []);
});

// ── proactive_overreach (categoria nova) ────────────────────────────
test('parseFindings: aceita proactive_overreach (cobrança em dia indevido)', () => {
  const raw = '{"findings":[{"category":"proactive_overreach","severity":"medio",' +
    '"summary":"cobrou tarefa no domingo","evidence":"USUÁRIO: Tom hj é domingo"}]}';
  const out = parseFindings(raw);
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].category, 'proactive_overreach');
});

// ── prompt: trava da regra (Quintela/Arthur) + anti-falso-positivo ──
test('SYSTEM prompt: cobre proactive_overreach com exceção do "desculpa"', () => {
  const { SYSTEM } = require('../prompts/conversation-audit-prompt');
  assert.match(SYSTEM, /proactive_overreach/);
  assert.match(SYSTEM, /desculp/i); // exceção: emite mesmo se o TOM se desculpar
});
test('SYSTEM prompt: guarda anti-falso-positivo de confabulation (ritual posterior + nomes parecidos)', () => {
  const { SYSTEM } = require('../prompts/conversation-audit-prompt');
  assert.match(SYSTEM, /MESMA troca reativa/);
  assert.match(SYSTEM, /simulado de TCC/); // exemplo dos nomes parecidos
});
