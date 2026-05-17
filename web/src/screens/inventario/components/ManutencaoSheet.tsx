import { useState } from 'react';
import type { ReportInventarioItem } from '../../../lib/lareport-types';

interface Props {
  open: boolean; onClose: () => void;
  item: ReportInventarioItem;
  onSubmit: (payload: { tipo: string; descricao: string; custo?: number; data_manutencao: string; responsavel?: string; data_proxima_revisao?: string }) => Promise<void>;
}

export function ManutencaoSheet({ open, onClose, item, onSubmit }: Props) {
  const [form, setForm] = useState({ tipo: 'preventiva', descricao: '', custo: '', data_manutencao: new Date().toISOString().slice(0, 10), responsavel: '', data_proxima_revisao: '' });
  const [saving, setSaving] = useState(false);
  if (!open) return null;

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-end" onClick={onClose}>
      <div className="bg-bg-surface w-full rounded-t-xl p-md space-y-3" onClick={e => e.stopPropagation()}>
        <h3 className="font-bold">Manutenção: {item.nome}</h3>
        <select className="w-full bg-bg-app border border-border rounded-md p-2" value={form.tipo} onChange={e => setForm({ ...form, tipo: e.target.value })}>
          <option value="preventiva">Preventiva</option><option value="corretiva">Corretiva</option><option value="revisao">Revisão</option>
        </select>
        <textarea rows={3} className="w-full bg-bg-app border border-border rounded-md p-2" placeholder="Descrição *" value={form.descricao} onChange={e => setForm({ ...form, descricao: e.target.value })} />
        <div className="grid grid-cols-2 gap-2">
          <input type="date" className="bg-bg-app border border-border rounded-md p-2" value={form.data_manutencao} onChange={e => setForm({ ...form, data_manutencao: e.target.value })} />
          <input type="number" step="0.01" className="bg-bg-app border border-border rounded-md p-2" placeholder="Custo R$" value={form.custo} onChange={e => setForm({ ...form, custo: e.target.value })} />
          <input className="bg-bg-app border border-border rounded-md p-2" placeholder="Responsável" value={form.responsavel} onChange={e => setForm({ ...form, responsavel: e.target.value })} />
          <input type="date" className="bg-bg-app border border-border rounded-md p-2" placeholder="Próx revisão" value={form.data_proxima_revisao} onChange={e => setForm({ ...form, data_proxima_revisao: e.target.value })} />
        </div>
        <button disabled={!form.descricao || saving} onClick={async () => {
          setSaving(true);
          try {
            await onSubmit({
              tipo: form.tipo,
              descricao: form.descricao,
              custo: form.custo ? parseFloat(form.custo) : undefined,
              data_manutencao: form.data_manutencao,
              responsavel: form.responsavel || undefined,
              data_proxima_revisao: form.data_proxima_revisao || undefined,
            });
            onClose();
          } finally { setSaving(false); }
        }} className="w-full bg-tom text-black font-bold py-3 rounded-md disabled:opacity-50">
          {saving ? 'Registrando...' : 'Registrar'}
        </button>
      </div>
    </div>
  );
}
