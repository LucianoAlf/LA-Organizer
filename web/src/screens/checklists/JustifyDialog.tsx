// Sprint 23 — JustifyDialog: justifica não-execução de checklist (work)

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';

interface Props {
  completionId: string;
  onClose: () => void;
  onJustified: () => void;
}

export function JustifyDialog({ completionId, onClose, onJustified }: Props) {
  const qc = useQueryClient();
  const [text, setText] = useState('');
  const mut = useMutation({
    mutationFn: async (justification: string) => {
      const { data: userData } = await supabase.auth.getUser();
      const { error } = await supabase
        .from('op_checklist_completions')
        .update({
          justification,
          justified_at: new Date().toISOString(),
          justified_by_id: userData.user?.id,
        })
        .eq('id', completionId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['checklists-hoje'] });
      qc.invalidateQueries({ queryKey: ['checklists-kpi'] });
      onJustified();
    },
    onError: (e: Error) => alert(`Erro: ${e.message}`),
  });

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-bg-surface border border-border rounded-lg max-w-md w-full p-4">
        <h3 className="font-semibold text-fg mb-3">Justificar não-execução</h3>
        <p className="text-xs text-fg/60 mb-3">
          A justificativa fica registrada no histórico do checklist.
        </p>
        <textarea
          autoFocus
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={4}
          placeholder="Ex: escola fechou hoje pelo feriado; aula remarcada…"
          className="w-full bg-bg-app border border-border rounded-md p-2 text-sm text-fg resize-none focus:outline-none focus:border-tom mb-4"
        />
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="text-xs px-3 py-2 text-fg/60 hover:text-fg">
            Cancelar
          </button>
          <button
            onClick={() => mut.mutate(text.trim())}
            disabled={!text.trim() || mut.isPending}
            className="text-xs px-4 py-2 bg-tom text-bg-app rounded-md font-semibold disabled:opacity-50"
          >
            {mut.isPending ? 'Salvando…' : 'Justificar'}
          </button>
        </div>
      </div>
    </div>
  );
}
