'use strict';
// Invariantes da recorrência de grupo — a base das asserções do replay integral.
const { test } = require('node:test');
const assert = require('node:assert');
const { contarVivasPorCicloTitulo, temBlueprintNoConjunto } = require('./group-recurrence-invariants');

const T = 'Dia 3 — conferir débito LJ 172 e LJ 168 antes de pagar';
const AGO = { titulo: T, ymdIni: '2026-08-01', ymdFim: '2026-08-31' };

test('conta 1 quando há blueprint + instância na MESMA data (o flag distingue)', () => {
  const rows = [
    { title: T, due_date: '2026-08-03', status: 'pending', is_recurrence_template: true },  // blueprint
    { title: T, due_date: '2026-08-03', status: 'pending', is_recurrence_template: false }, // instância viva
  ];
  assert.strictEqual(contarVivasPorCicloTitulo(rows, AGO), 1);
});

test('conta 2 (o BUG de hoje) quando o flag está AUSENTE nas duas', () => {
  const rows = [
    { title: T, due_date: '2026-08-03', status: 'pending' },
    { title: T, due_date: '2026-08-03', status: 'pending' },
  ];
  assert.strictEqual(contarVivasPorCicloTitulo(rows, AGO), 2);
});

test('ignora done/cancelled e due fora do intervalo do ciclo', () => {
  const rows = [
    { title: T, due_date: '2026-08-03', status: 'done', is_recurrence_template: false },
    { title: T, due_date: '2026-09-03', status: 'pending', is_recurrence_template: false },
    { title: T, due_date: '2026-08-03', status: 'pending', is_recurrence_template: false },
  ];
  assert.strictEqual(contarVivasPorCicloTitulo(rows, AGO), 1);
});

test('casa título com acento/caixa diferentes', () => {
  const rows = [{ title: 'DIA 3 — conferir débito lj 172 e lj 168 antes de pagar', due_date: '2026-08-03', status: 'pending', is_recurrence_template: false }];
  assert.strictEqual(contarVivasPorCicloTitulo(rows, AGO), 1);
});

test('temBlueprintNoConjunto detecta template no conjunto do resolvedor', () => {
  assert.strictEqual(temBlueprintNoConjunto([{ is_recurrence_template: false }, { is_recurrence_template: true }]), true);
  assert.strictEqual(temBlueprintNoConjunto([{ is_recurrence_template: false }]), false);
  assert.strictEqual(temBlueprintNoConjunto([]), false);
});
