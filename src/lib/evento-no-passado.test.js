// EVENTO-CRIADO-NO-PASSADO (Alf 05/10 19:14 BRT): "Mentoria Levi" (d898903f) nasceu com início
// 05/10 09:00 — já passado na hora da criação — e ninguém perguntou. Era pra 07/10 09:00.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const p = require('./evento-no-passado');

// Momento REAL da criação: created_at 2026-10-05T22:14:15Z (19:14 BRT).
const CRIADO_EM = Date.parse('2026-10-05T22:14:15.543Z');
const MENTORIA = { title: 'Mentoria Levi', start_at: '2026-10-05T09:00:00-03:00', end_at: '2026-10-05T10:00:00-03:00' };

test('caso real: 05/10 09:00 criado às 19:14 do mesmo dia → já passou', () => {
  assert.equal(p.inicioJaPassou(MENTORIA.start_at, CRIADO_EM), true);
});

test('o que ele queria (07/10 09:00) não passou', () => {
  assert.equal(p.inicioJaPassou('2026-10-07T09:00:00-03:00', CRIADO_EM), false);
});

test('folga de 15 min: reunião que acabou de começar não pergunta', () => {
  const agora = Date.parse('2026-10-07T15:10:00-03:00');
  assert.equal(p.inicioJaPassou('2026-10-07T15:00:00-03:00', agora), false);
  assert.equal(p.inicioJaPassou('2026-10-07T14:50:00-03:00', agora), true);
});

test('início ilegível não é "passado" (outra validação cuida)', () => {
  assert.equal(p.inicioJaPassou('lixo', CRIADO_EM), false);
  assert.equal(p.inicioJaPassou(null, CRIADO_EM), false);
});

test('rótulo no fuso de SP', () => {
  assert.equal(p.rotuloInicio(MENTORIA.start_at), '05/10 09:00');
  assert.equal(p.rotuloInicio('2026-10-05T12:00:00+00:00'), '05/10 09:00');
});
