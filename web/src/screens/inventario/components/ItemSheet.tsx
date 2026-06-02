import { useState, useEffect } from 'react';
import { useAccess } from '../../../hooks/useAccess';
import { CATEGORIA_INVENTARIO_META, type ReportInventarioItem } from '../../../lib/lareport-types';
import { FotoUploader } from './FotoUploader';
import { CustomSelect } from '../../../components/CustomSelect';
import { DateInput } from '../../../components/DateInput';
import { AdaptiveSheet } from '../../../components/AdaptiveSheet';
import { writeErrorMsg } from '../../../lib/lareport-mutations';

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

  async function submit() {
    if (!form.nome || !form.categoria || !form.unidade_id) { setErro('Nome, Categoria e Unidade são obrigatórios'); return; }
    setSaving(true); setErro(null);
    try {
      await onSubmit(form);
      onClose();
    } catch (e: any) {
      setErro(writeErrorMsg(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <AdaptiveSheet open={open} onClose={onClose} title={item ? 'Editar Equipamento' : 'Novo Equipamento'} size="lg">
      <div className="space-y-md">

        <section className="bg-bg-surface rounded-lg p-md space-y-2 mb-md">
          <div className="text-[10px] uppercase tracking-wide text-fg-muted font-semibold">Identificação</div>
          <input className="w-full bg-bg-app border border-border rounded-md p-2" placeholder="Nome *" value={form.nome} onChange={e => setForm({ ...form, nome: e.target.value })} />
          <CustomSelect
            value={form.categoria}
            onChange={(v) => setForm({ ...form, categoria: v })}
            placeholder="Categoria *"
            options={CATEGORIAS.map(c => ({
              value: c,
              label: `${CATEGORIA_INVENTARIO_META[c].emoji} ${CATEGORIA_INVENTARIO_META[c].label}`,
            }))}
          />
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
              <DateInput value={form.data_compra ?? ''} onChange={(v) => setForm({ ...form, data_compra: v || null })} />
              <input className="bg-bg-app border border-border rounded-md p-2" placeholder="NF" value={form.nota_fiscal || ''} onChange={e => setForm({ ...form, nota_fiscal: e.target.value })} />
              <input className="bg-bg-app border border-border rounded-md p-2" placeholder="Fornecedor" value={form.fornecedor || ''} onChange={e => setForm({ ...form, fornecedor: e.target.value })} />
            </div>
          </section>
        )}

        <section className="bg-bg-surface rounded-lg p-md space-y-2 mb-md">
          <div className="text-[10px] uppercase tracking-wide text-fg-muted font-semibold">Status & Condição</div>
          <div className="grid grid-cols-2 gap-2">
            <CustomSelect
              value={form.status}
              onChange={(v) => setForm({ ...form, status: v })}
              options={[
                { value: 'ativo', label: 'Ativo' },
                { value: 'manutencao', label: 'Manutenção' },
                { value: 'baixa', label: 'Baixa' },
                { value: 'inativo', label: 'Inativo' },
              ]}
            />
            <CustomSelect
              value={form.condicao}
              onChange={(v) => setForm({ ...form, condicao: v })}
              options={[
                { value: 'novo', label: 'Novo' },
                { value: 'bom', label: 'Bom' },
                { value: 'regular', label: 'Regular' },
                { value: 'ruim', label: 'Ruim' },
              ]}
            />
            <DateInput value={form.proxima_revisao ?? ''} onChange={(v) => setForm({ ...form, proxima_revisao: v || null })} />
            <input type="number" className="bg-bg-app border border-border rounded-md p-2" placeholder="Alerta dias" value={form.alerta_revisao_dias} onChange={e => setForm({ ...form, alerta_revisao_dias: parseInt(e.target.value) || 30 })} />
          </div>
        </section>

        <section className="bg-bg-surface rounded-lg p-md space-y-2 mb-md">
          <div className="text-[10px] uppercase tracking-wide text-fg-muted font-semibold">Foto + Observações</div>
          <FotoUploader value={form.foto_url} onChange={(url: string | null) => setForm({ ...form, foto_url: url })} />
          <textarea className="w-full bg-bg-app border border-border rounded-md p-2 mt-2" rows={3} placeholder="Observações" value={form.observacoes || ''} onChange={e => setForm({ ...form, observacoes: e.target.value })} />
        </section>

        {erro && <div className="text-danger text-sm mb-md">{erro}</div>}

        <button onClick={submit} disabled={saving} className="w-full bg-tom text-black font-bold py-3 rounded-md disabled:opacity-50">
          {saving ? 'Salvando...' : item ? 'Salvar Alterações' : 'Cadastrar Equipamento'}
        </button>
      </div>
    </AdaptiveSheet>
  );
}
