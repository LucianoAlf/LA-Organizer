'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { detectBareRsvpReply } = require('./detect-rsvp-reply');

// ── Afirmações cruas → confirmed ────────────────────────────────────────────
for (const t of ['Sim', 'sim', 'Sim!', 'SIM', 'sim 👍', 'Vou', 'Vou sim', 'eu vou',
  'Confirmo', 'confirmo presença', 'Confirmado', 'Bora', 'Presente', 'Tô dentro',
  'Pode confirmar', 'Sim, confirmo']) {
  test(`"${t}" → confirmed`, () => {
    assert.deepStrictEqual(detectBareRsvpReply(t), { status: 'confirmed' });
  });
}

// ── Negações cruas → declined ───────────────────────────────────────────────
for (const t of ['Não', 'nao', 'Não vou', 'não posso', 'Recuso', 'não vou poder',
  'Infelizmente não']) {
  test(`"${t}" → declined`, () => {
    assert.deepStrictEqual(detectBareRsvpReply(t), { status: 'declined' });
  });
}

// ── Talvez → tentative ──────────────────────────────────────────────────────
for (const t of ['Talvez', 'talvez sim', 'Vou tentar', 'se der']) {
  test(`"${t}" → tentative`, () => {
    assert.deepStrictEqual(detectBareRsvpReply(t), { status: 'tentative' });
  });
}

// ── NÃO é RSVP cru (frase com conteúdo) → null (deixa o LLM tratar) ──────────
for (const t of [
  'Sim, mas pode remarcar pra sexta?',   // afirma + pedido → LLM
  'não sei o que fazer com isso',        // "não" + conteúdo
  'vou ter que ver minha agenda antes',  // não é confirmação
  'simpático esse horário',              // contém "sim" mas não é
  'pode marcar pra amanhã às 10',        // é criação de evento, não RSVP
  'confirmo o pagamento de 300',         // outro domínio
  '',
  '   ',
  'beleza demais esse plano todo aqui',  // frase longa
]) {
  test(`"${t}" → null`, () => {
    assert.strictEqual(detectBareRsvpReply(t), null);
  });
}

// ── Guarda de tamanho: 4 palavras passa, 5+ não ─────────────────────────────
test('"sim vou estar presente" (4 palavras) ainda casa? não está no set → null', () => {
  // não está no set exato → null (set é a fonte da verdade, não o tamanho)
  assert.strictEqual(detectBareRsvpReply('sim vou estar presente'), null);
});
