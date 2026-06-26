'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { addDaysYmd, isVisibleForDay } = require('./day-visibility');

// ── addDaysYmd (fuso-safe, trava #4 do revisor) ──
test('addDaysYmd: +1 dia normal', () => {
  assert.equal(addDaysYmd('2026-06-25', 1), '2026-06-26');
});
test('addDaysYmd: vira o mês', () => {
  assert.equal(addDaysYmd('2026-06-30', 1), '2026-07-01');
});
test('addDaysYmd: vira o ano', () => {
  assert.equal(addDaysYmd('2026-12-31', 1), '2027-01-01');
});
test('addDaysYmd: ymd inválido → retorna o próprio (defensivo)', () => {
  assert.equal(addDaysYmd('lixo', 1), 'lixo');
});

// ── isVisibleForDay (predicado único, trava #2) ──
const CUT = '2026-06-26'; // cutoff = amanhã (hoje 25/06)
test('isVisibleForDay: hoje passa', () => {
  assert.equal(isVisibleForDay({ due_date: '2026-06-25' }, CUT), true);
});
test('isVisibleForDay: atrasada passa', () => {
  assert.equal(isVisibleForDay({ due_date: '2026-06-20' }, CUT), true);
});
test('isVisibleForDay: amanhã passa (preserva o ⏳)', () => {
  assert.equal(isVisibleForDay({ due_date: '2026-06-26' }, CUT), true);
});
test('isVisibleForDay: dia+2 corta; Bia (29/06, +4d) corta', () => {
  assert.equal(isVisibleForDay({ due_date: '2026-06-27' }, CUT), false);
  assert.equal(isVisibleForDay({ due_date: '2026-06-29' }, CUT), false);
});
test('isVisibleForDay: sem due passa (tarefa sem prazo)', () => {
  assert.equal(isVisibleForDay({ due_date: null }, CUT), true);
  assert.equal(isVisibleForDay({}, CUT), true);
  assert.equal(isVisibleForDay(null, CUT), true);
});
