// src/utils/dates.anchor.test.js — âncora temporal BRT (BUG weekday GROUPCHAT-TASK-DUP-WEEKDAY)
const assert = require('node:assert');
const { test } = require('node:test');
const { buildBrtDateAnchor } = require('./dates');

test('ancora hoje = sexta 12/06 e mapeia segunda = 15/06 (não 16)', () => {
  const s = buildBrtDateAnchor(new Date('2026-06-12T18:00:00-03:00'));
  assert.match(s, /2026-06-12/);
  assert.match(s, /sexta/);
  assert.match(s, /sexta 12\/06 \(HOJE\)/);
  assert.match(s, /sábado 13\/06 \(amanhã\)/);
  assert.match(s, /segunda 15\/06/);   // a correção do caso real: segunda = 15
  assert.doesNotMatch(s, /segunda 16\/06/); // 16 é terça, nunca segunda
});

test('não desloca o dia após 21h BRT (guard LOCALYMD-UTC-SHIFT)', () => {
  // 23:30 BRT de 12/06 = 02:30 UTC de 13/06 — o dia civil ainda é 12/06 (sexta).
  const s = buildBrtDateAnchor(new Date('2026-06-13T02:30:00Z'));
  assert.match(s, /2026-06-12/);
  assert.match(s, /sexta 12\/06 \(HOJE\)/);
  assert.doesNotMatch(s, /sábado 13\/06 \(HOJE\)/);
});

test('tabela tem 16 dias e regra anti-cálculo mental', () => {
  const s = buildBrtDateAnchor(new Date('2026-06-12T12:00:00-03:00'));
  assert.match(s, /NUNCA calcule mentalmente/);
  // conta separadores " | " → 15 → 16 itens
  assert.equal((s.match(/ \| /g) || []).length, 15);
});
