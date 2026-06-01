const { test } = require('node:test');
const assert = require('node:assert');
const { shiftReminderToInstance } = require('./recurrence-time');

// Extrai HH:MM no fuso BRT de um ISO UTC.
function hhmmBrt(iso) {
  const d = new Date(new Date(iso).getTime() - 3 * 3600_000);
  return d.toISOString().slice(11, 16);
}

test('lembrete 13h no template vira 13h em outro dia (mesmo HH:MM local)', () => {
  const out = shiftReminderToInstance('2026-06-01', '2026-06-01T13:00:00-03:00', '2026-06-15');
  assert.strictEqual(hhmmBrt(out), '13:00');
});

test('lembrete 20h preserva 20h em dia distante', () => {
  const out = shiftReminderToInstance('2026-06-01', '2026-06-01T20:00:00-03:00', '2026-06-30');
  assert.strictEqual(hhmmBrt(out), '20:00');
});

test('a data do remind_at acompanha a data da instância', () => {
  const out = shiftReminderToInstance('2026-06-01', '2026-06-01T13:00:00-03:00', '2026-06-15');
  assert.ok(out.startsWith('2026-06-15'), `esperava dia 15, veio ${out}`);
});
