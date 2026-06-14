const { test } = require('node:test');
const assert = require('node:assert');
const { buildSaldoMsg, buildFaturaMsg, buildInvestMsg } = require('./pluggy-query-format');

test('saldo: lista contas + total quando >1', () => {
  const m = buildSaldoMsg([{ banco: 'Nubank', saldo: 2709.72 }, { banco: 'C6 Bank', saldo: 7.31 }]);
  assert.match(m, /Nubank: R\$ 2\.709,72/);
  assert.match(m, /Total: R\$ 2\.717,03/);
  assert.equal(buildSaldoMsg([]), 'Não achei conta conectada pra te dar o saldo agora. 🤔');
});

test('fatura: valor + vencimento + mínimo + disponível', () => {
  const m = buildFaturaMsg([{ banco: 'Nubank', fatura: 8925.04, vencimento: '2026-05-21', minimo: 1500.7, disponivel: 15324.96 }]);
  assert.match(m, /Fatura Nubank.*8\.925,04/s);
  assert.match(m, /21\/05\/2026/);
  assert.match(m, /Mínimo: R\$ 1\.500,70/);
  assert.match(m, /disponível: R\$ 15\.324,96/);
});

test('investimento: total + contagem; vazio', () => {
  assert.match(buildInvestMsg({ total: 23805.53, count: 16 }), /R\$ 23\.805,53.*16 aplicações/);
  assert.match(buildInvestMsg({ total: 0, count: 0 }), /Não achei/);
});
