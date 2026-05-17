import { useState } from 'react';
import type { ReportInventarioItem } from '../../../lib/lareport-types';

interface Props {
  open: boolean; onClose: () => void;
  item: ReportInventarioItem;
  onConfirm: () => Promise<void>;
}

export function BaixaConfirmSheet({ open, onClose, item, onConfirm }: Props) {
  const [saving, setSaving] = useState(false);
  if (!open) return null;
  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-end" onClick={onClose}>
      <div className="bg-bg-surface w-full rounded-t-xl p-md space-y-3" onClick={e => e.stopPropagation()}>
        <h3 className="font-bold text-danger">Dar baixa em "{item.nome}"?</h3>
        <p className="text-sm text-fg-muted">O item será marcado como inativo (status=baixa). Histórico preservado. Reversível só via admin do LA Report.</p>
        <div className="grid grid-cols-2 gap-2">
          <button onClick={onClose} className="bg-bg-app border border-border py-2 rounded-md">Cancelar</button>
          <button disabled={saving} onClick={async () => { setSaving(true); try { await onConfirm(); onClose(); } finally { setSaving(false); } }} className="bg-danger text-white font-bold py-2 rounded-md disabled:opacity-50">
            {saving ? 'Dando baixa...' : 'Confirmar baixa'}
          </button>
        </div>
      </div>
    </div>
  );
}
