'use strict';
// FIN-DIVERG-CONTA-VAZIA (10/08/2026) — o relatório das 18h acusava, todo dia:
//   ⚖️ Saldo não bate com o app:
//   • Santander: app R$ 0,00 · real R$ 96,06 (faltam R$ 96,06 no app)
//   • C6 Bank:   app R$ 0,00 · real R$ 89,01 (faltam R$ 89,01 no app)
//   • Itau:      app R$ 0,00 · real R$ 13.439,82 (faltam R$ 13.439,82 no app)
//
// As três contas do app têm ZERO lançamentos — nunca foram usadas. O cadastro tem duplicatas
// com grafias diferentes ("Itau" vazia vs "ITAU" com 3 lançamentos; "Nubank" vs "NUBANK" com
// 107), e o mapa do Pluggy aponta para as vazias. Saldo 0 por conta NÃO USADA não é divergência
// de conciliação: é o saldo real inteiro aparecendo como "faltando", todo dia, sem nunca poder
// ser resolvido por quem lê. Alarme que não tem ação possível é ruído — e ruído diário treina
// a pessoa a pular a seção inteira, inclusive no dia em que a divergência for real.

const test = require('node:test');
const assert = require('node:assert');
const { filtraDivergencias } = require('./divergencia-saldo');

test('conta sem nenhum lançamento não gera divergência', () => {
  const r = filtraDivergencias([
    { conta: 'Itau', saldoApp: 0, saldoReal: 13439.82, lancamentos: 0 },
    { conta: 'C6 Bank', saldoApp: 0, saldoReal: 89.01, lancamentos: 0 },
  ]);
  assert.deepEqual(r.divergencias, []);
  assert.deepEqual(r.contasVazias.sort(), ['C6 Bank', 'Itau']);
});

// O caso que a seção existe pra pegar: a conta É usada e mesmo assim não bate.
test('conta em uso com saldo diferente continua sendo reportada', () => {
  const r = filtraDivergencias([
    { conta: 'NUBANK', saldoApp: 1053.17, saldoReal: 900.00, lancamentos: 107 },
  ]);
  assert.equal(r.divergencias.length, 1);
  assert.equal(r.divergencias[0].conta, 'NUBANK');
  assert.equal(Math.round(r.divergencias[0].diff * 100) / 100, 153.17);
});

// Zerar uma conta que JÁ teve movimento é informação de verdade: alguém apagou lançamentos,
// ou o app perdeu dado. Diferente de nunca ter sido usada.
test('conta usada que zerou no app AINDA é divergência', () => {
  const r = filtraDivergencias([
    { conta: 'Santander', saldoApp: 0, saldoReal: 96.06, lancamentos: 12 },
  ]);
  assert.equal(r.divergencias.length, 1);
});

test('diferença abaixo do limite não vira linha', () => {
  const r = filtraDivergencias([
    { conta: 'NUBANK', saldoApp: 100.50, saldoReal: 100.00, lancamentos: 5 },
  ], { threshold: 1 });
  assert.deepEqual(r.divergencias, []);
  assert.deepEqual(r.contasVazias, [], 'conta em uso não pode ser rotulada de vazia');
});

test('lancamentos ausente (não medido) não silencia a divergência', () => {
  // Falha de leitura da contagem não pode virar "está tudo bem": na dúvida, reporta.
  const r = filtraDivergencias([
    { conta: 'Itau', saldoApp: 0, saldoReal: 13439.82, lancamentos: null },
  ]);
  assert.equal(r.divergencias.length, 1);
  assert.deepEqual(r.contasVazias, []);
});

test('entrada degenerada não quebra nem inventa linha', () => {
  for (const v of [null, undefined, [], 'lixo']) {
    const r = filtraDivergencias(v);
    assert.deepEqual(r.divergencias, []);
    assert.deepEqual(r.contasVazias, []);
  }
});
