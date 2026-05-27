// Sprint 23 — useToggleItem: marca item de checklist
// - work: upsert em op_checklist_item_completions
// - personal: update direto em personal_checklist_items.is_done (schema atual)

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../../lib/supabase';

type Scope = 'work' | 'personal';

interface Params {
  scope: Scope;
  completionId: string; // pra work é op_checklist_completions.id; pra personal é o próprio checklist_id (não usado direto, mantido por compat)
  itemId: string;
  isChecked: boolean;
  notes?: string | null;
}

export function useToggleItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ scope, completionId, itemId, isChecked, notes }: Params) => {
      if (scope === 'work') {
        const payload: Record<string, unknown> = {
          completion_id: completionId,
          item_id: itemId,
          is_checked: isChecked,
          checked_at: isChecked ? new Date().toISOString() : null,
          channel: 'pwa',
        };
        if (notes !== undefined) payload.notes = notes;
        const { data, error } = await supabase
          .from('op_checklist_item_completions')
          .upsert(payload, { onConflict: 'completion_id,item_id' })
          .select('id')
          .single();
        if (error) throw error;
        return data;
      }
      // personal — update direto no item (schema atual)
      const updatePayload: Record<string, unknown> = { is_done: isChecked };
      if (notes !== undefined) updatePayload.note = notes;
      const { error } = await supabase
        .from('personal_checklist_items')
        .update(updatePayload)
        .eq('id', itemId);
      if (error) throw error;
      return { id: itemId };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['checklists-hoje'] });
      qc.invalidateQueries({ queryKey: ['checklists-kpi'] });
    },
  });
}
