// src/services/reschedule-reminders.test.js
// Sprint 31.12 — ao reagendar um evento, os lembretes não-enviados precisam acompanhar
// o novo horário. Encoda o caso REAL Matheus/Bia 03/06 (reschedule deixava o lembrete
// velho disparar no horário antigo).
//
// Rodar: node --test src/services/reschedule-reminders.test.js

const { test } = require('node:test');
const assert = require('node:assert');
const { shiftRemindersByReschedule, shiftTaskRemindAt, planRescheduleReminders } = require('./reschedule-reminders');

test('caso Bia 03/06: reschedule 06-03 13:30 → 06-08 13:00 desloca o lembrete T-15 junto', () => {
  const out = shiftRemindersByReschedule(
    [{ id: 'r1', remind_at: '2026-06-03T13:15:00-03:00' }],
    '2026-06-03T13:30:00-03:00',
    '2026-06-08T13:00:00-03:00'
  );
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].id, 'r1');
  // T-15 do novo horário (13:00 BRT − 15min = 12:45 BRT = 15:45Z)
  assert.strictEqual(out[0].remind_at, '2026-06-08T15:45:00.000Z');
});

test('preserva offsets distintos (T-15 e T-60) ao mover +1 dia', () => {
  const out = shiftRemindersByReschedule(
    [
      { id: 'a', remind_at: '2026-06-03T13:45:00-03:00' }, // T-15
      { id: 'b', remind_at: '2026-06-03T13:00:00-03:00' }, // T-60
    ],
    '2026-06-03T14:00:00-03:00',
    '2026-06-04T14:00:00-03:00' // +1 dia exato
  );
  assert.strictEqual(out.length, 2);
  assert.strictEqual(out[0].remind_at, '2026-06-04T16:45:00.000Z'); // 13:45 BRT +1d
  assert.strictEqual(out[1].remind_at, '2026-06-04T16:00:00.000Z'); // 13:00 BRT +1d
});

test('start antigo/novo inválido → [] (não mexe em nada)', () => {
  assert.deepStrictEqual(shiftRemindersByReschedule([{ id: 'x', remind_at: '2026-06-03T13:00:00-03:00' }], 'lixo', '2026-06-08T13:00:00-03:00'), []);
  assert.deepStrictEqual(shiftRemindersByReschedule([{ id: 'x', remind_at: '2026-06-03T13:00:00-03:00' }], '2026-06-03T13:00:00-03:00', null), []);
});

test('delta zero (mesmo horário) → [] (nada a fazer)', () => {
  const same = '2026-06-03T13:00:00-03:00';
  assert.deepStrictEqual(shiftRemindersByReschedule([{ id: 'x', remind_at: same }], same, same), []);
});

test('reminder com remind_at inválido é ignorado, válidos passam', () => {
  const out = shiftRemindersByReschedule(
    [{ id: 'ok', remind_at: '2026-06-03T13:45:00-03:00' }, { id: 'bad', remind_at: 'nope' }],
    '2026-06-03T14:00:00-03:00',
    '2026-06-04T14:00:00-03:00'
  );
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].id, 'ok');
});

test('lista vazia / nula → []', () => {
  assert.deepStrictEqual(shiftRemindersByReschedule([], '2026-06-03T13:00:00-03:00', '2026-06-04T13:00:00-03:00'), []);
  assert.deepStrictEqual(shiftRemindersByReschedule(null, '2026-06-03T13:00:00-03:00', '2026-06-04T13:00:00-03:00'), []);
});

// ── shiftTaskRemindAt (Sprint 31.13 — caso Kinho/Yuri) ──────────────────────────
test('caso Kinho: due 06-01 → 06-06 (+5d) desloca o remind_at +5 dias, mantendo a hora', () => {
  // remind_at 29/05 15:00 BRT = 18:00Z; +5 dias = 03/06 18:00Z (hora preservada)
  const out = shiftTaskRemindAt('2026-06-01', '2026-06-06', '2026-05-29T18:00:00.000Z');
  assert.strictEqual(out, '2026-06-03T18:00:00.000Z');
});

test('mover +1 dia preserva o horário do dia', () => {
  assert.strictEqual(
    shiftTaskRemindAt('2026-06-03', '2026-06-04', '2026-06-03T12:30:00.000Z'),
    '2026-06-04T12:30:00.000Z'
  );
});

