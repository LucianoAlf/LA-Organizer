// Sprint 23 — useToggleItem: marca item de checklist (work ou personal)
// Upsert idempotente em op_checklist_item_completions ou personal_checklist_item_completions

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../../lib/supabase';

type Scope = 'work' | 'personal';

interface Params {
  scope: Scope;
  completionId: string;
  itemId: string;
  isChecked: boolean;
  notes?: string | null;
}

export function useToggleItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ scope, completionId, itemId, isChecked, notes }: Params) => {
      const table =
        scope === 'work'
          ? 'op_checklist_item_completions'
          : 'personal_checklist_item_completions';
      const payload: Record<string, unknown> = {
        completion_id: completionId,
        item_id: itemId,
        is_checked: isChecked,
        checked_at: isChecked ? new Date().toISOString() : null,
      };
      if (notes !== undefined) payload.notes = notes;
      if (scope === 'work') payload.channel = 'pwa';

      const { data, error } = await supabase
        .from(table)
        .upsert(payload, { onConflict: 'completion_id,item_id' })
        .select('id')
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['checklists-hoje'] });
      qc.invalidateQueries({ queryKey: ['checklists-kpi'] });
    },
  });
}
