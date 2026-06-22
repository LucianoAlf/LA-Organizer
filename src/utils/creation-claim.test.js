const { test } = require('node:test');
const assert = require('node:assert');
const {
  looksLikeCreationClaim, shouldHonestifyCreationClaim, honestifyCreationClaim,
} = require('./creation-claim');

test('looksLikeCreationClaim: pega o caso Dai (organizada + te cobro)', () => {
  assert.strictEqual(looksLikeCreationClaim(
    'Show, Dai! Semana do canto organizada então:\n\n• Campo Grande — terça\n\nTe cobro conforme for chegando. 👊'), true);
});

test('looksLikeCreationClaim: pega templates de criação (Anotado/Anotei/Criei)', () => {
  assert.strictEqual(looksLikeCreationClaim('✅ Anotado!\n\n*Reunião com Juliana*.'), true);
  assert.strictEqual(looksLikeCreationClaim('✅ Anotei pra você: terça Campo Grande.'), true);
  assert.strictEqual(looksLikeCreationClaim('Criei a tarefa e já agendei o lembrete.'), true);
});

test('looksLikeCreationClaim: NÃO pega pergunta pura nem recusa nem a própria linha honesta', () => {
  assert.strictEqual(looksLikeCreationClaim('Tá certo isso?'), false);
  assert.strictEqual(looksLikeCreationClaim('opa, não consegui registrar agora, me manda de novo?'), false);
  assert.strictEqual(looksLikeCreationClaim('Na real, não cheguei a registrar isso aqui ainda — me confirma os itens.'), false);
  assert.strictEqual(looksLikeCreationClaim('beleza, bora! 👊'), false);
});

test('shouldHonestify: afirmou criação + nenhum marker → true', () => {
  assert.strictEqual(shouldHonestifyCreationClaim({
    reply: 'Semana organizada, te cobro conforme for chegando.',
    taskMarkerFired: false, autoRetrySucceeded: false, awaitingConfirm: false, isInfoGathering: false,
  }), true);
});

test('shouldHonestify: cada gate bloqueia (marker/retry/confirm/info-gathering)', () => {
  const base = { reply: '✅ Anotei: Campo Grande terça.', taskMarkerFired: false, autoRetrySucceeded: false, awaitingConfirm: false, isInfoGathering: false };
  assert.strictEqual(shouldHonestifyCreationClaim({ ...base, taskMarkerFired: true }), false);
  assert.strictEqual(shouldHonestifyCreationClaim({ ...base, autoRetrySucceeded: true }), false);
  assert.strictEqual(shouldHonestifyCreationClaim({ ...base, awaitingConfirm: true }), false);
  assert.strictEqual(shouldHonestifyCreationClaim({ ...base, isInfoGathering: true }), false);
  assert.strictEqual(shouldHonestifyCreationClaim({ ...base, reply: 'beleza, bora!' }), false);
});

test('honestifyCreationClaim: rebaixa otimista (sanitizer injetado) + anexa honesto', () => {
  const fakeSanitize = (t, outcome) => { assert.strictEqual(outcome, 'failed'); return t.replace(/✅[^\n]*\n?/g, '').trim(); };
  const out = honestifyCreationClaim('✅ Anotei: Campo Grande.\nQualquer coisa me fala.', fakeSanitize);
  assert.ok(!out.includes('✅ Anotei'), 'removeu a confirmação falsa');
  assert.ok(/não cheguei a registrar/i.test(out), 'anexou a linha honesta');
});

test('honestifyCreationClaim: base vazia → só a linha honesta', () => {
  const out = honestifyCreationClaim('✅ Anotei!', () => '');
  assert.ok(/não cheguei a registrar/i.test(out));
});
