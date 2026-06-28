'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { selectEventsWithoutReminder } = require('./event-reminder-audit');

// AUDIT-CHECK9-PENDING (28/06): CHECK 9 contava event_reminders TOTAL (incluía sent) → cego a
// evento futuro cuja única row já disparou (reschedule-orphan). Regra PURA: 0 PENDENTE + start
// > minLeadHours à frente. Guard de lead evita FP do lembrete legítimo já enviado no mesmo dia.
const NOW = Date.parse('2026-06-28T12:00:00-03:00'); // 28/06 12:00 BRT

test('evento >24h com 0 pendente → flagueia (órfão real)', () => {
  assert.deepStrictEqual(
    selectEventsWithoutReminder([{ title: 'Reunião ADM', start_at: '2026-07-01T14:00:00-03:00', pendingCount: 0 }], NOW),
    ['Reunião ADM']);
});

test('evento >24h COM lembrete pendente → não flagueia', () => {
  assert.deepStrictEqual(
    selectEventsWithoutReminder([{ title: 'Casamento', start_at: '2026-07-19T09:00:00-03:00', pendingCount: 1 }], NOW),
    []);
});

test('FP guard: evento <24h com 0 pendente (lembrete do dia já disparou) → NÃO flagueia', () => {
  assert.deepStrictEqual(
    selectEventsWithoutReminder([{ title: 'Reunião hoje', start_at: '2026-06-28T18:00:00-03:00', pendingCount: 0 }], NOW),
    []);
});

test('borda exata: start == now+24h → não flagueia (estritamente >)', () => {
  const start = new Date(NOW + 24 * 3600_000).toISOString();
  assert.deepStrictEqual(selectEventsWithoutReminder([{ title: 'Borda', start_at: start, pendingCount: 0 }], NOW), []);
});

test('mistos: só os >24h com 0 pendente', () => {
  const out = selectEventsWithoutReminder([
    { title: 'A_orfao_futuro', start_at: '2026-07-02T10:00:00-03:00', pendingCount: 0 },
    { title: 'B_tem_lembrete', start_at: '2026-07-02T10:00:00-03:00', pendingCount: 2 },
    { title: 'C_hoje_0pend', start_at: '2026-06-28T20:00:00-03:00', pendingCount: 0 },
  ], NOW);
  assert.deepStrictEqual(out, ['A_orfao_futuro']);
});

test('minLeadHours custom (0) → flagueia qualquer 0 pendente futuro', () => {
  assert.deepStrictEqual(
    selectEventsWithoutReminder([{ title: 'X', start_at: '2026-06-28T20:00:00-03:00', pendingCount: 0 }], NOW, { minLeadHours: 0 }),
    ['X']);
});

test('lista vazia / nula → []', () => {
  assert.deepStrictEqual(selectEventsWithoutReminder([], NOW), []);
  assert.deepStrictEqual(selectEventsWithoutReminder(null, NOW), []);
});

test('start_at inválido → ignora (defensivo)', () => {
  assert.deepStrictEqual(selectEventsWithoutReminder([{ title: 'bad', start_at: 'lixo', pendingCount: 0 }], NOW), []);
});
