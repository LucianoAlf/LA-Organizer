// CONFIRMACAO-DE-EVENTO (edição, 07/10): linhas REAIS — Mentoria Levi (Alf) arrastada pra dentro
// da Jornada de Cordas (Quintela, Alf participante).
import { describe, it, expect } from 'vitest';
import { preflightEventTime, hasWarnings, warningsText } from './eventPreflight';
import type { ConflictEvent } from './eventConflicts';

const JORNADA: ConflictEvent = {
  id: '41a6e5af-1de6-4ae1-be11-f041a2af412d', title: 'Jornada de Cordas',
  start_at: '2026-10-07T16:00:00+00:00', end_at: '2026-10-07T20:00:00+00:00', viaParticipation: true,
};
const MENTORIA_ID = 'd898903f-0c00-4bc1-8bed-2f75fbdb7cc3';
const AGORA = Date.parse('2026-10-07T11:00:00Z'); // 07/10 08:00 BRT

describe('preflightEventTime', () => {
  it('mover a Mentoria pra 14:00 acusa a Jornada; o próprio evento é excluído', async () => {
    let excl: string | undefined;
    const find = async (_s: string, _e: string, ex?: string) => { excl = ex; return [JORNADA, { ...JORNADA, id: MENTORIA_ID, title: 'Mentoria Levi' }]; };
    const w = await preflightEventTime(find, {
      startIso: '2026-10-07T14:00:00-03:00', endIso: '2026-10-07T15:00:00-03:00',
      excludeId: MENTORIA_ID, startChanged: true, timeChanged: true, nowMs: AGORA,
    });
    expect(excl).toBe(MENTORIA_ID);
    expect(w.past).toBeNull();
    expect(w.conflicts.map(c => c.title)).toEqual(['Jornada de Cordas']);
    expect(hasWarnings(w)).toBe(true);
    expect(warningsText(w)).toBe('Bate com "Jornada de Cordas" (13:00–17:00).');
  });

  it('mover pra 05/10 09:00 pergunta "já passou"', async () => {
    const w = await preflightEventTime(async () => [], {
      startIso: '2026-10-05T09:00:00-03:00', endIso: '2026-10-05T10:00:00-03:00',
      excludeId: MENTORIA_ID, startChanged: true, timeChanged: true, nowMs: AGORA,
    });
    expect(w.past).toBe('05/10 09:00');
    expect(warningsText(w)).toBe('Esse horário já passou (05/10 09:00).');
  });

  it('sem mudança de horário: não pergunta nada (editar título de evento passado)', async () => {
    let chamou = false;
    const w = await preflightEventTime(async () => { chamou = true; return [JORNADA]; }, {
      startIso: '2026-10-05T09:00:00-03:00', endIso: '2026-10-05T10:00:00-03:00',
      startChanged: false, timeChanged: false, nowMs: AGORA,
    });
    expect(chamou).toBe(false);
    expect(hasWarnings(w)).toBe(false);
  });

  it('consulta falhou: segue sem conflito (fail-open)', async () => {
    const w = await preflightEventTime(async () => { throw new Error('rede'); }, {
      startIso: '2026-10-07T14:00:00-03:00', endIso: '2026-10-07T15:00:00-03:00',
      startChanged: true, timeChanged: true, nowMs: AGORA,
    });
    expect(w.conflicts).toEqual([]);
  });
});
