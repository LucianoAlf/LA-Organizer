// web/src/lib/governance-edges.ts
// Arestas da matriz de governança (override manual N:N). Fetch/attach pro roteamento
// + CRUD (director-only via RLS) pra UI da Gestão equipe.
import { supabase } from './supabase';
import { groupLeaderIdsFor, type GroupLeader, type Collab } from './team-routing';

export interface GovEdge { member_id: string; leader_id: string; }

export async function fetchGovernanceEdges(): Promise<GovEdge[]> {
  const { data } = await supabase.from('governance_edges').select('member_id, leader_id');
  return (data ?? []) as GovEdge[];
}

/** Anexa explicit_leader_ids a cada collab (mutação in-place + retorno). */
export function attachExplicitLeaders<T extends { id: string; explicit_leader_ids?: string[] }>(
  collabs: T[], edges: GovEdge[],
): T[] {
  const byMember = new Map<string, string[]>();
  for (const e of edges) {
    const arr = byMember.get(e.member_id) ?? [];
    arr.push(e.leader_id);
    byMember.set(e.member_id, arr);
  }
  for (const c of collabs) c.explicit_leader_ids = byMember.get(c.id) ?? [];
  return collabs;
}

export async function addGovernanceEdge(memberId: string, leaderId: string): Promise<void> {
  const { error } = await supabase.from('governance_edges').insert({ member_id: memberId, leader_id: leaderId });
  if (error) throw error;
}

export async function removeGovernanceEdge(memberId: string, leaderId: string): Promise<void> {
  const { error } = await supabase.from('governance_edges')
    .delete().eq('member_id', memberId).eq('leader_id', leaderId);
  if (error) throw error;
}

export async function fetchGroupLeaders(): Promise<GroupLeader[]> {
  const { data } = await supabase.from('governance_leaders').select('group_key, unit, leader_id');
  return (data ?? []) as GroupLeader[];
}

/** Anexa group_leader_ids (líder do grupo via tabela governance_leaders) a cada collab. */
export function attachGroupLeaders<T extends Collab>(collabs: T[], groupLeaders: GroupLeader[]): T[] {
  for (const c of collabs) c.group_leader_ids = groupLeaderIdsFor(c, groupLeaders);
  return collabs;
}

export async function addGroupLeader(groupKey: string, unit: string, leaderId: string): Promise<void> {
  const { error } = await supabase.from('governance_leaders').insert({ group_key: groupKey, unit, leader_id: leaderId });
  if (error) throw error;
}

export async function removeGroupLeader(groupKey: string, unit: string, leaderId: string): Promise<void> {
  const { error } = await supabase.from('governance_leaders')
    .delete().eq('group_key', groupKey).eq('unit', unit).eq('leader_id', leaderId);
  if (error) throw error;
}
