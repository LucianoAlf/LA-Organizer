import { describe, it, expect } from 'vitest';
import { planejaLembretesDeInstancias } from './instanceReminders';

// INSTANCIA-PWA-SEM-LEMBRETE (Duda 08/09/2026): "Vitaminas e ferro do Vicente", diária 09:00 BRT
// com lembrete às 08:00, criada pelo app. As instâncias nasceram sem nenhum lembrete.
const MOLDE = { start_at: '2026-09-08T12:00:00.000Z' };
const UMA_HORA_ANTES = [{ remind_at: '2026-09-08T11:00:00.000Z', label: null }];

describe('planejaLembretesDeInstancias', () => {
  it('o caso da Duda: cada vitamina nova ganha o lembrete 1h antes', () => {
    const r = planejaLembretesDeInstancias('events', MOLDE, UMA_HORA_ANTES, [
      { id: 'v1', start_at: '2026-09-09T12:00:00.000Z' },
      { id: 'v2', start_at: '2026-09-10T12:00:00.000Z' },
    ]);
    expect(r).toEqual([
      { event_id: 'v1', remind_at: '2026-09-09T11:00:00.000Z', label: null },
      { event_id: 'v2', remind_at: '2026-09-10T11:00:00.000Z', label: null },
    ]);
  });

  it('não duplica o lembrete que a instância já tem', () => {
    const r = planejaLembretesDeInstancias('events', MOLDE, UMA_HORA_ANTES,
      [{ id: 'v1', start_at: '2026-09-09T12:00:00.000Z' }],
      [{ id: 'v1', remind_at: '2026-09-09T11:00:00+00:00' }]);
    expect(r).toEqual([]);
  });

  it('vários lembretes no molde viram vários na instância, com o rótulo', () => {
    const r = planejaLembretesDeInstancias('events', MOLDE, [
      { remind_at: '2026-09-08T11:00:00.000Z', label: '1h antes' },
      { remind_at: '2026-09-08T11:45:00.000Z', label: '15min antes' },
    ], [{ id: 'v1', start_at: '2026-09-09T12:00:00.000Z' }]);
    expect(r.map((x) => x.label)).toEqual(['1h antes', '15min antes']);
    expect(r[1].remind_at).toBe('2026-09-09T11:45:00.000Z');
  });

  it('tarefa ancora no dia (00:00 BRT) e grava em task_id', () => {
    const r = planejaLembretesDeInstancias('tasks', { due_date: '2026-09-08' },
      [{ remind_at: '2026-09-08T11:00:00.000Z', label: null }],
      [{ id: 't1', due_date: '2026-09-09' }]);
    expect(r).toEqual([{ task_id: 't1', remind_at: '2026-09-09T11:00:00.000Z', label: null }]);
  });

  it('molde sem lembrete não gera nada', () => {
    expect(planejaLembretesDeInstancias('events', MOLDE, [], [{ id: 'v1', start_at: '2026-09-09T12:00:00.000Z' }])).toEqual([]);
  });

  it('âncora inválida não quebra', () => {
    expect(planejaLembretesDeInstancias('events', { start_at: 'lixo' }, UMA_HORA_ANTES, [{ id: 'v1', start_at: '2026-09-09T12:00:00.000Z' }])).toEqual([]);
    expect(planejaLembretesDeInstancias('events', MOLDE, UMA_HORA_ANTES, [{ id: 'v1', start_at: 'lixo' }])).toEqual([]);
  });
});
