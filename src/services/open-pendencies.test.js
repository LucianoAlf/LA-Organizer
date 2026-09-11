'use strict';
// open-pendencies.test.js — getStaleWorkEvents (fonte única da cobrança de evento vencido).
const { test } = require('node:test');
const assert = require('node:assert');
const { getStaleWorkEvents } = require('./open-pendencies');

function fakeSb(rows) {
  const selects = [];
  const api = {
    select(s) { selects.push(s); return api; },
    eq() { return api; }, not() { return api; }, lt() { return api; }, gte() { return api; },
    or() { return api; }, order() { return api; },
    limit() { return Promise.resolve({ data: rows, error: null }); },
  };
  return { from() { return api; }, _selects: selects };
}

// DEDUP-SERIE-NA-COBRANCA-DE-EVENTO (triagem 11/09 — 9827c3ee, e7c34891, da83061a): a Ana
// recebeu 3 cobranças seguidas às 08:12 de 04/07, 2 byte a byte iguais de "Reunião ADM" —
// molde da série + ocorrência com o mesmo end_at, cada um com seu cooldown.
test('REGRESSAO: molde e ocorrências da mesma série viram UMA cobrança; evento solto passa', async () => {
  const rows = [
    { id: 'inst2', title: 'Reunião ADM', end_at: '2026-07-03T14:00:00Z', recurrence_rule: null, recurrence_parent_id: 'tpl' },
    { id: 'tpl', title: 'Reunião ADM', end_at: '2026-07-03T14:00:00Z', recurrence_rule: 'FREQ=WEEKLY', recurrence_parent_id: null },
    { id: 'inst1', title: 'Reunião ADM', end_at: '2026-07-02T14:00:00Z', recurrence_rule: null, recurrence_parent_id: 'tpl' },
    { id: 'solto', title: 'Visita', end_at: '2026-07-02T10:00:00Z', recurrence_rule: null, recurrence_parent_id: null },
  ];
  const r = await getStaleWorkEvents(fakeSb(rows), { now: new Date('2026-07-04T11:00:00Z') });
  assert.deepStrictEqual(r.map((x) => x.id), ['inst2', 'solto']);
});

test('as duas formas da consulta trazem as colunas de série (sem elas o dedup é cego)', async () => {
  for (const opts of [{}, { sinceCooldownIso: '2026-07-03T11:00:00Z' }]) {
    const sb = fakeSb([]);
    await getStaleWorkEvents(sb, opts);
    assert.match(sb._selects[0], /recurrence_rule/);
    assert.match(sb._selects[0], /recurrence_parent_id/);
  }
});
