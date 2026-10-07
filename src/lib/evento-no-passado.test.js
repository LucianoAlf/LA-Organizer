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

test('separarPassados: o passado sai marcado pra confirmação; o resto segue', () => {
  const futuro = { title: 'Outro', start_at: '2026-10-08T10:00:00-03:00' };
  const r = p.separarPassados([MENTORIA, futuro], CRIADO_EM);
  assert.deepEqual(r.liberados.map((e) => e.title), ['Outro']);
  assert.deepEqual(r.passados.map((e) => e.title), ['Mentoria Levi']);
  assert.equal(r.passados[0][p.FLAG_CONFIRMADO], true);
  assert.equal(MENTORIA[p.FLAG_CONFIRMADO], undefined, 'não muta o original');
});

test('separarPassados: já confirmado (flag do engine) passa', () => {
  const r = p.separarPassados([{ ...MENTORIA, [p.FLAG_CONFIRMADO]: true }], CRIADO_EM);
  assert.equal(r.passados.length, 0);
  assert.equal(r.liberados.length, 1);
});

test('pergunta: horário + título + saída pra corrigir o dia', () => {
  assert.equal(
    p.perguntaInicioNoPassado([MENTORIA]),
    'Esse horário já passou (05/10 09:00) — *Mentoria Levi*. É isso mesmo? Se era pra outro dia, me diz qual.',
  );
  assert.match(p.perguntaInicioNoPassado([MENTORIA, { title: 'B', start_at: '2026-10-05T08:00:00-03:00' }]), /Esses horários já passaram/);
});

test('flag vinda do LLM é descartada (privilégio do engine)', () => {
  const item = { title: 'x', [p.FLAG_CONFIRMADO]: true };
  p.descartarFlagDoModelo(item);
  assert.equal(p.FLAG_CONFIRMADO in item, false);
});
