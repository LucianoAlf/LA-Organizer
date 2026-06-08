// web/src/lib/team-snapshot.ts
// Snapshot do time (KPIs honestos + briefing + atrasos + eventos do dia).
// Extraído de DashboardTime.tsx (Fase 2) pra compartilhar Mobile/Desktop.
// allCollabs traz os campos de liderança (function_role/unit/supervisor_id/is_ceo)
// pra alimentar lib/team-routing (semáforo + drill do CEO desktop).
import { supabase } from './supabase';
import { todaySP } from '../utils/date';
import { fetchEventsForTeamDay } from './events';
import {
  dedupeRecurringOverdue, filterActiveAssignees, countDistinctOverdue,
  overdueByPerson as computeOverdueByPerson, type OverdueRow,
} from './governance-metrics';
import type { CalendarEvent } from '../types';

export interface TeamCollab {
  id: string;
  full_name: string;
  preferred_name: string | null;
  role: string;
  function_role: string | null;
  unit: string | null;
  supervisor_id: string | null;
  is_ceo: boolean;
  is_active?: boolean;
}

export interface TeamSnapshot {
  team: TeamCollab[];
  allCollabs: TeamCollab[];
  responded: string[];
  noResponse: string[];
  completedToday: number;
  dueToday: number;
  overdueCount: number;
  overdueByPerson: Array<{ assigned_to: string; count: number }>;
  events: CalendarEvent[];
  eventsByCollab: Record<string, number>;
}

const COLLAB_COLS = 'id, full_name, preferred_name, role, function_role, unit, supervisor_id, is_ceo, is_active';

export async function fetchTeamSnapshot(myId: string): Promise<TeamSnapshot> {
  const today = todaySP();
  const { data: teamRaw } = await supabase
    .from('collaborators')
    .select(COLLAB_COLS)
    .eq('is_active', true)
    .eq('onboarding_completed', true);
  const allCollabs = (teamRaw ?? []) as unknown as TeamCollab[];
  const team = allCollabs.filter(c => c.id !== myId);

  const { data: briefings } = await supabase
    .from('ritual_logs')
    .select('collaborator_id, sent_at')
    .eq('reference_date', today)
    .eq('ritual_type', 'daily_briefing')
    .eq('status', 'sent');

  // Privacidade: contagem via SECURITY DEFINER (coord/dir não leem conversation_history.content).
  const responded: string[] = [];
  const noResponse: string[] = [];
  for (const c of team) {
    const b = (briefings ?? []).find(x => x.collaborator_id === c.id);
    if (!b) continue;
    const { data: countResult, error: rpcErr } = await supabase
      .rpc('briefing_response_count', { collab_id: c.id, since: b.sent_at });
    if (rpcErr) { console.warn('briefing_response_count err', rpcErr.message); continue; }
    const n = (countResult as number | null) ?? 0;
    if (n > 0) responded.push(c.id); else noResponse.push(c.id);
  }

  const todayStart = today + 'T00:00:00-03:00';
  const todayEnd = today + 'T23:59:59-03:00';
  const { count: completedToday = 0 } = await supabase
    .from('tasks').select('id', { count: 'exact', head: true })
    .eq('context', 'work').eq('status', 'done')
    .gte('completed_at', todayStart).lte('completed_at', todayEnd);
  const { count: dueToday = 0 } = await supabase
    .from('tasks').select('id', { count: 'exact', head: true })
    .eq('context', 'work').eq('due_date', today)
    .not('status', 'in', '(done,cancelled)');

  const { data: overdueRaw } = await supabase
    .from('tasks')
    .select('id, title, assigned_to, due_date')
    .eq('context', 'work')
    .lt('due_date', today)
    .not('status', 'in', '(done,cancelled)')
    .order('due_date', { ascending: true })
    .limit(1000);

  // Honestidade (Fase 1): tira inativo, colapsa recorrência, conta distinto.
  const activeIds = new Set(allCollabs.map(c => c.id));
  const overdueActive = filterActiveAssignees((overdueRaw ?? []) as OverdueRow[], activeIds);
  const dedupedOverdue = dedupeRecurringOverdue(overdueActive);

  const events = await fetchEventsForTeamDay(today, 'work');
  const eventsByCollab: Record<string, number> = {};
  for (const e of events) {
    if (!e.collaborator_id) continue;
    eventsByCollab[e.collaborator_id] = (eventsByCollab[e.collaborator_id] ?? 0) + 1;
  }

  return {
    team,
    allCollabs,
    responded,
    noResponse,
    completedToday: completedToday ?? 0,
    dueToday: dueToday ?? 0,
    overdueCount: countDistinctOverdue(dedupedOverdue),
    overdueByPerson: computeOverdueByPerson(dedupedOverdue),
    events,
    eventsByCollab,
  };
}

/** Resolve o colaborador logado (via email do JWT) e busca o snapshot. */
export async function fetchMyTeamSnapshot(): Promise<TeamSnapshot> {
  const { data: me } = await supabase.auth.getUser();
  if (!me?.user?.email) throw new Error('Sem sessão');
  const { data: collab } = await supabase
    .from('collaborators').select('id').eq('email', me.user.email).maybeSingle();
  if (!collab) throw new Error('Sem colaborador');
  return fetchTeamSnapshot(collab.id);
}
