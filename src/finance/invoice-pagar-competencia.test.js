// src/finance/invoice-pagar-competencia.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const { escolherCompetenciaParaPagar } = require('./invoice-pagar-competencia');

// CASO REAL (Rose, 14/08): "Paguei a fatura nubank com conta mercado pago". O cartão tem
// closing_day=7. Em 14/08 o ciclo ABERTO (currentCompetencia) já é setembro — a fatura de
// agosto (fechada dia 07, R$593,32, vence 14/08) é que estava em aberto. Sem competência
// explícita, o handler usava currentCompetencia() (setembro, 0 lançamentos) e respondia
// "A fatura do Cartão Nubank está zerada." — a pessoa insistiu 3x achando que o TOM não
// reconhecia o cartão, quando na verdade olhava o mês errado.
test('sem fatura fechada em aberto, usa a competência corrente (aberta)', () => {
  assert.strictEqual(escolherCompetenciaParaPagar([], '2026-09-01'), '2026-09-01');
});

test('com 1 fatura fechada em aberto, usa ela — não a corrente', () => {
  const r = escolherCompetenciaParaPagar([{ competencia: '2026-08-01', remaining: 593.32 }], '2026-09-01');
  assert.strictEqual(r, '2026-08-01');
});

test('com várias fechadas em aberto, usa a MAIS ANTIGA (a mais vencida)', () => {
  const r = escolherCompetenciaParaPagar([
    { competencia: '2026-08-01', remaining: 100 },
    { competencia: '2026-07-01', remaining: 50 },
  ], '2026-09-01');
  assert.strictEqual(r, '2026-07-01');
});

// paid >= total (remaining ~0) não é "em aberto" — não pode desviar a escolha.
test('fatura fechada já quitada (remaining ~0) não conta', () => {
  const r = escolherCompetenciaParaPagar([{ competencia: '2026-08-01', remaining: 0.004 }], '2026-09-01');
  assert.strictEqual(r, '2026-09-01');
});

test('entrada vazia/inválida cai na corrente', () => {
  assert.strictEqual(escolherCompetenciaParaPagar(null, '2026-09-01'), '2026-09-01');
  assert.strictEqual(escolherCompetenciaParaPagar(undefined, '2026-09-01'), '2026-09-01');
});
