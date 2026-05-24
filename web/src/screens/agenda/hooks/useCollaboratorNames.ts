// Resolve UUID → primeiro nome do colaborador. Usado pra exibir "→ Luciano"
// na CompactTaskRow quando task.delegated_to está preenchido.
//
// Cache de 5min porque colaboradores raramente mudam de nome no meio do dia.

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase, supabaseConfigured } from '../../../lib/supabase';

export interface CollaboratorNamesMap {
  /** Retorna apenas o primeiro nome (ex.: "Luciano"). */
  firstName(id: string | null | undefined): string | null;
  /** Retorna nome completo. */
  fullName(id: string | null | undefined): string | null;
}

export function useCollaboratorNames(): CollaboratorNamesMap {
  const { data } = useQuery({
    queryKey: ['collaborator-names'],
    enabled: supabaseConfigured,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('collaborators')
        .select('id, full_name')
        .eq('is_active', true);
      if (error) throw error;
      return (data ?? []) as Array<{ id: string; full_name: string }>;
    },
  });

  return useMemo(() => {
    const byId = new Map<string, string>();
    for (const c of data ?? []) byId.set(c.id, c.full_name);
    return {
      firstName(id) {
        if (!id) return null;
        const full = byId.get(id);
        if (!full) return null;
        return full.split(' ')[0] || full;
      },
      fullName(id) {
        if (!id) return null;
        return byId.get(id) ?? null;
      },
    };
  }, [data]);
}