test('reagendar pra trás (delta negativo) também desloca', () => {
  assert.strictEqual(
    shiftTaskRemindAt('2026-06-10', '2026-06-08', '2026-06-10T09:00:00.000Z'),
    '2026-06-08T09:00:00.000Z'
  );
});

test('sem due antigo, sem due novo ou sem remind_at → null (nada a fazer)', () => {
  assert.strictEqual(shiftTaskRemindAt(null, '2026-06-06', '2026-05-29T18:00:00.000Z'), null);
  assert.strictEqual(shiftTaskRemindAt('2026-06-01', null, '2026-05-29T18:00:00.000Z'), null);
  assert.strictEqual(shiftTaskRemindAt('2026-06-01', '2026-06-06', null), null);
});

test('delta zero (mesmo due) → null', () => {
  assert.strictEqual(shiftTaskRemindAt('2026-06-06', '2026-06-06', '2026-06-06T12:00:00.000Z'), null);
});

test('datas inválidas → null', () => {
  assert.strictEqual(shiftTaskRemindAt('lixo', '2026-06-06', '2026-05-29T18:00:00.000Z'), null);
  assert.strictEqual(shiftTaskRemindAt('2026-06-01', '2026-06-06', 'nope'), null);
});

// ── planRescheduleReminders (EVENT-RESCHED-REMINDER-NOREGEN 28/06) ──────────────
// O reschedule só deslocava rows sent_at IS NULL. Se a única row já tinha DISPARADO
// (ou não havia row), o evento reagendado ficava SEM lembrete pendente (caso ADM:
// row T-15 fired 06-24 → reschedule 07-01 → 0 pendente). O plano garante ≥1 pendente.
test('reschedule COM lembrete pendente → desloca, sem inserir default', () => {
  const out = planRescheduleReminders({
    unsentRows: [{ id: 'r1', remind_at: '2026-06-03T13:15:00-03:00' }],
    oldStartIso: '2026-06-03T13:30:00-03:00',
    newStartIso: '2026-06-08T13:00:00-03:00',
    eventId: 'e1',
  });
  assert.strictEqual(out.shifts.length, 1);
  assert.strictEqual(out.shifts[0].remind_at, '2026-06-08T15:45:00.000Z');
  assert.deepStrictEqual(out.inserts, []);
});

test('caso ADM: 0 pendente (única row já disparou) → 1 default T-15 do novo start', () => {
  const out = planRescheduleReminders({
    unsentRows: [],
    oldStartIso: '2026-06-24T14:00:00-03:00',
    newStartIso: '2026-07-01T14:00:00-03:00',
    eventId: 'adm1',
  });
  assert.deepStrictEqual(out.shifts, []);
  assert.strictEqual(out.inserts.length, 1);
  assert.strictEqual(out.inserts[0].event_id, 'adm1');
  // 14:00 BRT − 15min = 13:45 BRT = 16:45Z
  assert.strictEqual(out.inserts[0].remind_at, '2026-07-01T16:45:00.000Z');
});

test('EDGE: delta-zero COM rows pendentes → NÃO inventa default (hadUnsent manda, não shifts)', () => {
  const same = '2026-07-01T14:00:00-03:00';
  const out = planRescheduleReminders({
    unsentRows: [{ id: 'r1', remind_at: '2026-07-01T13:45:00-03:00' }],
    oldStartIso: same, newStartIso: same, eventId: 'e1',
  });
  assert.deepStrictEqual(out.shifts, []); // delta 0 → shift vazio
  assert.deepStrictEqual(out.inserts, []); // mas tinha pendente → não insere default
});

test('0 pendente + newStart inválido → sem insert (defensivo)', () => {
  const out = planRescheduleReminders({ unsentRows: [], oldStartIso: '2026-06-24T14:00:00-03:00', newStartIso: 'lixo', eventId: 'e1' });
  assert.deepStrictEqual(out.inserts, []);
});

test('0 pendente + defaultMin custom (60) → T-60 do novo start', () => {
  const out = planRescheduleReminders({
    unsentRows: [], oldStartIso: '2026-06-24T14:00:00-03:00', newStartIso: '2026-07-01T14:00:00-03:00', eventId: 'e1', defaultMin: 60,
  });
  assert.strictEqual(out.inserts[0].remind_at, '2026-07-01T16:00:00.000Z'); // 14:00 BRT − 60 = 13:00 BRT = 16:00Z
});
