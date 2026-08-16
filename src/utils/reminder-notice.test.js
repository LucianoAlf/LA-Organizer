'use strict';
// reminder-notice.test.js — Fatia 6 (#1 confirmação: surface da hora do lembrete).
// A tarefa nasce com remind_at CERTO e o lembrete dispara — mas a fala do TOM às vezes omite a
// hora ("Anotado — até 12/08"), e a pessoa acha que sumiu. buildReminderNotice devolve uma linha
// determinística "🔔 Lembro às HHh" pra anexar QUANDO a fala não cita a hora (dedup). Puro.
// Rodar: node --test src/utils/reminder-notice.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const { buildReminderNotice } = require('./reminder-notice');

// 10:00 UTC = 07:00 BRT (UTC-3). Caso real "Consertar máquina de lavar".
const R07 = '2026-08-12T10:00:00+00:00';

test('fala omite a hora → anexa "🔔 Lembro às 7h"', () => {
  assert.strictEqual(buildReminderNotice(R07, '✅ Anotado: *Consertar máquina de lavar* — até 2026-08-12.'), '🔔 Lembro às 7h.');
});

test('fala JÁ cita "às 7h" → null (não duplica)', () => {
  assert.strictEqual(buildReminderNotice(R07, 'Fechado! Te lembro às 7h de quarta.'), null);
});
test('fala cita "07h" → null', () => {
  assert.strictEqual(buildReminderNotice(R07, 'Anotado, lembro 07h.'), null);
});
test('fala cita "7:00" → null', () => {
  assert.strictEqual(buildReminderNotice(R07, 'Lembro 7:00 em ponto.'), null);
});
test('data "12/08" na fala NÃO conta como a hora → anexa (não é falso-skip)', () => {
  assert.strictEqual(buildReminderNotice(R07, 'Anotado — até 12/08.'), '🔔 Lembro às 7h.');
});

test('minuto ≠ 0 → "HHhMM"', () => {
  // 21:30 UTC = 18:30 BRT
  assert.strictEqual(buildReminderNotice('2026-08-12T21:30:00+00:00', 'Anotado.'), '🔔 Lembro às 18h30.');
});

test('múltiplos horários → usa o mais cedo', () => {
  const r = buildReminderNotice(['2026-08-12T21:00:00+00:00', '2026-08-12T13:00:00+00:00'], 'Anotado.');
  assert.strictEqual(r, '🔔 Lembro às 10h.'); // 13:00 UTC = 10:00 BRT (o mais cedo)
});

test('vazio/nulo/inválido → null sem lançar', () => {
  for (const v of [null, undefined, '', [], ['lixo'], 'não-iso']) {
    assert.strictEqual(buildReminderNotice(v, 'Anotado.'), null);
  }
});
