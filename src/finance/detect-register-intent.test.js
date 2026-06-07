'use strict';
// Testes do detector determinístico de REGISTRO de transação (rede anti-fabricação).
// Roda com: node --test src/finance/detect-register-intent.test.js
const test = require('node:test');
const assert = require('node:assert');
const { detectRegisterIntent, looksLikeFinanceConfirmation } = require('./detect-register-intent');

// ── O caso real que quebrou (Matheus 07/06): LLM fabricou "Entrada registrada" sem marker ──
test('caso Matheus: lança entrada com valor → income high-confidence', () => {
  const r = detectRegisterIntent('E outra coisa, lança aí 300,00 como entrada, show no dom costela');
  assert.ok(r, 'deve detectar registro');
  assert.strictEqual(r.type, 'income');
  assert.strictEqual(r.amount, 300);
  assert.strictEqual(r.confidence, 'high');
  assert.match(r.description, /show/i);
});

// ── Tipo por verbo de ação ──
test('gastei → expense', () => {
  const r = detectRegisterIntent('gastei 50 no mercado');
  assert.ok(r); assert.strictEqual(r.type, 'expense'); assert.strictEqual(r.amount, 50);
});
test('paguei → expense', () => {
  const r = detectRegisterIntent('paguei 120 de luz');
  assert.ok(r); assert.strictEqual(r.type, 'expense'); assert.strictEqual(r.amount, 120);
});
test('recebi → income', () => {
  const r = detectRegisterIntent('recebi 1.200,00 de comissão');
  assert.ok(r); assert.strictEqual(r.type, 'income'); assert.strictEqual(r.amount, 1200);
});
test('entrou/caiu → income', () => {
  assert.strictEqual(detectRegisterIntent('entrou 300 no nubank').type, 'income');
  assert.strictEqual(detectRegisterIntent('caiu 80 hoje').type, 'income');
});

// ── typeHint (texto fabricado) desambigua verbo neutro ──
test('verbo neutro + hint de receita do texto fabricado → income', () => {
  const r = detectRegisterIntent('lança aí 300 show no dom costela', { typeHint: '💰 Entrada registrada! Saldo NUBANK +R$ 2.258,03' });
  assert.ok(r); assert.strictEqual(r.type, 'income'); assert.strictEqual(r.amount, 300);
});

// ── Número brasileiro ──
test('R$ 1.234,56 → 1234.56', () => {
  assert.strictEqual(detectRegisterIntent('lança 1.234,56 de aluguel').amount, 1234.56);
});
test('300 reais → 300', () => {
  assert.strictEqual(detectRegisterIntent('anota 300 reais de show').amount, 300);
});

// ── BAIL: complexos demais p/ rede determinística (deixa o usuário refazer) ──
test('parcelado → null (complexo)', () => {
  assert.strictEqual(detectRegisterIntent('comprei tv 1200 em 10x no nubank'), null);
});
test('transferência → null', () => {
  assert.strictEqual(detectRegisterIntent('transferi 500 do nubank pro itau'), null);
});
test('múltiplos valores → null', () => {
  assert.strictEqual(detectRegisterIntent('gastei 50 no mercado e 30 na farmacia'), null);
});

// ── NÃO é registro: queries / conversa ──
test('pergunta de saldo → null', () => {
  assert.strictEqual(detectRegisterIntent('qual meu saldo no nubank?'), null);
});
test('quanto gastei → null', () => {
  assert.strictEqual(detectRegisterIntent('quanto gastei esse mes?'), null);
});
test('extrato → null', () => {
  assert.strictEqual(detectRegisterIntent('me manda o extrato do nubank'), null);
});
test('sem valor → null', () => {
  assert.strictEqual(detectRegisterIntent('lança um show pra mim'), null);
});
test('conversa sem verbo de registro → null', () => {
  assert.strictEqual(detectRegisterIntent('e aí, tudo certo com as 300 pessoas?'), null);
});
test('vazio/nulo → null', () => {
  assert.strictEqual(detectRegisterIntent(''), null);
  assert.strictEqual(detectRegisterIntent(null), null);
});

// ── Assinatura de confirmação FABRICADA ──
test('confirmação fabricada (Entrada registrada + Saldo R$) casa', () => {
  assert.strictEqual(looksLikeFinanceConfirmation('💰 *Entrada registrada!*\n🎤 Show — Dom Costela\n💼 Saldo NUBANK: +R$ 2.258,03'), true);
});
test('confirmação real do engine (Receita registrada) também casa (gating é externo)', () => {
  assert.strictEqual(looksLikeFinanceConfirmation('💰 *Receita registrada!*\n💼 Saldo NUBANK: *+R$ 2.258,03*'), true);
});
test('conversa normal sobre dinheiro NÃO casa', () => {
  assert.strictEqual(looksLikeFinanceConfirmation('beleza! e quanto você gastou no show?'), false);
  assert.strictEqual(looksLikeFinanceConfirmation('seu saldo no nubank é R$ 1.958,03'), false); // sem "registrada"
  assert.strictEqual(looksLikeFinanceConfirmation('você registrou bastante coisa hoje'), false); // "registrou" ≠ registrad[ao]
});
