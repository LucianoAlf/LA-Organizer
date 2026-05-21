// Pendências de Inventário — Sheet de conclusão.
import { useState, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { BottomSheet } from '../../../components/BottomSheet';
import { Button } from '../../../components/Button';
import { Field } from '../../../components/Field';
import { CustomSelect } from '../../../components/CustomSelect';
import { showToast } from '../../../components/Toast';
import { atualizarPendencia } from '../../../lib/lareport-mutations';
import type { ReportPendencia } from '../../../hooks/useLaReport';

interface Props {
  open: boolean;
  onClose: () => void;
  pendencia: ReportPendencia | null;
  itensSala?: { id: number; nome: string }[];
}

export function ConcluirPendenciaSheet({ open, onClose, pendencia, itensSala = [] }: Props) {
  const qc = useQueryClient();
  const [obs, setObs] = useState('');
  const [itemVinculado, setItemVinculado] = useState<string>('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setObs('');
    setItemVinculado('');
    setSaving(false);
  }, [open, pendencia]);

  async function handleConfirm() {
    if (!pendencia) return;
    setSaving(true);
    try {
      await atualizarPendencia(pendencia.id, {
        status: 'concluida',
        resolucao_obs: obs.trim() || null,
        item_vinculado_id: itemVinculado ? Number(itemVinculado) : null,
      });
      qc.invalidateQueries({ queryKey: ['lareport', 'pendencias', pendencia.sala_id] });
      showToast({ kind: 'success', title: 'Pendência concluída' });
      onClose();
    } catch (e) {
      showToast({ kind: 'error', title: 'Falha ao concluir', msg: e instanceof Error ? e.message : String(e) });
    } finally {
      setSaving(false);
    }
  }

  if (!pendencia) return null;

  return (
    <BottomSheet open={open} onClose={onClose} title={`Concluir: ${pendencia.titulo}`}>
      <div className="space-y-md">
        <Field label="Como resolveu? (opcional)">
          <textarea
            value={obs}
            onChange={e => setObs(e.target.value)}
            rows={3}
            placeholder="Ex.: comprei na Kalunga, R$280…"
            className="w-full bg-bg-surface border border-border rounded-md p-2 text-fg focus:outline-none focus:border-tom resize-none"
          />
        </Field>

        {itensSala.length > 0 && (
          <Field label="Vincular a item do inventário (opcional)">
            <CustomSelect
              value={itemVinculado}
              options={[
                { value: '', label: '— Sem vínculo' },
                ...itensSala.map(i => ({ value: String(i.id), label: i.nome })),
              ]}
              onChange={setItemVinculado}
              placeholder="— Sem vínculo"
            />
          </Field>
        )}

        <div className="flex gap-sm pt-1">
          <Button variant="ghost" size="md" fullWidth onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button variant="primary" size="md" fullWidth onClick={handleConfirm} loading={saving}>
            Marcar como concluída
          </Button>
        </div>
      </div>
    </BottomSheet>
  );
}
