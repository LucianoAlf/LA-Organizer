const { test } = require('node:test');
const assert = require('node:assert');
const { buildForecastLine, buildRecurringLines, buildAnomalyNote } = require('./proactive-messages');

test('buildForecastLine formata previsão de fatura', () => {
  const s = buildForecastLine('Nubank', { alert: true, openTotal: 2100, avg: 1640, pctOver: 28, daysToClose: 3 });
  assert.match(s, /Nubank/);
  assert.match(s, /fecha em 3 dias/);
  assert.match(s, /2\.100,00/);
  assert.match(s, /28% acima/);
  assert.match(s, /1\.640,00/);
});

test('buildForecastLine sem alerta → null', () => {
  assert.equal(buildForecastLine('Nubank', null), null);
});

test('buildRecurringLines: aumento de assinatura e nova; gasto variável fica fora', () => {
  const lines = buildRecurringLines([
    { merchant: 'netflix com', priceCreep: true, isNewSubscription: false, lastAmount: 68, prevAmount: 55, deltaPct: 24 },
    { merchant: 'spotify', priceCreep: false, isNewSubscription: true, lastAmount: 23, prevAmount: 23, deltaPct: 0 },
    { merchant: 'uber', priceCreep: false, isNewSubscription: false }, // variável → não gera linha
  ]);
  assert.equal(lines.length, 2);
  assert.match(lines[0], /Netflix Com/);
  assert.match(lines[0], /55,00/);
  assert.match(lines[0], /68,00/);
  assert.match(lines[0], /\+24%/);
  assert.match(lines[1], /🆕/);
  assert.match(lines[1], /Spotify/);
});

test('buildAnomalyNote formata o aviso inline', () => {
  const s = buildAnomalyNote({ isAnomaly: true, avg: 45, ratio: 2 });
  assert.match(s, /~2×/);
  assert.match(s, /45,00/);
});

test('buildAnomalyNote sem anomalia → null', () => {
  assert.equal(buildAnomalyNote({ isAnomaly: false }), null);
});
