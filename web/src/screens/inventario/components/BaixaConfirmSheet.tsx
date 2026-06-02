import { useState } from 'react';
import type { ReportInventarioItem } from '../../../lib/lareport-types';
import { AdaptiveSheet } from '../../../components/AdaptiveSheet';
import { showToast } from '../../../components/Toast';
import { writeErrorMsg } from '../../../lib/lareport-mutations';

interface Props {
  open: boolean; onClose: () => void;
  item: ReportInventarioItem;
  onConfirm: () => Promise<void>;
}

export function BaixaConfirmSheet({ open, onClose, item, onConfirm }: Props) {
  const [saving, setSaving] = useState(false);
  return (
    <AdaptiveSheet open={open} onClose={onClose} title={`Dar baixa em "${item.nome}"?`} size="sm">
      <div className="space-y-3">
        <p className="text-sm text-fg-muted">O item será marcado como inativo (status=baixa). Histórico preservado. Reversível só via admin do LA Report.</p>
        <div className="grid grid-cols-2 gap-2">
          <button onClick={onClose} className="bg-bg-app border border-border py-2 rounded-md">Cancelar</button>
          <button disabled={saving} onClick={async () => { setSaving(true); try { await onConfirm(); onClose(); } catch (e) { showToast({ kind: 'error', title: 'Não foi possível dar baixa', msg: writeErrorMsg(e) }); } finally { setSaving(false); } }} className="bg-danger text-white font-bold py-2 rounded-md disabled:opacity-50">
            {saving ? 'Dando baixa...' : 'Confirmar baixa'}
          </button>
        </div>
      </div>
    </AdaptiveSheet>
  );
}
