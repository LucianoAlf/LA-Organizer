// web/src/hooks/useDelegableMembers.ts
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import {
  fetchGovernanceEdges, attachExplicitLeaders,
  fetchGroupLeaders, attachGroupLeaders,
} from '../lib/governance-edges';
import { delegableMembers } from '../lib/delegableMembers';
import type { Collab } from '../lib/team-routing';

export interface DelegableMember { id: string; full_name: string; role: string; }

export function useDelegableMembers(enabled: boolean) {
  const { collaborator } = useAuth();
  return useQuery({
    queryKey: ['delegable-members', collaborator?.id],
    enabled: enabled && Boolean(collaborator?.id),
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<DelegableMember[]> => {
      const { data, error } = await supabase
        .from('collaborators')
        .select('id, full_name, role, function_role, unit, supervisor_id, is_ceo, is_active')
        .eq('is_active', true);
      if (error) throw error;
      const collabs = (data ?? []) as unknown as (Collab & { full_name: string })[];
      const [edges, groupLeaders] = await Promise.all([fetchGovernanceEdges(), fetchGroupLeaders()]);
      attachExplicitLeaders(collabs, edges);
      attachGroupLeaders(collabs, groupLeaders);
      const me = collaborator!;
      const team = delegableMembers(me.id, me.role, collabs) as (Collab & { full_name: string })[];
      return team
        .map(c => ({ id: c.id, full_name: c.full_name, role: c.role }))
        .sort((a, b) => a.full_name.localeCompare(b.full_name));
    },
  });
}
