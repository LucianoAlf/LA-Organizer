import { supabase } from './supabase';
import type { CalendarEvent } from '../types';

// Sprint 22.26 — events.category virou events.category_id (FK pra event_categories).
// JOIN traz a categoria sob a chave `category` (mesmo nome anterior, agora objeto).
// Sprint 22.30 — eisenhower_quadrant (priority) added.
const SELECT_COLS =
  'id, collaborator_id, title, description, context, category_id, start_at, end_at, modality, location_text, meeting_url, project_id, status, eisenhower_quadrant, remind_at, remind_sent_at, created_by, source, created_at, updated_at, projects(name), category:event_categories(id, collaborator_id, slug, label, context, icon, is_system, sort_order), event_reminders(remind_at, sent_at)';

/**
 * Events for a given local YMD (America/Sao_Paulo). Returns events whose
 * start_at falls within the day (in the SP timezone).
 *
 * Fix 2026-05-15: inclui owned + invited (event_participants). Antes, convites
 * de terceiros (ex: Juliana convidou Luciano) sumiam da Agenda do convidado.
 */
export async function fetchEventsForDay(collabId: string, ymd: string): Promise<CalendarEvent[]> {
  return fetchEventsOwnedOrInvited(collabId, `${ymd}T00:00:00-03:00`, `${ymd}T23:59:59-03:00`);
}

/** Events whose start_at falls between two YMDs inclusive (SP timezone). */
export async function fetchEventsForRange(
  collabId: string,
  ymdStart: string,
  ymdEnd: string,
): Promise<CalendarEvent[]> {
  return fetchEventsOwnedOrInvited(collabId, `${ymdStart}T00:00:00-03:00`, `${ymdEnd}T23:59:59-03:00`);
}

/**
 * Helper interno: une events.collaborator_id=user (owned) com event_participants
 * (invited, exceto declined), dedupe por event id, ordena por start_at.
 * Filtros aplicados em JS pra não precisar de RPC.
 */
async function fetchEventsOwnedOrInvited(
  collabId: string,
  startIso: string,
  endIso: string,
): Promise<CalendarEvent[]> {
  const [ownRes, partsRes] = await Promise.all([
    supabase
      .from('events')
      .select(SELECT_COLS)
      .eq('collaborator_id', collabId)
      // Sprint 29.1 — esconde teste/arquivado; Sprint 29.4 — esconde TEMPLATES
      .eq('data_classification', 'real')
      .or('recurrence_rule.is.null,recurrence_parent_id.not.is.null')
      .gte('start_at', startIso)
      .lte('start_at', endIso)
      .order('start_at', { ascending: true }),
    supabase
      .from('event_participants')
      .select(`event:events(${SELECT_COLS})`)
      .eq('collaborator_id', collabId)
      .neq('status', 'declined'),
  ]);
  if (ownRes.error) throw ownRes.error;
  if (partsRes.error) throw partsRes.error;
  const map = new Map<string, CalendarEvent>();
  for (const e of ((ownRes.data ?? []) as unknown as CalendarEvent[])) {
    map.set(e.id, e);
  }
  const lo = new Date(startIso).getTime();
  const hi = new Date(endIso).getTime();
  for (const row of ((partsRes.data ?? []) as unknown as Array<{ event: CalendarEvent | null }>)) {
    const e = row.event;
    if (!e || map.has(e.id)) continue;
    const t = new Date(e.start_at).getTime();
    if (t < lo || t > hi) continue;
    map.set(e.id, e);
  }
  return [...map.values()].sort((a, b) => String(a.start_at).localeCompare(String(b.start_at)));
}

/** "08:00–09:30" formatting from start/end ISO timestamps in America/Sao_Paulo. */
export function formatEventTimeRange(startIso: string, endIso: string): string {
  const fmt = new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  return `${fmt.format(new Date(startIso))}–${fmt.format(new Date(endIso))}`;
}

/**
 * Events do TIME inteiro num dia (SP). Sem filtro explícito por collaborator —
 * RLS é a única autoridade: coord/director recebe `context='work'` de qualquer
 * colaborador via `auth_read_work_events_coord`; collaborator comum só recebe
 * os próprios via `auth_read_own_events`.
 *
 * Uso: DashboardTime (coord-only) — resultado já vem agregado e filtrado.
 */
export async function fetchEventsForTeamDay(ymd: string, ctx: 'work' | 'personal' = 'work'): Promise<CalendarEvent[]> {
  const { data, error } = await supabase
    .from('events')
    .select(SELECT_COLS)
    .eq('context', ctx)
    .eq('data_classification', 'real')
    .or('recurrence_rule.is.null,recurrence_parent_id.not.is.null')
    .gte('start_at', `${ymd}T00:00:00-03:00`)
    .lte('start_at', `${ymd}T23:59:59-03:00`)
    .neq('status', 'cancelled')
    .order('start_at', { ascending: true });
  if (error) throw error;
  return (data ?? []) as unknown as CalendarEvent[];
}

/**
 * Events de UM colaborador num período. Usado pela Pessoa-Detalhe (coord
 * olhando o detalhe de um membro do time). RLS garante que só o próprio ou
 * coord/director consegue ver — call-site não precisa repetir o check.
 */
export async function fetchEventsForCollabRange(
  collabId: string,
  ymdStart: string,
  ymdEnd: string,
  ctx: 'work' | 'personal' = 'work',
): Promise<CalendarEvent[]> {
  const { data, error } = await supabase
    .from('events')
    .select(SELECT_COLS)
    .eq('collaborator_id', collabId)
    .eq('context', ctx)
    .eq('data_classification', 'real')
    .or('recurrence_rule.is.null,recurrence_parent_id.not.is.null')
    .gte('start_at', `${ymdStart}T00:00:00-03:00`)
    .lte('start_at', `${ymdEnd}T23:59:59-03:00`)
    .neq('status', 'cancelled')
    .order('start_at', { ascending: true });
  if (error) throw error;
  return (data ?? []) as unknown as CalendarEvent[];
}

/**
 * Sprint 22.42 — checa se ja existe evento ativo do colaborador que sobrepoe
 * a janela [startIso, endIso). Sobrepoe = (existente.start < novo.end) AND
 * (existente.end > novo.start). Retorna o primeiro conflito (titulo + horario)
 * ou null se livre. Quando excludeId passado, ignora esse id (caso de edicao).
 */
export async function findConflictingEvent(
  collabId: string,
  startIso: string,
  endIso: string,
  excludeId?: string,
): Promise<{ id: string; title: string; start_at: string; end_at: string } | null> {
  let query = supabase
    .from('events')
    .select('id, title, start_at, end_at')
    .eq('collaborator_id', collabId)
    .neq('status', 'cancelled')
    .lt('start_at', endIso)
    .gt('end_at', startIso)
    .order('start_at', { ascending: true })
    .limit(1);
  if (excludeId) query = query.neq('id', excludeId);
  const { data, error } = await query;
  if (error) throw error;
  return (data?.[0] ?? null) as { id: string; title: string; start_at: string; end_at: string } | null;
}

/** YYYY-MM-DD em SP a partir de um ISO timestamp. */
export function eventLocalYmd(iso: string): string {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return fmt.format(new Date(iso));
}
