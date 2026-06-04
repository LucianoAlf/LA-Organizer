// Subscribe nas tabelas pf_* da tela ativa. Cleanup ao desmontar.
// Invalida apenas queries do escopo financeiro pra não rebuscar o resto do app.
// Molde: useRealtimeSync.ts (PWA).
import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';

export type PfTable = 'pf_transactions' | 'pf_bills' | 'pf_goals' | 'pf_accounts' | 'pf_budgets'
  | 'pf_cards' | 'pf_card_payments' | 'pf_transfers' | 'pf_goal_contributions' | 'pf_categories';

export function useRealtimeFinance(tables: PfTable[], collaboratorId: string | undefined) {
  const qc = useQueryClient();
  const tablesKey = tables.join(',');
  useEffect(() => {
    if (!collaboratorId || tables.length === 0) return;
    const channel = supabase.channel(`pf-${collaboratorId}-${tablesKey}`);
    for (const table of tables) {
      channel.on(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        'postgres_changes' as any,
        { event: '*', schema: 'public', table, filter: `collaborator_id=eq.${collaboratorId}` },
        () => qc.invalidateQueries({ queryKey: ['financeiro'] }),
      );
    }
    channel.subscribe((status) => {
      if (import.meta.env.DEV) console.debug('[rt-pf]', status, tablesKey);
    });
    return () => { supabase.removeChannel(channel); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collaboratorId, tablesKey, qc]);
}
