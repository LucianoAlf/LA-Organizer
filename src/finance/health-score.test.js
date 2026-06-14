const { test } = require('node:test');
const assert = require('node:assert');
const { computeHealthScore } = require('./health-score');

const ff = (hs, key) => hs.factors.find((f) => f.key === key);

test('saúde boa → 🟢 e sem topLever (score ≥ 90)', () => {
  const hs = computeHealthScore({
    receitas: 5000, despesas: 3000,            // rate 0.40 → poupança 100
    credit: { used: 200, limit: 2000 },        // u 0.10 → crédito 100
    goals: [{ current_amount: 600, target_amount: 1000 }], // 60% → reserva 80
  });
  assert.equal(hs.score, 95);
  assert.equal(hs.band, '🟢');
  assert.equal(hs.topLever, null);
});

test('cartão estourado vira a maior alavanca (topLever = credito)', () => {
  const hs = computeHealthScore({
    receitas: 5000, despesas: 3000,            // poupança 100
    credit: { used: 1900, limit: 2000 },       // u 0.95 → crédito ~7
    goals: [{ current_amount: 600, target_amount: 1000 }], // reserva 80
  });
  assert.equal(hs.score, 67);
  assert.equal(hs.band, '🟡');
  assert.equal(hs.topLever.key, 'credito');
});

test('sem cartão → fator crédito não-aplicável, pesos renormalizam', () => {
  const hs = computeHealthScore({
    receitas: 4000, despesas: 3600,            // rate 0.10 → poupança 75
    credit: { used: 0, limit: 0 },             // sem cartão
    goals: [],                                 // sem meta → reserva 40
  });
  assert.equal(ff(hs, 'credito').applicable, false);
  assert.equal(hs.score, 63); // (75*45 + 40*25) / 70
  assert.equal(hs.band, '🟡');
});

test('gastou mais do que ganhou → 🔴 e poupança é a alavanca', () => {
  const hs = computeHealthScore({
    receitas: 3000, despesas: 4500,            // rate -0.50 → poupança 0
    credit: {}, goals: [],
  });
  assert.equal(hs.score, 14); // (0*45 + 40*25) / 70
  assert.equal(hs.band, '🔴');
  assert.equal(hs.topLever.key, 'poupanca');
});

test('hint da poupança fica honesto quando fechou no vermelho (score 0)', () => {
  const hs = computeHealthScore({ receitas: 3000, despesas: 6000, credit: {}, goals: [] });
  assert.equal(hs.topLever.key, 'poupanca');
  assert.match(hs.topLever.hint, /vermelho/);
});

test('inputs vazios não quebram → cai só na reserva (40, 🔴)', () => {
  const hs = computeHealthScore({});
  assert.equal(hs.score, 40);
  assert.equal(hs.band, '🔴');
  assert.equal(ff(hs, 'poupanca').applicable, false);
  assert.equal(ff(hs, 'credito').applicable, false);
});

test('reserva: sem meta→40, meta sem aporte→45, meta 50%→75', () => {
  const r = (goals) => ff(computeHealthScore({ receitas: 1000, despesas: 500, credit: {}, goals }), 'reserva').score;
  assert.equal(r([]), 40);
  assert.equal(r([{ current_amount: 0, target_amount: 1000 }]), 45);
  assert.equal(r([{ current_amount: 500, target_amount: 1000 }]), 75);
});
