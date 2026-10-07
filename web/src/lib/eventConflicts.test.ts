// CONFLITO-SO-DO-DONO (Alf 06/10): linhas REAIS do banco — Reunião (dele) × Jornada (do Quintela,
// Alf participante confirmado).
import { describe, it, expect } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { overlaps, mergeOwnedAndParticipating, findOverlappingCommitments } from './eventConflicts';

const ALF = '0576f4b6-183d-4cf1-980e-5c8d5da0177f';
const JORNADA = {
  id: '41a6e5af-1de6-4ae1-be11-f041a2af412d', title: 'Jornada de Cordas',
  start_at: '2026-10-07T16:00:00+00:00', end_at: '2026-10-07T20:00:00+00:00',
  status: 'scheduled', collaborator_id: 'bfd77b2c-3303-47fe-abe1-e73a2d8da0e1',
};
const REUNIAO = {
  id: 'e9d192a4-06dc-4ed6-acf4-a92c4f453b50', title: 'Reuniao semana da crianças',
  start_at: '2026-10-07T18:30:00+00:00', end_at: '2026-10-07T19:30:00+00:00',
  status: 'scheduled', collaborator_id: ALF,
};

// Client falso: grava a cadeia de cada consulta e devolve o que a tabela "tem".
function fakeClient(byTable: Record<string, unknown[]>) {
  const calls: Array<{ table: string; ops: unknown[][] }> = [];
  const client = {
    from(table: string) {
      const q = { table, ops: [] as unknown[][] };
      calls.push(q);
      const chain: unknown = new Proxy({}, {
        get(_t, op) {
          if (op === 'then') {
            return (res: (v: unknown) => unknown) => res({ data: byTable[table] ?? [], error: null });
          }
          return (...args: unknown[]) => { q.ops.push([op, ...args]); return chain; };
        },
      });
      return chain;
    },
  };
  return { client: client as unknown as SupabaseClient, calls };
}

describe('overlaps', () => {
  it('caso real: a reunião cai dentro da Jornada', () => {
    expect(overlaps(REUNIAO, JORNADA)).toBe(true);
  });
  it('encostar não é conflito', () => {
    expect(overlaps(
      { start_at: '2026-10-07T12:00:00Z', end_at: '2026-10-07T13:00:00Z' },
      { start_at: '2026-10-07T13:00:00Z', end_at: '2026-10-07T14:00:00Z' },
    )).toBe(false);
  });
});

describe('mergeOwnedAndParticipating', () => {
  it('participação conta; recusa e cancelado não; sem duplicar', () => {
    const r = mergeOwnedAndParticipating([REUNIAO], [{ status: 'confirmed', event: JORNADA }]);
    expect(r.map(e => e.id)).toEqual([JORNADA.id, REUNIAO.id]);
    expect(r[0].viaParticipation).toBe(true);
    expect(mergeOwnedAndParticipating([], [{ status: 'declined', event: JORNADA }])).toEqual([]);
    expect(mergeOwnedAndParticipating([], [{ status: 'confirmed', event: { ...JORNADA, status: 'cancelled' } }])).toEqual([]);
    expect(mergeOwnedAndParticipating([JORNADA], [{ status: 'confirmed', event: JORNADA }])).toHaveLength(1);
  });
});

describe('findOverlappingCommitments', () => {
  it('caso real: criar a reunião acha a Jornada pela participação', async () => {
    const { client, calls } = fakeClient({ events: [], event_participants: [{ status: 'confirmed', event: JORNADA }] });
    const r = await findOverlappingCommitments(client, ALF, '2026-10-07T15:30:00-03:00', '2026-10-07T16:30:00-03:00');
    expect(r.map(e => e.title)).toEqual(['Jornada de Cordas']);
    expect(calls.map(c => c.table).sort()).toEqual(['event_participants', 'events']);
    const part = calls.find(c => c.table === 'event_participants')!;
    expect(part.ops).toContainEqual(['eq', 'collaborator_id', ALF]);
    expect(part.ops).toContainEqual(['neq', 'status', 'declined']);
    expect(part.ops.some(o => o[0] === 'lt' && o[1] === 'event.start_at')).toBe(true);
  });
  it('excludeId tira o próprio evento (edição)', async () => {
    const { client } = fakeClient({ events: [REUNIAO], event_participants: [{ status: 'confirmed', event: JORNADA }] });
    const r = await findOverlappingCommitments(client, ALF, REUNIAO.start_at, REUNIAO.end_at, { excludeId: REUNIAO.id });
    expect(r.map(e => e.id)).toEqual([JORNADA.id]);
  });
});
