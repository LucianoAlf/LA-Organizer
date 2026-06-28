import { describe, it, expect } from 'vitest';
import { shiftLocalReminderTimes, shiftReminderRowsByReschedule } from './reminderShift';

// EVENT-RESCHED-REMINDER-PWA — gêmeo PWA do shiftRemindersByReschedule do engine
// (src/services/reschedule-reminders.js). Ao reagendar um evento no app, os lembretes
// (datetime-local absolutos) precisam acompanhar o novo start, preservando o offset.
describe('shiftLocalReminderTimes', () => {
  it('desloca o lembrete pelo delta do start (offset-preserving) — reschedule de dia', () => {
    // evento 03/06 14:00 → 29/06 14:00 (delta +26 dias). T-15 (13:45) acompanha.
    const out = shiftLocalReminderTimes(['2026-06-03T13:45'], '2026-06-03T14:00', '2026-06-29T14:00');
    expect(out).toEqual(['2026-06-29T13:45']);
  });

  it('preserva o offset com múltiplos lembretes (T-15, T-1h, T-1dia)', () => {
    const out = shiftLocalReminderTimes(
      ['2026-06-03T13:45', '2026-06-03T13:00', '2026-06-02T14:00'],
      '2026-06-03T14:00',
      '2026-06-04T16:00', // +1 dia +2h = +26h
    );
    expect(out).toEqual(['2026-06-04T15:45', '2026-06-04T15:00', '2026-06-03T16:00']);
  });

  it('delta 0 (mesmo horário) → inalterado', () => {
    const times = ['2026-06-03T13:45'];
    expect(shiftLocalReminderTimes(times, '2026-06-03T14:00', '2026-06-03T14:00')).toEqual(times);
  });

  it('lista vazia → vazia (sem ensure-pending no PWA: vazio é estado explícito do usuário)', () => {
    expect(shiftLocalReminderTimes([], '2026-06-03T14:00', '2026-06-29T14:00')).toEqual([]);
  });

  it('start antigo vazio/inválido → não desloca (retorna como está)', () => {
    const times = ['2026-06-03T13:45'];
    expect(shiftLocalReminderTimes(times, '', '2026-06-29T14:00')).toEqual(times);
    expect(shiftLocalReminderTimes(times, 'lixo', '2026-06-29T14:00')).toEqual(times);
  });

  it('start novo inválido → não desloca', () => {
    const times = ['2026-06-03T13:45'];
    expect(shiftLocalReminderTimes(times, '2026-06-03T14:00', '')).toEqual(times);
  });

  it('lembrete individual inválido é mantido; os válidos deslocam', () => {
    const out = shiftLocalReminderTimes(
      ['2026-06-03T13:45', 'xx'],
      '2026-06-03T14:00',
      '2026-06-04T14:00', // +1 dia
    );
    expect(out).toEqual(['2026-06-04T13:45', 'xx']);
  });

  it('reschedule pra mais cedo desloca pra trás (espelha o engine, sem guard de passado)', () => {
    const out = shiftLocalReminderTimes(['2026-06-29T13:45'], '2026-06-29T14:00', '2026-06-29T10:00');
    expect(out).toEqual(['2026-06-29T09:45']);
  });

  it('cruza a virada do dia corretamente (sem DST no Brasil)', () => {
    const out = shiftLocalReminderTimes(['2026-06-03T23:50'], '2026-06-04T00:00', '2026-06-04T02:00');
    expect(out).toEqual(['2026-06-04T01:50']);
  });
});

// Caminho DRAG (AgendaDesktop.onEventDrop) — opera em rows ISO, só nas pendentes.
describe('shiftReminderRowsByReschedule (drag/ISO)', () => {
  it('desloca cada row pelo delta do start (ISO)', () => {
    const out = shiftReminderRowsByReschedule(
      [{ id: 'a', remind_at: '2026-06-03T16:45:00.000Z' }],
      '2026-06-03T17:00:00.000Z',
      '2026-06-29T17:00:00.000Z',
    );
    expect(out).toEqual([{ id: 'a', remind_at: '2026-06-29T16:45:00.000Z' }]);
  });

  it('delta 0 → [] (nada a atualizar)', () => {
    expect(shiftReminderRowsByReschedule(
      [{ id: 'a', remind_at: '2026-06-03T16:45:00.000Z' }],
      '2026-06-03T17:00:00.000Z', '2026-06-03T17:00:00.000Z',
    )).toEqual([]);
  });

  it('start inválido → []', () => {
    expect(shiftReminderRowsByReschedule(
      [{ id: 'a', remind_at: '2026-06-03T16:45:00.000Z' }],
      '', '2026-06-29T17:00:00.000Z',
    )).toEqual([]);
  });

  it('pula row com remind_at inválido, mantém as válidas', () => {
    const out = shiftReminderRowsByReschedule(
      [{ id: 'a', remind_at: '2026-06-03T16:45:00.000Z' }, { id: 'b', remind_at: 'lixo' }],
      '2026-06-03T17:00:00.000Z', '2026-06-04T17:00:00.000Z', // +1 dia
    );
    expect(out).toEqual([{ id: 'a', remind_at: '2026-06-04T16:45:00.000Z' }]);
  });

  it('rows vazias → []', () => {
    expect(shiftReminderRowsByReschedule([], '2026-06-03T17:00:00.000Z', '2026-06-29T17:00:00.000Z')).toEqual([]);
  });
});
