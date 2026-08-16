const { test } = require('node:test');
const assert = require('node:assert');
const { shouldStageCoordination, buildCoordinationConfirmPreview, resolveStageConfirmPrompt } = require('./coord-confirm');

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

// ── resolveStageConfirmPrompt — a prosa de ESTÁGIO é MECÂNICA, não do LLM ──────
// COORD-CONFIRM-STAGE-PROSE-CONFAB (Fabi 11/07): o LLM emitia o marker (estagia) mas escrevia
// "Mandando agora ✅" em vez de "Confirma?" → user achava que foi feito, nunca dava "sim", o
// recado ficava estagiado e NUNCA saía. A prosa que pede o "sim" tem que ser GARANTIDA.
const ST_ITEMS = [{ recipient_name: 'Luciano', mode: 'relay_assisted', message_body: 'x' }];

test('afirmação de envio ("Mandando agora pro Luciano") → troca pela pergunta determinística', () => {
  assert.strictEqual(resolveStageConfirmPrompt('Mandando agora pro Luciano.', ST_ITEMS), 'Aviso o Luciano? Confirma?');
});
test('afirmação com ✅ ("Mandando agora, Fabi. ✅") → troca pela pergunta', () => {
  assert.strictEqual(resolveStageConfirmPrompt('Mandando agora, Fabi. ✅', ST_ITEMS), 'Aviso o Luciano? Confirma?');
});
test('avisei/mandei/enviei/avisado/repassei → troca pela pergunta', () => {
  for (const s of ['Avisei o Luciano.', 'Já mandei pro Luciano', 'Enviei agora', 'Recado avisado!', 'Repassei pro Luciano ✅']) {
    assert.strictEqual(resolveStageConfirmPrompt(s, ST_ITEMS), 'Aviso o Luciano? Confirma?');
  }
});
test('pergunta de confirmação legítima do LLM é PRESERVADA (voz intacta)', () => {
  assert.strictEqual(resolveStageConfirmPrompt('Aviso o Luciano que você viu? Confirma?', ST_ITEMS), 'Aviso o Luciano que você viu? Confirma?');
  assert.strictEqual(resolveStageConfirmPrompt('Quer que eu avise o Luciano?', ST_ITEMS), 'Quer que eu avise o Luciano?');
});
test('cleanText vazio/null/branco → pergunta determinística', () => {
  assert.strictEqual(resolveStageConfirmPrompt('', ST_ITEMS), 'Aviso o Luciano? Confirma?');
  assert.strictEqual(resolveStageConfirmPrompt(null, ST_ITEMS), 'Aviso o Luciano? Confirma?');
  assert.strictEqual(resolveStageConfirmPrompt('   ', ST_ITEMS), 'Aviso o Luciano? Confirma?');
});
test('prosa dúbia sem "?" nem "confirma" → fail-safe pra pergunta determinística', () => {
  assert.strictEqual(resolveStageConfirmPrompt('Beleza então', ST_ITEMS), 'Aviso o Luciano? Confirma?');
});

// FATIA 8: preConfirmed pula o estágio (o recado já foi confirmado no turno anterior → despacha direto).
test('shouldStageCoordination: preConfirmed=true → false (despacha direto, sem re-estagiar)', () => {
  assert.strictEqual(shouldStageCoordination([{ recipient_name: 'Jhonatan', message_body: 'valeu', mode: 'relay_assisted' }], { preConfirmed: true }), false);
});
test('shouldStageCoordination: sem preConfirmed → segue estagiando (default true)', () => {
  assert.strictEqual(shouldStageCoordination([{ recipient_name: 'Jhonatan' }]), true);
  assert.strictEqual(shouldStageCoordination([{ recipient_name: 'Jhonatan' }], { preConfirmed: false }), true);
});
