import { useState, useEffect } from 'react';
import { useAccess } from '../../../hooks/useAccess';
import { CATEGORIA_INVENTARIO_META, type ReportInventarioItem } from '../../../lib/lareport-types';
import { FotoUploader } from './FotoUploader';

interface Props {
  open: boolean;
  onClose: () => void;
  onSubmit: (payload: Partial<ReportInventarioItem>) => Promise<void>;
  item?: ReportInventarioItem | null;
  defaultSalaId?: number | null;
  defaultUnidadeId?: string | null;
}

const CATEGORIAS = Object.keys(CATEGORIA_INVENTARIO_META);

export function ItemSheet({ open, onClose, onSubmit, item, defaultSalaId, defaultUnidadeId }: Props) {
  const valorAccess = useAccess('valor_patrimonial');
  const [form, setForm] = useState<any>({
    nome: '', categoria: '', marca: '', modelo: '', numero_serie: '', quantidade: 1,
    unidade_id: defaultUnidadeId ?? null, sala_id: defaultSalaId ?? null,
    valor_compra: null, data_compra: null, nota_fiscal: '', fornecedor: '',
    status: 'ativo', condicao: 'bom', proxima_revisao: null, alerta_revisao_dias: 30,
    foto_url: null, observacoes: '',
  });
  const [saving, setSaving] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    if (item) setForm({ ...item });
    else setForm((f: any) => ({ ...f, unidade_id: defaultUnidadeId ?? null, sala_id: defaultSalaId ?? null }));
  }, [item, defaultUnidadeId, defaultSalaId]);

  if (!open) return null;

  async function submit() {
    if (!form.nome || !form.categoria || !form.unidade_id) { setErro('Nome, Categoria e Unidade são obrigatórios'); return; }
    setSaving(true); setErro(null);
    try {
      await onSubmit(form);
      onClose();
    } catch (e: any) {
      setErro(e.message || 'Erro ao salvar');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 z-50 overflow-y-auto">
      <div className="bg-bg-app min-h-full p-md pb-24">
        <header className="flex items-center justify-between mb-md">
          <h2 className="text-lg font-bold">{item ? 'Editar' : 'Novo'} Equipamento</h2>
          <button onClick={onClose}>✕</button>
        </header>

        <section className="bg-bg-surface rounded-lg p-md space-y-2 mb-md">
          <div className="text-[10px] uppercase tracking-wide text-fg-muted font-semibold">Identificação</div>
          <input className="w-full bg-bg-app border border-border rounded-md p-2" placeholder="Nome *" value={form.nome} onChange={e => setForm({ ...form, nome: e.target.value })} />
          <select className="w-full bg-bg-app border border-border rounded-md p-2" value={form.categoria} onChange={e => setForm({ ...form, categoria: e.target.value })}>
            <option value="">Categoria *</option>
            {CATEGORIAS.map(c => <option key={c} value={c}>{CATEGORIA_INVENTARIO_META[c].emoji} {CATEGORIA_INVENTARIO_META[c].label}</option>)}
          </select>
          <div className="grid grid-cols-2 gap-2">
            <input className="bg-bg-app border border-border rounded-md p-2" placeholder="Marca" value={form.marca || ''} onChange={e => setForm({ ...form, marca: e.target.value })} />
            <input className="bg-bg-app border border-border rounded-md p-2" placeholder="Modelo" value={form.modelo || ''} onChange={e => setForm({ ...form, modelo: e.target.value })} />
            <input className="bg-bg-app border border-border rounded-md p-2" placeholder="Núm. Série" value={form.numero_serie || ''} onChange={e => setForm({ ...form, numero_serie: e.target.value })} />
            <input type="number" className="bg-bg-app border border-border rounded-md p-2" placeholder="Qtd" value={form.quantidade} onChange={e => setForm({ ...form, quantidade: parseInt(e.target.value) || 1 })} />
          </div>
        </section>

        {valorAccess.allowed && (
          <section className="bg-bg-surface rounded-lg p-md space-y-2 mb-md">
            <div className="text-[10px] uppercase tracking-wide text-fg-muted font-semibold">Financeiro</div>
            <div className="grid grid-cols-2 gap-2">
              <input type="number" step="0.01" className="bg-bg-app border border-border rounded-md p-2" placeholder="Valor compra" value={form.valor_compra ?? ''} onChange={e => setForm({ ...form, valor_compra: e.target.value ? parseFloat(e.target.value) : null })} />
              <input type="date" className="bg-bg-app border border-border rounded-md p-2" value={form.data_compra || ''} onChange={e => setForm({ ...form, data_compra: e.target.value || null })} />
              <input className="bg-bg-app border border-border rounded-md p-2" placeholder="NF" value={form.nota_fiscal || ''} onChange={e => setForm({ ...form, nota_fiscal: e.target.value })} />
              <input className="bg-bg-app border border-border rounded-md p-2" placeholder="Fornecedor" value={form.fornecedor || ''} onChange={e => setForm({ ...form, fornecedor: e.target.value })} />
            </div>
          </section>
        )}

        <section className="bg-bg-surface rounded-lg p-md space-y-2 mb-md">
          <div className="text-[10px] uppercase tracking-wide text-fg-muted font-semibold">Status & Condição</div>
          <div className="grid grid-cols-2 gap-2">
            <select className="bg-bg-app border border-border rounded-md p-2" value={form.status} onChange={e => setForm({ ...form, status: e.target.value })}>
              <option value="ativo">Ativo</option><option value="manutencao">Manutenção</option><option value="baixa">Baixa</option><option value="inativo">Inativo</option>
            </select>
            <select className="bg-bg-app border border-border rounded-md p-2" value={form.condicao} onChange={e => setForm({ ...form, condicao: e.target.value })}>
              <option value="novo">Novo</option><option value="bom">Bom</option><option value="regular">Regular</option><option value="ruim">Ruim</option>
            </select>
            <input type="date" className="bg-bg-app border border-border rounded-md p-2" placeholder="Próx revisão" value={form.proxima_revisao || ''} onChange={e => setForm({ ...form, proxima_revisao: e.target.value || null })} />
            <input type="number" className="bg-bg-app border border-border rounded-md p-2" placeholder="Alerta dias" value={form.alerta_revisao_dias} onChange={e => setForm({ ...form, alerta_revisao_dias: parseInt(e.target.value) || 30 })} />
          </div>
        </section>

        <section className="bg-bg-surface rounded-lg p-md space-y-2 mb-md">
          <div className="text-[10px] uppercase tracking-wide text-fg-muted font-semibold">Foto + Observações</div>
          <FotoUploader value={form.foto_url} onChange={(url: string | null) => setForm({ ...form, foto_url: url })} />
          <textarea className="w-full bg-bg-app border border-border rounded-md p-2 mt-2" rows={3} placeholder="Observações" value={form.observacoes || ''} onChange={e => setForm({ ...form, observacoes: e.target.value })} />
        </section>

        {erro && <div className="text-danger text-sm mb-md">{erro}</div>}

        <div className="fixed bottom-0 inset-x-0 bg-bg-surface border-t border-border p-md">
          <button onClick={submit} disabled={saving} className="w-full bg-tom text-black font-bold py-3 rounded-md disabled:opacity-50">
            {saving ? 'Salvando...' : item ? 'Salvar Alterações' : 'Cadastrar Equipamento'}
          </button>
        </div>
      </div>
    </div>
  );
}
