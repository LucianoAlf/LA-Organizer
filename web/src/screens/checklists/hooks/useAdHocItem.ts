// Sprint 23 — Itens ad-hoc em checklist work
// Tabela: op_checklist_completion_extra_items

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../../lib/supabase';

export function useAdHocItem() {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: ['checklists-hoje'] });

  const add = useMutation({
    mutationFn: async ({
      completionId,
      description,
    }: {
      completionId: string;
      description: string;
    }) => {
      const { data: userData } = await supabase.auth.getUser();
      const { error } = await supabase
        .from('op_checklist_completion_extra_items')
        .insert({
          completion_id: completionId,
          description,
          is_checked: false,
          created_by: userData.user?.id,
        });
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  const toggle = useMutation({
    mutationFn: async ({ id, isChecked }: { id: string; isChecked: boolean }) => {
      const { error } = await supabase
        .from('op_checklist_completion_extra_items')
        .update({ is_checked: isChecked })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  const update = useMutation({
    mutationFn: async ({ id, description }: { id: string; description: string }) => {
      const { error } = await supabase
        .from('op_checklist_completion_extra_items')
        .update({ description })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  const remove = useMutation({
    mutationFn: async ({ id }: { id: string }) => {
      const { error } = await supabase
        .from('op_checklist_completion_extra_items')
        .delete()
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  return { add, toggle, update, remove };
}
