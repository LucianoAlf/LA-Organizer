const { test } = require('node:test');
const assert = require('node:assert');
const { buildSaldoMsg, buildFaturaMsg, buildInvestMsg } = require('./pluggy-query-format');

test('saldo: lista contas + total quando >1', () => {
  const m = buildSaldoMsg([{ banco: 'Nubank', saldo: 2709.72 }, { banco: 'C6 Bank', saldo: 7.31 }]);
  assert.match(m, /Nubank: R\$ 2\.709,72/);
  assert.match(m, /Total: R\$ 2\.717,03/);
  assert.equal(buildSaldoMsg([]), 'Não achei conta conectada pra te dar o saldo agora. 🤔');
});

test('fatura: mostra a fatura A VENCER (bills), NÃO o saldo devedor', () => {
  const cartoes = [{
    banco: 'Nubank', saldoDevedor: 8925.04, minimo: 1500.7, disponivel: 15324.96,
    bills: [{ valor: 10004.71, vencimento: '2026-05-21' }, { valor: 6295.54, vencimento: '2026-06-22' }],
  }];
  const m = buildFaturaMsg(cartoes, '2026-06-15'); // a de 22/06 ainda a vencer
  assert.match(m, /Fatura Nubank.*6\.295,54/s);    // a fatura a pagar
  assert.match(m, /22\/06\/2026/);
  assert.match(m, /Mínimo: R\$ 1\.500,70/);
  assert.match(m, /disponível: R\$ 15\.324,96/);
  assert.doesNotMatch(m, /8\.925/);                // saldo devedor NÃO vira "fatura"
});

test('fatura: virada (fatura do mês não sincronizou) → saldo devedor + honestidade', () => {
  const cartoes = [{
    banco: 'Nubank', saldoDevedor: 8925.04, minimo: 1500.7, disponivel: 15324.96,
    bills: [{ valor: 10004.71, vencimento: '2026-05-21' }], // só a já vencida
  }];
  const m = buildFaturaMsg(cartoes, '2026-06-15');
  assert.match(m, /em aberto agora: R\$ 8\.925,04/);
  assert.match(m, /sincronizando/i);
  assert.match(m, /Última fatura fechada: R\$ 10\.004,71/);
  assert.match(m, /disponível: R\$ 15\.324,96/);
});

test('fatura: sem cartão conectado', () => {
  assert.equal(buildFaturaMsg([], '2026-06-15'), 'Não achei cartão conectado pra te mostrar a fatura. 🤔');
});

test('investimento: total + contagem; vazio', () => {
  assert.match(buildInvestMsg({ total: 23805.53, count: 16 }), /R\$ 23\.805,53.*16 aplicações/);
  assert.match(buildInvestMsg({ total: 0, count: 0 }), /Não achei/);
});
