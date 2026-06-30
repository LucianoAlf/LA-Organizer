// web/src/hooks/useActiveCollaborators.ts
// Fonte do picker "Em cópia": QUALQUER colaborador ativo (distinto de delegableMembers,
// que restringe não-diretores à equipe). Pôr alguém em cópia não é atribuir trabalho.
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';

export interface ActiveCollab { id: string; full_name: string; role: string; }

export function useActiveCollaborators(enabled: boolean) {
  return useQuery({
    queryKey: ['active-collaborators'],
    enabled,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<ActiveCollab[]> => {
      const { data, error } = await supabase
        .from('collaborators')
        .select('id, full_name, role')
        .eq('is_active', true)
        .order('full_name', { ascending: true });
      if (error) throw error;
      return (data ?? []) as ActiveCollab[];
    },
  });
}
