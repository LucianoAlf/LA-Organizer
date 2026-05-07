// Sprint 22.23 (refactor) — extraido de screens/ProjetoDetalhe.tsx.
// Query + CRUD + reorder de project_contingencies. Mutations otimistas onde aplicavel.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase, supabaseConfigured } from '../lib/supabase';
import type { Contingency } from '../types/projectDetail';

async function fetchContingencies(projectId: string): Promise<Contingency[]> {
  const { data, error } = await supabase
    .from('project_contingencies')
    .select('id, project_id, scenario, protocol, position')
    .eq('project_id', projectId)
    .order('position', { ascending: true })
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data ?? []) as Contingency[];
}

export interface UseProjectContingenciesResult {
  contingencies: Contingency[];
  create: (input: { scenario: string; protocol: string }) => void;
  update: (input: { id: string; scenario: string; protocol: string }) => void;
  remove: (ctId: string) => void;
  reorder: (orderedIds: string[]) => void;
}

export function useProjectContingencies(projectId: string): UseProjectContingenciesResult {
  const qc = useQueryClient();
  const queryKey = ['project', projectId, 'contingencies'] as const;

  const { data: contingencies = [] } = useQuery({
    queryKey,
    queryFn: () => fetchContingencies(projectId),
    enabled: Boolean(projectId && supabaseConfigured),
  });

  const createMut = useMutation({
    mutationFn: async ({ scenario, protocol }: { scenario: string; protocol: string }) => {
      const maxPos = contingencies.reduce((m, c) => Math.max(m, c.position ?? 0), -1);
      const { error } = await supabase.from('project_contingencies').insert({
        project_id: projectId,
        scenario: scenario.slice(0, 500),
        protocol: protocol.slice(0, 2000),
        position: maxPos + 1,
      });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey }),
  });

  const updateMut = useMutation({
    mutationFn: async ({ id: ctId, scenario, protocol }: { id: string; scenario: string; protocol: string }) => {
      const { error } = await supabase.from('project_contingencies')
        .update({ scenario: scenario.slice(0, 500), protocol: protocol.slice(0, 2000) })
        .eq('id', ctId);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey }),
  });

  const deleteMut = useMutation({
    mutationFn: async (ctId: string) => {
      const { error } = await supabase.from('project_contingencies').delete().eq('id', ctId);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey }),
  });

  // Sprint 22.22r — reorder otimista.
  const reorderMut = useMutation({
    mutationFn: async (orderedIds: string[]) => {
      await Promise.all(
        orderedIds.map((ctId, idx) =>
          supabase.from('project_contingencies').update({ position: idx }).eq('id', ctId).then(({ error }) => {
            if (error) throw error;
          }),
        ),
      );
    },
    onMutate: async (orderedIds) => {
      await qc.cancelQueries({ queryKey });
      const prev = qc.getQueryData<Contingency[]>(queryKey);
      qc.setQueryData<Contingency[]>(queryKey, (old) => {
        if (!old) return old;
        const map = new Map(old.map(c => [c.id, c]));
        return orderedIds.map((cId, idx) => ({ ...(map.get(cId)!), position: idx } as Contingency));
      });
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(queryKey, ctx.prev);
    },
    onSettled: () => qc.invalidateQueries({ queryKey }),
  });

  return {
    contingencies,
    create: (input) => createMut.mutate(input),
    update: (input) => updateMut.mutate(input),
    remove: (ctId) => deleteMut.mutate(ctId),
    reorder: (orderedIds) => reorderMut.mutate(orderedIds),
  };
}
