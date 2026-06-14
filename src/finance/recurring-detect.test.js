const { test } = require('node:test');
const assert = require('node:assert');
const { normalizeMerchant, detectRecurring } = require('./recurring-detect');

test('normalizeMerchant tira sufixo, parcela e ids', () => {
  assert.equal(normalizeMerchant('NETFLIX.COM *123ABC'), 'netflix com');
  assert.equal(normalizeMerchant('Amazonmktplc *Frc (1/6)'), 'amazonmktplc');
  assert.equal(normalizeMerchant('Htm*Pv - Parcela 2/12'), 'htm');
});

test('detectRecurring: Netflix (valor estável) que subiu → priceCreep', () => {
  const txns = [
    { descricao: 'NETFLIX.COM', valor: 55, data: '2026-04-15' },
    { descricao: 'NETFLIX.COM', valor: 55, data: '2026-05-15' },
    { descricao: 'NETFLIX.COM', valor: 68, data: '2026-06-15' },
  ];
  const nf = detectRecurring(txns).find((x) => x.merchant === 'netflix com');
  assert.ok(nf, 'detectou Netflix');
  assert.equal(nf.priceCreep, true);
  assert.equal(nf.isNewSubscription, false);
  assert.equal(nf.lastAmount, 68);
  assert.equal(nf.prevAmount, 55);
  assert.ok(nf.deltaPct >= 20);
});

test('detectRecurring: 2ª ocorrência de valor fixo → isNewSubscription', () => {
  const txns = [
    { descricao: 'Spotify', valor: 23, data: '2026-05-10' },
    { descricao: 'Spotify', valor: 23, data: '2026-06-10' },
  ];
  const sp = detectRecurring(txns).find((x) => x.merchant === 'spotify');
  assert.ok(sp);
  assert.equal(sp.isNewSubscription, true);
  assert.equal(sp.priceCreep, false);
});

test('detectRecurring: gasto mensal VARIÁVEL (mercado) NÃO vira assinatura', () => {
  const txns = [
    { descricao: 'Supermercado X', valor: 410, data: '2026-05-10' },
    { descricao: 'Supermercado X', valor: 295, data: '2026-06-10' },
  ];
  const m = detectRecurring(txns).find((x) => x.merchant === 'supermercado x');
  assert.ok(m, 'agrupou a recorrência');
  assert.equal(m.isNewSubscription, false); // valores instáveis → não é assinatura
  assert.equal(m.priceCreep, false);
});

test('detectRecurring: ocorrência única NÃO é recorrente', () => {
  const r = detectRecurring([{ descricao: 'iFood', valor: 40, data: '2026-06-01' }]);
  assert.equal(r.length, 0);
});

test('detectRecurring: gastos esporádicos (não mensais) ficam fora', () => {
  const txns = [
    { descricao: 'Posto Shell', valor: 100, data: '2026-06-01' },
    { descricao: 'Posto Shell', valor: 100, data: '2026-06-03' }, // 2 dias → não mensal
  ];
  assert.equal(detectRecurring(txns).length, 0);
});
