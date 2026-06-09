// web/src/components/team/TransferGovernanceSheet.tsx
// Sheet para passar a posse de cobrança de uma tarefa para outro líder.
// Atualiza tasks.governance_owner_id via Supabase.
import { useState, useEffect } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import { AdaptiveSheet } from '../AdaptiveSheet';
import { Button } from '../Button';
import { CustomSelect } from '../CustomSelect';
import { showToast } from '../Toast';
import type { TeamCollab } from '../../lib/team-snapshot';

const LEADER_ROLES = ['manager', 'coordinator', 'director'];

interface Props {
  open: boolean;
  onClose: () => void;
  task: { id: string; title: string } | null;
  allCollabs: TeamCollab[];
}

export function TransferGovernanceSheet({ open, onClose, task, allCollabs }: Props) {
  const qc = useQueryClient();
  const [leaderId, setLeaderId] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setLeaderId('');
    setError(null);
  }, [open, task?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const leaders = allCollabs.filter((c) => LEADER_ROLES.includes(c.role));

  const options = leaders.map((c) => ({
    value: c.id,
    label: c.full_name,
    sublabel: c.unit ?? c.function_role ?? c.role,
  }));

  const transfer = useMutation({
    mutationFn: async () => {
      if (!task) throw new Error('no_task');
      if (!leaderId) throw new Error('Escolhe um líder pra passar a cobrança.');
      const { data, error: e } = await supabase
        .from('tasks')
        .update({ governance_owner_id: leaderId })
        .eq('id', task.id)
        .select('id');
      if (e) throw e;
      if (!data || data.length === 0) throw new Error('Tarefa não encontrada ou sem permissão.');
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['team-snapshot'] });
      qc.invalidateQueries({ queryKey: ['pessoaDetalhe'] });
      qc.invalidateQueries({ queryKey: ['tasks'] });
      showToast({ kind: 'success', title: 'Cobrança transferida', msg: 'O líder escolhido agora é responsável por cobrar essa tarefa.' });
      onClose();
    },
    onError: (e: Error) => setError(e.message),
  });

  return (
    <AdaptiveSheet open={open && Boolean(task)} onClose={onClose} title="Passar cobrança pra…" size="md">
      {task && (
        <div className="space-y-md">
          <p className="text-body-sm text-fg-muted">
            Quem fica responsável por cobrar essa tarefa.
          </p>

          <div className="rounded-md border border-border bg-bg-elevated p-3 text-body-sm text-fg-muted">
            Tarefa: <span className="text-fg font-medium">{task.title}</span>
          </div>

          <div>
            <div className="text-label uppercase tracking-wide text-fg-muted mb-1.5">
              Líder responsável pela cobrança
            </div>
            <CustomSelect
              value={leaderId}
              placeholder={options.length === 0 ? 'Nenhum líder disponível' : '— Escolher líder —'}
              onChange={setLeaderId}
              options={options}
            />
          </div>

          {error && (
            <p role="alert" className="text-body-sm text-danger">
              {error}
            </p>
          )}

          <div className="flex items-center gap-md pt-2">
            <Button type="button" variant="secondary" onClick={onClose}>
              Cancelar
            </Button>
            <Button
              type="button"
              loading={transfer.isPending}
              fullWidth
              disabled={!leaderId}
              onClick={() => {
                setError(null);
                transfer.mutate();
              }}
            >
              Confirmar
            </Button>
          </div>
        </div>
      )}
    </AdaptiveSheet>
  );
}
