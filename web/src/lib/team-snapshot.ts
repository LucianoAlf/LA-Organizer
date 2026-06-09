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
import { resolveScope } from './team-scope';
import { fetchGovernanceEdges, attachExplicitLeaders, fetchGroupLeaders, attachGroupLeaders } from './governance-edges';
import { governanceViewerIdsOf } from './team-routing';
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
  explicit_leader_ids?: string[];
  group_leader_ids?: string[];
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
  // Fase 3 — multi-tenant: escopo do viewer.
  scope: 'company' | 'team';
  isCeo: boolean;
  viewerId: string;
  memberIds: string[];
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
  attachExplicitLeaders(allCollabs, await fetchGovernanceEdges());
  attachGroupLeaders(allCollabs, await fetchGroupLeaders());

  // Escopo do viewer (Fase 3): CEO = empresa inteira; líder = só o time dele.
  const scope = resolveScope(myId, allCollabs);
  const isCeo = scope.mode === 'ceo';
  const memberSet = new Set(scope.memberIds);
  const team = isCeo
    ? allCollabs.filter(c => c.id !== myId)
    : allCollabs.filter(c => memberSet.has(c.id));
  // scopeIds: null = sem filtro (CEO); [] = ninguém (líder sem time); [...] = time.
  const scopeIds = scope.scopeIds;

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

  let completedQ = supabase
    .from('tasks').select('id', { count: 'exact', head: true })
    .eq('context', 'work').eq('status', 'done')
    .gte('completed_at', todayStart).lte('completed_at', todayEnd);
  if (scopeIds) completedQ = completedQ.in('assigned_to', scopeIds);
  const { count: completedToday = 0 } = await completedQ;

  let dueQ = supabase
    .from('tasks').select('id', { count: 'exact', head: true })
    .eq('context', 'work').eq('due_date', today)
    .not('status', 'in', '(done,cancelled)');
  if (scopeIds) dueQ = dueQ.in('assigned_to', scopeIds);
  const { count: dueToday = 0 } = await dueQ;

  let overdueQ = supabase
    .from('tasks')
    .select('id, title, assigned_to, due_date, governance_owner_id')
    .eq('context', 'work')
    .lt('due_date', today)
    .not('status', 'in', '(done,cancelled)')
    .order('due_date', { ascending: true })
    .limit(1000);
  if (scopeIds) overdueQ = overdueQ.in('assigned_to', scopeIds);
  const { data: overdueRaw } = await overdueQ;

  // Honestidade (Fase 1): tira inativo, colapsa recorrência, conta distinto.
  const activeIds = new Set(allCollabs.map(c => c.id));
  const overdueActive = filterActiveAssignees((overdueRaw ?? []) as OverdueRow[], activeIds);
  const dedupedOverdue = dedupeRecurringOverdue(overdueActive);

  // Fase 3 (Governança PWA): CEO vê tudo; líder vê só as tarefas cuja posse o inclui.
  const scopedOverdue = isCeo
    ? dedupedOverdue
    : dedupedOverdue.filter((t) =>
        governanceViewerIdsOf(
          { governance_owner_id: (t as any).governance_owner_id ?? null, assigned_to: t.assigned_to },
          allCollabs.find((c) => c.id === t.assigned_to),
          allCollabs,
        ).includes(myId),
      );

  const allEvents = await fetchEventsForTeamDay(today, 'work');
  // Líder vê só os eventos do time dele; CEO vê todos.
  const events = isCeo
    ? allEvents
    : allEvents.filter(e => e.collaborator_id != null && memberSet.has(e.collaborator_id));
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
    overdueCount: countDistinctOverdue(scopedOverdue),
    overdueByPerson: computeOverdueByPerson(scopedOverdue),
    events,
    eventsByCollab,
    scope: isCeo ? 'company' : 'team',
    isCeo,
    viewerId: myId,
    memberIds: scope.memberIds,
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
