// src/services/event-reminders.test.js
// Sprint 31.x — editar o lembrete de um EVENTO via EVENT_UPDATE (reminders_minutes_before).
// buildEventReminderRows computa as linhas event_reminders a partir do start_at do evento
// e do array de minutos-antes-do-início. Mesma validação do caminho de CRIAÇÃO (0..30 dias).
// Caso REAL Rose/ADM 09/06 (evento 6778d729): ajuste de lembrete era rejeitado e nada acontecia.
//
// Rodar: node --test src/services/event-reminders.test.js

const { test } = require('node:test');
const assert = require('node:assert');
const { buildEventReminderRows } = require('./event-reminders');

test('um lembrete T-30: row em start − 30min', () => {
  const out = buildEventReminderRows('ev1', '2026-06-10T16:00:00+00:00', [30]);
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].event_id, 'ev1');
  assert.strictEqual(out[0].remind_at, '2026-06-10T15:30:00.000Z');
});

test('T-0 (na hora): row no exato start_at', () => {
  const out = buildEventReminderRows('ev1', '2026-06-10T16:00:00+00:00', [0]);
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].remind_at, '2026-06-10T16:00:00.000Z');
});

test('múltiplos offsets preservados (T-15, T-60, T-1440)', () => {
  const out = buildEventReminderRows('ev1', '2026-06-10T16:00:00+00:00', [15, 60, 1440]);
  assert.deepStrictEqual(out.map(r => r.remind_at), [
    '2026-06-10T15:45:00.000Z',
    '2026-06-10T15:00:00.000Z',
    '2026-06-09T16:00:00.000Z',
  ]);
});

test('array vazio = remover (nenhuma row)', () => {
  const out = buildEventReminderRows('ev1', '2026-06-10T16:00:00+00:00', []);
  assert.strictEqual(out.length, 0);
});

test('ignora valores inválidos (negativo, NaN, > 30 dias)', () => {
  const out = buildEventReminderRows('ev1', '2026-06-10T16:00:00+00:00', [-5, 'abc', 60 * 24 * 30 + 1, 30]);
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].remind_at, '2026-06-10T15:30:00.000Z');
});

test('start_at inválido → nenhuma row', () => {
  const out = buildEventReminderRows('ev1', 'not-a-date', [30]);
  assert.strictEqual(out.length, 0);
});

test('eventId ausente ou minutesArr não-array → nenhuma row', () => {
  assert.strictEqual(buildEventReminderRows(null, '2026-06-10T16:00:00+00:00', [30]).length, 0);
  assert.strictEqual(buildEventReminderRows('ev1', '2026-06-10T16:00:00+00:00', null).length, 0);
});
