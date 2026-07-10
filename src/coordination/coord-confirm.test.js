const { test } = require('node:test');
const assert = require('node:assert');
const { shouldStageCoordination, buildCoordinationConfirmPreview } = require('./coord-confirm');

// ── shouldStageCoordination — FAIL-SAFE (guarda-corpo #1 da catraca) ─────────
test('fail-safe: item com mode válido → estagia', () => {
  assert.strictEqual(shouldStageCoordination([{ recipient_name: 'Jhonatan', mode: 'relay_assisted', message_body: 'valeu' }]), true);
});
test('fail-safe: mode AUSENTE ou INESPERADO → estagia (NUNCA envia cego)', () => {
  assert.strictEqual(shouldStageCoordination([{ recipient_name: 'X' }]), true);
  assert.strictEqual(shouldStageCoordination([{ recipient_name: 'X', mode: 'xpto' }]), true);
});
test('múltiplos itens → estagia', () => {
  assert.strictEqual(shouldStageCoordination([{ recipient_name: 'A' }, { recipient_name: 'B' }]), true);
});
test('anti-over-emissão (guarda-corpo #3): vazio / não-array / undefined → false', () => {
  assert.strictEqual(shouldStageCoordination([]), false);
  assert.strictEqual(shouldStageCoordination(null), false);
  assert.strictEqual(shouldStageCoordination(undefined), false);
  assert.strictEqual(shouldStageCoordination('x'), false);
});

// ── buildCoordinationConfirmPreview — fallback de voz (guarda-corpo #4) ──────
test('preview 1 destinatário lê no tom do TOM', () => {
  assert.strictEqual(buildCoordinationConfirmPreview([{ recipient_name: 'Jhonatan' }]), 'Aviso o Jhonatan? Confirma?');
});
test('preview N destinatários lista os nomes', () => {
  assert.strictEqual(
    buildCoordinationConfirmPreview([{ recipient_name: 'Ana' }, { recipient_name: 'Léo' }]),
    'Aviso 2 pessoas (Ana, Léo)? Confirma?');
});
test('preview defensivo: sem recipient válido → pergunta genérica (nunca vazio)', () => {
  assert.strictEqual(buildCoordinationConfirmPreview([]), 'Confirma que eu mando esse recado?');
  assert.strictEqual(buildCoordinationConfirmPreview([{}]), 'Confirma que eu mando esse recado?');
  assert.strictEqual(buildCoordinationConfirmPreview(null), 'Confirma que eu mando esse recado?');
});
