// CONFLITO-SO-DO-DONO (Alf 06/10 17:52 BRT): ele criou pelo app "Reuniao semana da crianças"
// 07/10 15:30–16:30 por cima de "Jornada de Cordas" 07/10 13:00–17:00 — evento do Quintela em
// que o Alf é participante confirmado — e o banner de conflito não apareceu. O checador do
// QuickCreateSheet (e o findConflictingEvent, Sprint 22.42) perguntava só
// `collaborator_id = eu`, enquanto a Agenda que ele VÊ (fetchEventsOwnedOrInvited, fix 15/05)
// já mostra dono ∪ convidado. Checador menor que a agenda mostrada = conflito invisível.
//
// Definição ÚNICA do lado do app (gêmea de src/lib/agenda-conflitos.js do TOM — mudam juntas):
//   conflito = evento que sou DONO (status ≠ cancelled)
//            ∪ evento em que estou em event_participants com status ≠ declined (evento ≠ cancelled)
//   que sobrepõe a janela (início < fim E fim > início; encostar não conta).
// Puro + consulta recebendo o client (testável sem rede); events.ts amarra o client real.
import type { SupabaseClient } from '@supabase/supabase-js';

export interface ConflictEvent {
  id: string;
  title: string;
  start_at: string;
  end_at: string;
  status?: string | null;
  collaborator_id?: string | null;
  /** true quando o evento entrou só pela participação (não sou o dono). */
  viaParticipation?: boolean;
}

interface ParticipationRow {
  status?: string | null;
  event: ConflictEvent | ConflictEvent[] | null;
}

function ms(iso: string): number {
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? t : NaN;
}

/** Sobreposição estrita — 13:00–14:00 e 14:00–15:00 só encostam. */
export function overlaps(
  a: { start_at: string; end_at: string },
  b: { start_at: string; end_at: string },
): boolean {
  const as = ms(a.start_at), ae = ms(a.end_at), bs = ms(b.start_at), be = ms(b.end_at);
  if (![as, ae, bs, be].every(Number.isFinite)) return false;
  return as < be && ae > bs;
}

/** Dono ∪ participação (sem recusa), sem cancelado, uma vez por id, ordenado por início. */
export function mergeOwnedAndParticipating(
  owned: ConflictEvent[] | null | undefined,
  participations: ParticipationRow[] | null | undefined,
): ConflictEvent[] {
  const map = new Map<string, ConflictEvent>();
  for (const e of owned ?? []) {
    if (e?.id && e.status !== 'cancelled') map.set(e.id, e);
  }
  for (const p of participations ?? []) {
    if (!p || p.status === 'declined') continue;
    // o embed pode vir como objeto ou array de 1 (tipagem do supabase-js)
    const e = Array.isArray(p.event) ? p.event[0] : p.event;
    if (!e?.id || e.status === 'cancelled' || map.has(e.id)) continue;
    map.set(e.id, { ...e, viaParticipation: true });
  }
  return [...map.values()].sort((x, y) => String(x.start_at).localeCompare(String(y.start_at)));
}

const COLS = 'id, title, start_at, end_at, status, collaborator_id';

/**
 * Compromissos meus (dono ∪ participante) que sobrepõem [startIso, endIso).
 * `excludeId` tira o próprio evento (edição). Erro de consulta sobe.
 */
export async function findOverlappingCommitments(
  client: SupabaseClient,
  collabId: string,
  startIso: string,
  endIso: string,
  opts: { excludeId?: string; limit?: number } = {},
): Promise<ConflictEvent[]> {
  const limit = opts.limit ?? 10;
  const [own, parts] = await Promise.all([
    client.from('events').select(COLS)
      .eq('collaborator_id', collabId)
      .neq('status', 'cancelled')
      .lt('start_at', endIso)
      .gt('end_at', startIso)
      .limit(limit),
    client.from('event_participants').select(`status, event:events!inner(${COLS})`)
      .eq('collaborator_id', collabId)
      .neq('status', 'declined')
      .neq('event.status', 'cancelled')
      .lt('event.start_at', endIso)
      .gt('event.end_at', startIso)
      .limit(limit),
  ]);
  if (own.error) throw own.error;
  if (parts.error) throw parts.error;
  const window = { start_at: startIso, end_at: endIso };
  return mergeOwnedAndParticipating(
    own.data as unknown as ConflictEvent[],
    parts.data as unknown as ParticipationRow[],
  ).filter(e => e.id !== opts.excludeId && overlaps(e, window));
}
