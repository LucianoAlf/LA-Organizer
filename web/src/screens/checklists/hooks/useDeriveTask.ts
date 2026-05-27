// Sprint 23 — Cria tarefa derivada de item de checklist e linka
// Usa collaborator.id (do AuthContext) não auth.uid()

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../../lib/supabase';
import { useAuth } from '../../../contexts/AuthContext';

type Scope = 'work' | 'personal';

interface Params {
  scope: Scope;
  completionId: string;
  itemId: string;
  title: string;
  description: string;
}

export function useDeriveTask() {
  const qc = useQueryClient();
  const { collaborator } = useAuth();
  return useMutation({
    mutationFn: async (p: Params) => {
      if (!collaborator?.id) throw new Error('Sem colaborador');

      const { data: task, error: tErr } = await supabase
        .from('tasks')
        .insert({
          owner_id: collaborator.id,
          title: p.title,
          description: p.description || null,
          status: 'open',
          context: 'work',
          created_via: 'checklist_derive',
        })
        .select('id')
        .single();
      if (tErr) throw tErr;

      // Linka só em work (personal usa modelo simples sem item_completion)
      if (p.scope === 'work') {
        const { error: linkErr } = await supabase
          .from('op_checklist_item_completions')
          .upsert(
            {
              completion_id: p.completionId,
              item_id: p.itemId,
              derived_task_id: task.id,
            },
            { onConflict: 'completion_id,item_id' }
          );
        if (linkErr) throw linkErr;
      }

      return task;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['checklists-hoje'] }),
  });
}
