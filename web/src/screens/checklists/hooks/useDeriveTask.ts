// Sprint 23 — Cria tarefa derivada de item de checklist e linka

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../../lib/supabase';

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
  return useMutation({
    mutationFn: async (p: Params) => {
      const { data: userData } = await supabase.auth.getUser();
      const user = userData.user;
      if (!user) throw new Error('Sem usuário');

      const { data: task, error: tErr } = await supabase
        .from('tasks')
        .insert({
          owner_id: user.id,
          title: p.title,
          description: p.description || null,
          status: 'open',
          context: 'work',
          created_via: 'checklist_derive',
        })
        .select('id')
        .single();
      if (tErr) throw tErr;

      const table =
        p.scope === 'work'
          ? 'op_checklist_item_completions'
          : 'personal_checklist_item_completions';

      const { error: linkErr } = await supabase
        .from(table)
        .upsert(
          {
            completion_id: p.completionId,
            item_id: p.itemId,
            derived_task_id: task.id,
          },
          { onConflict: 'completion_id,item_id' }
        );
      if (linkErr) throw linkErr;

      return task;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['checklists-hoje'] }),
  });
}
