'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { packageVisibleThisMonth, findDuplicatePackages } = require('./package-churn');

const YM = '2026-06';

// ── packageVisibleThisMonth ────────────────────────────────────────────────
test('visível: vence no mês corrente', () => {
  assert.strictEqual(packageVisibleThisMonth('pending', '2026-06-25', YM), true);
});
test('visível: ciclo aberto sem prazo', () => {
  assert.strictEqual(packageVisibleThisMonth('pending', null, YM), true);
});
test('visível: aberto com prazo em mês passado (ainda rolando)', () => {
  assert.strictEqual(packageVisibleThisMonth('pending', '2026-05-01', YM), true);
});
test('NÃO visível: cancelado', () => {
  assert.strictEqual(packageVisibleThisMonth('cancelled', '2026-06-25', YM), false);
});
test('NÃO visível: done de mês passado (ciclo anterior — recorrência normal)', () => {
  assert.strictEqual(packageVisibleThisMonth('done', '2026-05-04', YM), false);
});
test('NÃO visível: vence em mês futuro', () => {
  assert.strictEqual(packageVisibleThisMonth('pending', '2026-07-01', YM), false);
});

// ── findDuplicatePackages ──────────────────────────────────────────────────
test('flagra 2 containers ATIVOS mesmo (grupo,título) no mês = churn', () => {
  const dups = findDuplicatePackages([
    { group_id: 'g1', group_name: 'Financeiro', title: 'Conciliação de Cartões', status: 'pending', due_date: null },
    { group_id: 'g1', group_name: 'Financeiro', title: 'Conciliação de Cartões', status: 'pending', due_date: '2026-06-01' },
  ], YM);
  assert.strictEqual(dups.length, 1);
  assert.strictEqual(dups[0].count, 2);
  assert.strictEqual(dups[0].title, 'Conciliação de Cartões');
});

test('NÃO flagra recorrência normal: 1 ativo este mês + 1 done mês passado', () => {
  const dups = findDuplicatePackages([
    { group_id: 'g1', title: 'Cashbacks', status: 'pending', due_date: '2026-06-04' },
    { group_id: 'g1', title: 'Cashbacks', status: 'done', due_date: '2026-05-04' },
  ], YM);
  assert.strictEqual(dups.length, 0);
});

test('NÃO flagra container único (estado limpo pós-reparo)', () => {
  const dups = findDuplicatePackages([
    { group_id: 'g1', title: 'Conciliação de Cartões', status: 'pending', due_date: null },
    { group_id: 'g1', title: 'Cashbacks', status: 'done', due_date: '2026-06-04' },
    { group_id: 'g1', title: 'Planilha', status: 'done', due_date: '2026-06-05' },
  ], YM);
  assert.strictEqual(dups.length, 0);
});

test('títulos diferentes / grupos diferentes não agrupam', () => {
  const dups = findDuplicatePackages([
    { group_id: 'g1', title: 'A', status: 'pending', due_date: null },
    { group_id: 'g2', title: 'A', status: 'pending', due_date: null }, // outro grupo
    { group_id: 'g1', title: 'B', status: 'pending', due_date: null },
  ], YM);
  assert.strictEqual(dups.length, 0);
});

test('cancelado não conta pro duplicado', () => {
  const dups = findDuplicatePackages([
    { group_id: 'g1', title: 'X', status: 'pending', due_date: null },
    { group_id: 'g1', title: 'X', status: 'cancelled', due_date: '2026-06-01' },
  ], YM);
  assert.strictEqual(dups.length, 0);
});
