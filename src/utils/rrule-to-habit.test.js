'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { rruleToHabitSchedule } = require('./rrule-to-habit');

// --- diário ---
test('FREQ=DAILY vira daily', () => {
  assert.deepStrictEqual(rruleToHabitSchedule('FREQ=DAILY'), { frequency: 'daily', custom_days: null });
});

test('FREQ=DAILY;INTERVAL=1 vira daily', () => {
  assert.deepStrictEqual(rruleToHabitSchedule('FREQ=DAILY;INTERVAL=1'), { frequency: 'daily', custom_days: null });
});

test('INTERVAL>1 nao tem equivalente em habito → null', () => {
  assert.strictEqual(rruleToHabitSchedule('FREQ=DAILY;INTERVAL=2'), null);
  assert.strictEqual(rruleToHabitSchedule('FREQ=WEEKLY;INTERVAL=2;BYDAY=MO'), null);
});

// --- semanal com dias ---
test('seg-sex vira weekdays (dialeto canonico do dispatcher)', () => {
  assert.deepStrictEqual(
    rruleToHabitSchedule('FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR'),
    { frequency: 'weekdays', custom_days: null },
  );
});

test('seg-sab vira custom_days [1..6] — caso REAL do Arthur, BYDAY fora de ordem', () => {
  assert.deepStrictEqual(
    rruleToHabitSchedule('FREQ=WEEKLY;BYDAY=MO,TU,TH,WE,FR,SA'),
    { frequency: 'custom_days', custom_days: [1, 2, 3, 4, 5, 6] },
  );
});

test('um unico dia vira custom_days com esse dia (nao "weekly" solto)', () => {
  assert.deepStrictEqual(
    rruleToHabitSchedule('FREQ=WEEKLY;BYDAY=SA'),
    { frequency: 'custom_days', custom_days: [6] },
  );
});

test('os 7 dias viram daily', () => {
  assert.deepStrictEqual(
    rruleToHabitSchedule('FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR,SA,SU'),
    { frequency: 'daily', custom_days: null },
  );
});

test('fim de semana vira custom_days [6,7]', () => {
  assert.deepStrictEqual(
    rruleToHabitSchedule('FREQ=WEEKLY;BYDAY=SA,SU'),
    { frequency: 'custom_days', custom_days: [6, 7] },
  );
});

test('BYDAY duplicado nao duplica o dia', () => {
  assert.deepStrictEqual(
    rruleToHabitSchedule('FREQ=WEEKLY;BYDAY=MO,MO,TU'),
    { frequency: 'custom_days', custom_days: [1, 2] },
  );
});

// --- semanal sem dias: ancora no dia do due_date ---
test('WEEKLY sem BYDAY usa o anchorDow do due_date', () => {
  assert.deepStrictEqual(
    rruleToHabitSchedule('FREQ=WEEKLY', { anchorDow: 3 }),
    { frequency: 'custom_days', custom_days: [3] },
  );
});

test('WEEKLY sem BYDAY e sem ancora → null (nao chuta o dia)', () => {
  assert.strictEqual(rruleToHabitSchedule('FREQ=WEEKLY'), null);
});

test('anchorDow invalido nao vira dia', () => {
  assert.strictEqual(rruleToHabitSchedule('FREQ=WEEKLY', { anchorDow: 0 }), null);
  assert.strictEqual(rruleToHabitSchedule('FREQ=WEEKLY', { anchorDow: 9 }), null);
});

// --- fora do alcance de habito: falha HONESTA (null), nunca aproximacao ---
test('MONTHLY/YEARLY nao tem equivalente → null', () => {
  assert.strictEqual(rruleToHabitSchedule('FREQ=MONTHLY;BYMONTHDAY=5'), null);
  assert.strictEqual(rruleToHabitSchedule('FREQ=YEARLY'), null);
});

test('BYDAY posicional (1MO = primeira segunda) → null', () => {
  assert.strictEqual(rruleToHabitSchedule('FREQ=MONTHLY;BYDAY=1MO'), null);
  assert.strictEqual(rruleToHabitSchedule('FREQ=WEEKLY;BYDAY=2FR'), null);
});

test('entrada vazia/lixo → null', () => {
  assert.strictEqual(rruleToHabitSchedule(null), null);
  assert.strictEqual(rruleToHabitSchedule(''), null);
  assert.strictEqual(rruleToHabitSchedule('   '), null);
  assert.strictEqual(rruleToHabitSchedule('banana'), null);
  assert.strictEqual(rruleToHabitSchedule(42), null);
});

test('BYDAY com token invalido derruba a conversao (nao ignora em silencio)', () => {
  assert.strictEqual(rruleToHabitSchedule('FREQ=WEEKLY;BYDAY=MO,XX'), null);
});

// --- tolerancia de formato ---
test('tolera RRULE: prefixo, minusculas e espacos', () => {
  assert.deepStrictEqual(
    rruleToHabitSchedule('RRULE:freq=weekly; byday=mo, tu, we, th, fr'),
    { frequency: 'weekdays', custom_days: null },
  );
});

test('UNTIL/COUNT nao atrapalham a leitura da frequencia', () => {
  assert.deepStrictEqual(
    rruleToHabitSchedule('FREQ=DAILY;UNTIL=20261231T000000Z'),
    { frequency: 'daily', custom_days: null },
  );
});
