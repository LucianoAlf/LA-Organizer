'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { detectApprovalReply, stripReplyScaffold } = require('./detect-approval-reply');

// ── BARE approve (as formas reais dos incidentes A/B) ───────────────────────
for (const t of ['Aprovado', 'aprovado', 'APROVADO', 'Aprovar', 'aprovo', 'Aprova',
  'Pode aprovar', 'tá aprovado', 'Aprovado sim', 'aprova aí', 'Aprovado ✅', 'Aprovado.']) {
  test(`"${t}" → approve bare`, () => {
    const r = detectApprovalReply(t);
    assert.ok(r, 'esperava match');
    assert.strictEqual(r.decision, 'approve');
    assert.strictEqual(r.bare, true);
    assert.strictEqual(r.token, null);
  });
}

// ── BARE reject ──────────────────────────────────────────────────────────────
for (const t of ['Rejeitado', 'rejeito', 'não aprovo', 'Rejeita', 'Reprovado']) {
  test(`"${t}" → reject bare`, () => {
    const r = detectApprovalReply(t);
    assert.ok(r, 'esperava match');
    assert.strictEqual(r.decision, 'reject');
    assert.strictEqual(r.bare, true);
  });
}

// ── Comando com token ────────────────────────────────────────────────────────
test('"APROVA PROGRAMA" → approve token=PROGRAMA', () => {
  assert.deepStrictEqual(detectApprovalReply('APROVA PROGRAMA'),
    { decision: 'approve', token: 'PROGRAMA', reason: null, bare: false, domainHint: null });
});
test('"aprova programa" (minúsculo) → approve token=PROGRAMA', () => {
  const r = detectApprovalReply('aprova programa');
  assert.strictEqual(r.token, 'PROGRAMA');
});
test('"Ok, APROVA PROGRAMA" (prefixo de fala) → approve token=PROGRAMA', () => {
  const r = detectApprovalReply('Ok, APROVA PROGRAMA');
  assert.ok(r && r.token === 'PROGRAMA', `got ${JSON.stringify(r)}`);
});
test('"REJEITA PROGRAMA sem orçamento" → reject token + reason', () => {
  const r = detectApprovalReply('REJEITA PROGRAMA sem orçamento');
  assert.strictEqual(r.decision, 'reject');
  assert.strictEqual(r.token, 'PROGRAMA');
  assert.strictEqual(r.reason, 'sem orcamento');
});
test('"aprova o projeto" → bare com domainHint=project', () => {
  const r = detectApprovalReply('aprova o projeto');
  assert.strictEqual(r.bare, true);
  assert.strictEqual(r.domainHint, 'project');
});
test('"aprovo o comunicado" → bare com domainHint=announcement', () => {
  const r = detectApprovalReply('aprovo o comunicado');
  assert.strictEqual(r.bare, true);
  assert.strictEqual(r.domainHint, 'announcement');
});
test('"aprova o projeto PROGRAMA" → token PROGRAMA', () => {
  const r = detectApprovalReply('aprova o projeto PROGRAMA');
  assert.strictEqual(r.token, 'PROGRAMA');
});

// ── NÃO casa (vai pro LLM) ───────────────────────────────────────────────────
for (const t of [
  'aprovei o orçamento ontem com o time',       // relato no passado
  'sim', 'ok', 'pode',                           // confirmação genérica ≠ aprovação
  'Aprovar o quê?',                              // pergunta nunca é comando
  'a provação foi boa',
  'não pode aprovar',                            // negação composta ambígua
  'o financeiro aprovou a verba pro evento da escola toda', // >8 palavras + 3ª pessoa
  '', '   ',
]) {
  test(`"${t}" → null`, () => {
    assert.strictEqual(detectApprovalReply(t), null);
  });
}

// ── stripReplyScaffold ───────────────────────────────────────────────────────
test('scaffold de reply separa userText e quotedText', () => {
  const raw = '[O usuário está RESPONDENDO a esta mensagem anterior: "📋 *Comunicado pendente de aprovação*\nDe: Rafinha"]\nAprovado';
  const r = stripReplyScaffold(raw);
  assert.strictEqual(r.userText, 'Aprovado');
  assert.ok(r.quotedText.includes('Comunicado pendente'));
});
test('texto sem scaffold passa direto', () => {
  assert.deepStrictEqual(stripReplyScaffold('Aprovado'), { userText: 'Aprovado', quotedText: null });
});
test('scaffold de mídia não quebra', () => {
  const r = stripReplyScaffold('[O usuário está RESPONDENDO a uma mídia anterior do tipo image]\nAprovado');
  assert.strictEqual(r.userText, 'Aprovado');
  assert.strictEqual(r.quotedText, null);
});
test('detect funciona em cima do userText do scaffold (caso B real)', () => {
  const raw = '[O usuário está RESPONDENDO a esta mensagem anterior: "📋 *Comunicado pendente de aprovação*"]\nAprovado';
  const { userText } = stripReplyScaffold(raw);
  const r = detectApprovalReply(userText);
  assert.strictEqual(r.decision, 'approve');
});
