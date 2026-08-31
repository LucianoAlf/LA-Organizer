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

// ── Caso Ana Paula (finding 3b37b568, turno real 01/07 19:12 BRT) ────────────
// Ela respondeu ao CONVITE por REPLY-QUOTE com "Confirma por favor" e levou
// "não consegui registrar isso agora". Às 21:28 mandou "Vou" e funcionou — a
// capacidade existia, era bug. DOIS bloqueios independentes:
//   (1) o bloco citado entrava no texto e levava a mensagem a 38 palavras, e o
//       gate de 4 palavras matava — sendo que responder por quote é justamente
//       o caminho NATURAL de responder um convite;
//   (2) mesmo sem o quote, "confirma por favor" dava null: o Set tinha
//       "confirmo"/"confirmar"/"confirmado"/"pode confirmar" e não "confirma".
const QUOTE = '[O usuário está RESPONDENDO a esta mensagem anterior: "📩 *Convite* — o Alf te convidou para _Reunião de alinhamento pedagógico do trimestre_ 🗓️ ter, 02/07 às 14:00 na sala da coordenação. Me responde aqui: vou / não vou / talvez."]\n';

test('reply-quote + "Confirma por favor" → confirmed (o caso que falhou)', () => {
  assert.deepStrictEqual(detectBareRsvpReply(QUOTE + 'Confirma por favor'), { status: 'confirmed' });
});
test('reply-quote + "Vou" → confirmed (o gate mede a FALA, não a citação)', () => {
  assert.deepStrictEqual(detectBareRsvpReply(QUOTE + 'Vou'), { status: 'confirmed' });
});
test('reply-quote + "não vou poder" → declined', () => {
  assert.deepStrictEqual(detectBareRsvpReply(QUOTE + 'não vou poder'), { status: 'declined' });
});
for (const t of ['Confirma', 'confirma', 'Confirma por favor', 'confirma sim', 'Confirma pra mim']) {
  test(`"${t}" → confirmed`, () => {
    assert.deepStrictEqual(detectBareRsvpReply(t), { status: 'confirmed' });
  });
}

// O narrow NÃO pode morrer junto: tirar o quote da medição não é afrouxar o gate.
test('reply-quote + fala própria longa → null (continua indo pro LLM)', () => {
  assert.strictEqual(detectBareRsvpReply(QUOTE + 'Sim, mas será que dá pra remarcar pra sexta de manhã?'), null);
});
test('reply-quote + fala própria vazia → null', () => {
  assert.strictEqual(detectBareRsvpReply(QUOTE), null);
});
test('a citação sozinha não decide nada: quote com "vou" e fala própria neutra → null', () => {
  const q = '[O usuário está RESPONDENDO a esta mensagem anterior: "Você vou confirmar presença?"]\nqual o endereço mesmo';
  assert.strictEqual(detectBareRsvpReply(q), null);
});
