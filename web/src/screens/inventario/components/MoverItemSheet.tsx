import { useState } from 'react';
import { useReportSalas } from '../../../hooks/useLaReport';
import type { ReportInventarioItem } from '../../../lib/lareport-types';

interface Props {
  open: boolean; onClose: () => void;
  item: ReportInventarioItem;
  onSubmit: (sala_destino_id: number, motivo?: string) => Promise<void>;
}

export function MoverItemSheet({ open, onClose, item, onSubmit }: Props) {
  const { data: salas } = useReportSalas(item.unidade_id ?? null);
  const [destino, setDestino] = useState<number | ''>('');
  const [motivo, setMotivo] = useState('');
  const [saving, setSaving] = useState(false);
  if (!open) return null;

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-end" onClick={onClose}>
      <div className="bg-bg-surface w-full rounded-t-xl p-md space-y-3" onClick={e => e.stopPropagation()}>
        <h3 className="font-bold">Mover "{item.nome}" de sala</h3>
        <select className="w-full bg-bg-app border border-border rounded-md p-2" value={destino} onChange={e => setDestino(e.target.value ? parseInt(e.target.value) : '')}>
          <option value="">Selecione a sala destino</option>
          {(salas || []).filter(s => s.id !== item.sala_id).map(s => <option key={s.id} value={s.id}>{s.nome}</option>)}
        </select>
        <input className="w-full bg-bg-app border border-border rounded-md p-2" placeholder="Motivo (opcional)" value={motivo} onChange={e => setMotivo(e.target.value)} />
        <button disabled={!destino || saving} onClick={async () => { setSaving(true); try { await onSubmit(destino as number, motivo || undefined); onClose(); } finally { setSaving(false); } }} className="w-full bg-tom text-black font-bold py-3 rounded-md disabled:opacity-50">
          {saving ? 'Movendo...' : 'Mover'}
        </button>
      </div>
    </div>
  );
}
