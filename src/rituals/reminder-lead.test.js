'use strict';
// TDD do helper de antecedência de lembrete. Rodar: node --test src/rituals/reminder-lead.test.js
const test = require('node:test');
const assert = require('node:assert');
const { normalizeLead, shouldRemindEve, briefingCutoffYmd } = require('./reminder-lead');

test('normalizeLead: válidos passam; inválido/null → eve_and_day', () => {
  assert.strictEqual(normalizeLead('same_day'), 'same_day');
  assert.strictEqual(normalizeLead('daily'), 'daily');
  assert.strictEqual(normalizeLead('eve_and_day'), 'eve_and_day');
  assert.strictEqual(normalizeLead(null), 'eve_and_day');
  assert.strictEqual(normalizeLead(undefined), 'eve_and_day');
  assert.strictEqual(normalizeLead('xpto'), 'eve_and_day');
});

test('shouldRemindEve: só same_day NÃO dispara véspera', () => {
  assert.strictEqual(shouldRemindEve('same_day'), false);
  assert.strictEqual(shouldRemindEve('eve_and_day'), true);
  assert.strictEqual(shouldRemindEve('daily'), true);
  assert.strictEqual(shouldRemindEve(null), true); // default eve_and_day
});

test('briefingCutoffYmd: daily=amanhã (antecipa); senão=hoje', () => {
  assert.strictEqual(briefingCutoffYmd('daily', '2026-06-29', '2026-06-30'), '2026-06-30');
  assert.strictEqual(briefingCutoffYmd('eve_and_day', '2026-06-29', '2026-06-30'), '2026-06-29');
  assert.strictEqual(briefingCutoffYmd('same_day', '2026-06-29', '2026-06-30'), '2026-06-29');
  assert.strictEqual(briefingCutoffYmd(null, '2026-06-29', '2026-06-30'), '2026-06-29'); // default
});
