'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { detectDefeatism } = require('./derrotismo-detect');

test('pega a recusa literal do Matheus (24/06)', () => {
  const r = detectDefeatism('não tenho como editar transações financeiras pelo chat. Não existe o comando pra isso aqui, independente de quando foi o lançamento.', { actionableIntent: true, markerEmitted: false });
  assert.equal(r.suspect, true);
});
test('pega "faz mais de 2 dias" (regra inventada)', () => {
  assert.equal(detectDefeatism('Esses têm mais de 2 dias, então não alcança mais pelo chat.', { actionableIntent: true, markerEmitted: false }).suspect, true);
});
test('pega "vai (direto) no app" sem marker', () => {
  assert.equal(detectDefeatism('Vai direto no app: Finanças → Transações → toca no lançamento', { actionableIntent: true, markerEmitted: false }).suspect, true);
});
test('NÃO flagueia quando houve marker (TOM agiu)', () => {
  assert.equal(detectDefeatism('Pronto, ajustei pra você', { actionableIntent: true, markerEmitted: true }).suspect, false);
});
test('NÃO flagueia sem intent acionável (conversa solta)', () => {
  assert.equal(detectDefeatism('não tenho como saber disso, hein', { actionableIntent: false, markerEmitted: false }).suspect, false);
});
test('NÃO flagueia o redirect honesto (Modelo α): "no app você resolve em segundos"', () => {
  // o construtor negativo NÃO pode disparar o detector de derrotismo (não é recusa-mentira)
  assert.equal(detectDefeatism('Esse lançamento já tá fora das ~2h que eu alcanço — mas no app você resolve em segundos: Finanças → Transações.', { actionableIntent: true, markerEmitted: false }).suspect, false);
});
