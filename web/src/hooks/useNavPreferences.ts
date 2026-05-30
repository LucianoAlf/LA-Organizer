// Hook do bottom nav customizável (4 slots editáveis; "Mais" é client-side no BottomNav).
// SEGURANÇA: collaboratorId resolvido SEMPRE do useAuth; RLS owner-only valida via WITH CHECK.
// Tolerante a `collaborator` undefined no boot (enabled: !!collaborator).
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../contexts/AuthContext';
import { useAccess } from './useAccess';
import { supabase } from '../lib/supabase';
import {
  availableNavItems, resolveSlugs, DEFAULT_NAV_SLUGS,
  type NavGateContext, type NavCatalogItem,
} from '../lib/navItems';

const KEY = ['nav-prefs'] as const;

export function useNavPreferences() {
  const { collaborator, role } = useAuth();
  const { allowed: inventario }    = useAccess('inventario');
  const { allowed: loja_produtos } = useAccess('loja_produtos');

  // ⚠️ CORPO VERBATIM do SidebarV2:43-55. Mesma queryKey → cache compartilhado.
  // Se mudar lá, mudar AQUI também (sob pena de cache mentir).
  const { data: isMentor = false } = useQuery({
    queryKey: ['is-mentor', collaborator?.id],
    queryFn: async () => {
      if (!collaborator) return false;
      const { count } = await supabase
        .from('la_educa_estagiarios')
        .select('id', { count: 'exact', head: true })
        .eq('mentor_id', collaborator.id);
      return (count ?? 0) > 0;
    },
    enabled: !!collaborator,
  });

  const ctx: NavGateContext = {
    role: role ?? null,
    collaborator,
    access: { inventario, loja_produtos },
    isMentor: !!isMentor,
  };

  const prefsQ = useQuery({
    queryKey: [...KEY, collaborator?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('user_preferences')
        .select('bottom_nav_items')
        .eq('collaborator_id', collaborator!.id)
        .maybeSingle();
      if (error) throw error;
      return (data?.bottom_nav_items ?? [...DEFAULT_NAV_SLUGS]) as string[];
    },
    enabled: !!collaborator,
  });

  // SEMPRE 4 itens válidos (drop inválido + recomplete + dedup).
  const items: NavCatalogItem[] = resolveSlugs(prefsQ.data ?? [], ctx);
  const available: NavCatalogItem[] = availableNavItems(ctx);

  const qc = useQueryClient();
  const setMut = useMutation({
    mutationFn: async (slugs: string[]) => {
      if (!collaborator) throw new Error('Sem sessão');
      // upsert por collaborator_id (UNIQUE constraint user_preferences_collaborator_id_key).
      const { error } = await supabase
        .from('user_preferences')
        .upsert(
          { collaborator_id: collaborator.id, bottom_nav_items: slugs },
          { onConflict: 'collaborator_id' },
        );
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: [...KEY, collaborator?.id] }),
  });

  return {
    items,
    available,
    rawSlugs: prefsQ.data ?? [...DEFAULT_NAV_SLUGS],
    setSlugs: setMut.mutateAsync,
    saving: setMut.isPending,
    loading: prefsQ.isLoading,
  };
}
