// CONFIRMACAO-DE-EVENTO no app, caminhos de EDIÇÃO (07/10). A criação já parava por conflito
// (dono ∪ participante, 941e7ff7) e por início no passado (0720b3e5); editar/arrastar um
// compromisso pra cima da Jornada de Cordas — ou pra ontem — salvava calado. Mesma regra, uma
// função: só olha o que MUDOU (mexer no título de um evento de ontem não pergunta "já passou"),
// e o próprio evento não é conflito dele mesmo. Falha da consulta de conflito não trava (fail-open,
// como na criação).
import type { ConflictEvent } from './eventConflicts';
import { isStartInPast, pastStartLabel } from './eventStartGuard';

export interface TimeWarnings {
  /** "05/10 09:00" quando o NOVO início já passou; null = ok. */
  past: string | null;
  conflicts: ConflictEvent[];
}

export type ConflictFinder = (startIso: string, endIso: string, excludeId?: string) => Promise<ConflictEvent[]>;

export function hasWarnings(w: TimeWarnings | null | undefined): boolean {
  return Boolean(w && (w.past || w.conflicts.length > 0));
}

export async function preflightEventTime(
  find: ConflictFinder,
  args: {
    startIso: string;
    endIso: string;
    excludeId?: string;
    /** início mudou? (só então pergunta "já passou") */
    startChanged: boolean;
    /** início OU fim mudou? (só então checa conflito) */
    timeChanged: boolean;
    nowMs?: number;
  },
): Promise<TimeWarnings> {
  const past = args.startChanged && isStartInPast(args.startIso, args.nowMs ?? Date.now())
    ? pastStartLabel(args.startIso)
    : null;
  let conflicts: ConflictEvent[] = [];
  if (args.timeChanged) {
    try {
      conflicts = (await find(args.startIso, args.endIso, args.excludeId))
        .filter(c => c.id !== args.excludeId);
    } catch {
      conflicts = [];
    }
  }
  return { past, conflicts };
}

const HHMM = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', hour12: false });
export const conflictRange = (c: { start_at: string; end_at: string }) =>
  `${HHMM.format(new Date(c.start_at))}–${HHMM.format(new Date(c.end_at))}`;

/** Texto curto pra confirmação nativa (arrastar/redimensionar na grade, sem formulário). */
export function warningsText(w: TimeWarnings): string {
  const lines: string[] = [];
  if (w.past) lines.push(`Esse horário já passou (${w.past}).`);
  for (const c of w.conflicts.slice(0, 3)) lines.push(`Bate com "${c.title}" (${conflictRange(c)}).`);
  return lines.join('\n');
}
