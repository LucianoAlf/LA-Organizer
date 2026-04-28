import { supabase } from './supabase';
import type { CalendarEvent } from '../types';

const SELECT_COLS =
  'id, collaborator_id, title, description, context, category, start_at, end_at, modality, location_text, meeting_url, project_id, status, created_by, source, created_at, updated_at, projects(name)';

/**
 * Events for a given local YMD (America/Sao_Paulo). Returns events whose
 * start_at falls within the day (in the SP timezone).
 */
export async function fetchEventsForDay(collabId: string, ymd: string): Promise<CalendarEvent[]> {
  const dayStart = `${ymd}T00:00:00-03:00`;
  const dayEnd = `${ymd}T23:59:59-03:00`;
  const { data, error } = await supabase
    .from('events')
    .select(SELECT_COLS)
    .eq('collaborator_id', collabId)
    .gte('start_at', dayStart)
    .lte('start_at', dayEnd)
    .order('start_at', { ascending: true });
  if (error) throw error;
  return (data ?? []) as unknown as CalendarEvent[];
}

/** Events whose start_at falls between two YMDs inclusive (SP timezone). */
export async function fetchEventsForRange(
  collabId: string,
  ymdStart: string,
  ymdEnd: string,
): Promise<CalendarEvent[]> {
  const { data, error } = await supabase
    .from('events')
    .select(SELECT_COLS)
    .eq('collaborator_id', collabId)
    .gte('start_at', `${ymdStart}T00:00:00-03:00`)
    .lte('start_at', `${ymdEnd}T23:59:59-03:00`)
    .order('start_at', { ascending: true });
  if (error) throw error;
  return (data ?? []) as unknown as CalendarEvent[];
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
    .gte('start_at', `${ymdStart}T00:00:00-03:00`)
    .lte('start_at', `${ymdEnd}T23:59:59-03:00`)
    .neq('status', 'cancelled')
    .order('start_at', { ascending: true });
  if (error) throw error;
  return (data ?? []) as unknown as CalendarEvent[];
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
