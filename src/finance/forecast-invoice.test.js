const { test } = require('node:test');
const assert = require('node:assert');
const { forecastInvoiceAlert } = require('./forecast-invoice');

test('dispara quando perto de fechar e acima do threshold', () => {
  const r = forecastInvoiceAlert({ openTotal: 2100, closedTotals: [1600, 1700, 1620], daysToClose: 3 });
  assert.ok(r && r.alert === true);
  assert.equal(r.avg, 1640);
  assert.ok(r.pctOver >= 25);
});

test('null sem histórico suficiente (< 2 faturas)', () => {
  assert.equal(forecastInvoiceAlert({ openTotal: 2100, closedTotals: [1600], daysToClose: 3 }), null);
});

test('null se longe do fechamento', () => {
  assert.equal(forecastInvoiceAlert({ openTotal: 2100, closedTotals: [1600, 1700], daysToClose: 12 }), null);
});

test('null se dentro da média (não estourou o threshold)', () => {
  assert.equal(forecastInvoiceAlert({ openTotal: 1650, closedTotals: [1600, 1700], daysToClose: 3 }), null);
});

test('respeita threshold/windowDays custom', () => {
  const r = forecastInvoiceAlert({ openTotal: 1800, closedTotals: [1600, 1600], daysToClose: 7, threshold: 0.10, windowDays: 10 });
  assert.ok(r && r.alert === true); // 1800 >= 1600*1.10=1760 e 7<=10
});
