'use strict';
// A catraca entre "mandei" e "chegou". Ver o cabeçalho de entrega.js para o incidente.

const test = require('node:test');
const assert = require('node:assert');
const { entregar, EntregaNaoConfirmada } = require('./entrega');

test('postar que confirma devolve o comprovante', async () => {
  const r = await entregar(async () => ({ id: 'm1' }), 'oi', 'o relatório');
  assert.deepStrictEqual(r, { id: 'm1' });
});

test('postar que resolve com null é NÃO ENTREGUE — não é sucesso', async () => {
  await assert.rejects(
    () => entregar(async () => null, 'oi', 'o relatório do ciclo'),
    (e) => e instanceof EntregaNaoConfirmada && /o relatório do ciclo/.test(e.message),
  );
});

test('postar que não devolve nada não prova nada', async () => {
  await assert.rejects(() => entregar(() => {}, 'oi'), EntregaNaoConfirmada);
});

test('postar que lança propaga o erro de verdade — a causa não pode virar "não confirmada"', async () => {
  await assert.rejects(() => entregar(() => { throw new Error('uazapi 503'); }, 'oi'), /uazapi 503/);
});

test('o texto chega inteiro em quem posta', async () => {
  const vistas = [];
  await entregar((t) => { vistas.push(t); return { id: 'm1' }; }, 'relatório do ciclo');
  assert.deepStrictEqual(vistas, ['relatório do ciclo']);
});
