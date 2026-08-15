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

// GOVFIN-RECURRING-ALERTA-ETERNO — caso real da Rose: Google Canva cobrou 27/06 e 27/07 (2
// ocorrências estáveis), e o TOM mandou "entrou nas suas recorrências" TODO dia de 27/07 até
// 15/08 (19 dias), porque nada olhava QUANDO foi a última cobrança — só quantas existem.
test('detectRecurring: 2ª ocorrência RECENTE → isNewSubscription (refYmd dentro da janela)', () => {
  const txns = [
    { descricao: 'Google Canva AI PhotoSA', valor: 34.90, data: '2026-06-27' },
    { descricao: 'Google Canva AI PhotoSA', valor: 34.90, data: '2026-07-27' },
  ];
  const canva = detectRecurring(txns, '2026-07-29').find((x) => x.merchant.includes('canva'));
  assert.ok(canva);
  assert.equal(canva.isNewSubscription, true);
});

test('detectRecurring: 2ª ocorrência ANTIGA → isNewSubscription para de alertar (o bug da Rose)', () => {
  const txns = [
    { descricao: 'Google Canva AI PhotoSA', valor: 34.90, data: '2026-06-27' },
    { descricao: 'Google Canva AI PhotoSA', valor: 34.90, data: '2026-07-27' },
  ];
  // 15/08 é 19 dias depois da 2ª cobrança — exatamente o dia do relatório da Rose.
  const canva = detectRecurring(txns, '2026-08-15').find((x) => x.merchant.includes('canva'));
  assert.ok(canva, 'ainda detecta a recorrência (occurrences/amounts intactos)');
  assert.equal(canva.isNewSubscription, false);
});

test('detectRecurring: priceCreep também respeita a janela de recência', () => {
  const txns = [
    { descricao: 'NETFLIX.COM', valor: 55, data: '2026-04-15' },
    { descricao: 'NETFLIX.COM', valor: 55, data: '2026-05-15' },
    { descricao: 'NETFLIX.COM', valor: 68, data: '2026-06-15' },
  ];
  const recente = detectRecurring(txns, '2026-06-17').find((x) => x.merchant === 'netflix com');
  assert.equal(recente.priceCreep, true);
  const velho = detectRecurring(txns, '2026-08-15').find((x) => x.merchant === 'netflix com');
  assert.equal(velho.priceCreep, false);
});

// Sem refYmd o comportamento é o de sempre (compat com os testes acima que não passam data de
// referência) — produção (dispatcher.js) sempre passa; é o "sem filtro" que fica só pra quem
// não se importa com recência.
test('detectRecurring: sem refYmd, sem filtro de recência (compat)', () => {
  const txns = [
    { descricao: 'Spotify', valor: 23, data: '2020-01-10' },
    { descricao: 'Spotify', valor: 23, data: '2020-02-10' },
  ];
  const sp = detectRecurring(txns).find((x) => x.merchant === 'spotify');
  assert.equal(sp.isNewSubscription, true);
});
