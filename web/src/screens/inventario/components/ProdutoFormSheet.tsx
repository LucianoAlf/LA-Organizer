// Sprint Fase 2.2 — Cadastro/edição de produto com detecção de duplicata.
import { useState, useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { BottomSheet } from '../../../components/BottomSheet';
import { Field } from '../../../components/Field';
import { CustomSelect } from '../../../components/CustomSelect';
import { Button } from '../../../components/Button';
import { laReportClient } from '../../../lib/lareport-client';
import {
  upsertProduto,
  buscarProdutoSimilar,
  type ProdutoUpsertInput,
  type ProdutoSimilarResult,
} from '../../../lib/lareport-mutations';

interface Categoria { id: number; nome: string; icone: string | null; }

interface Props {
  open: boolean;
  onClose: () => void;
  mode: 'create' | 'edit';
  produto?: Partial<ProdutoUpsertInput & { id: number }>;
  unidadeId?: string;
}

const EMPTY_FORM: ProdutoUpsertInput = {
  nome: '',
  categoria_id: 0,
  sku: '',
  preco: 0,
  custo: null,
  estoque_minimo: 5,
  comissao_especial: null,
  foto_url: '',
  descricao: '',
  disponivel_whatsapp: false,
  ativo: true,
};

function toForm(p?: Partial<ProdutoUpsertInput & { id: number }>): ProdutoUpsertInput & { id?: number } {
  if (!p) return { ...EMPTY_FORM };
  return {
    id: p.id,
    nome: p.nome ?? '',
    categoria_id: p.categoria_id ?? 0,
    sku: p.sku ?? '',
    preco: p.preco ?? 0,
    custo: p.custo ?? null,
    estoque_minimo: p.estoque_minimo ?? 5,
    comissao_especial: p.comissao_especial ?? null,
    foto_url: p.foto_url ?? '',
    descricao: p.descricao ?? '',
    disponivel_whatsapp: p.disponivel_whatsapp ?? false,
    ativo: p.ativo ?? true,
  };
}

const INPUT_CLS =
  'w-full bg-bg-surface border border-border rounded-md p-2 text-fg focus:outline-none focus:border-tom';
const TEXTAREA_CLS =
  'w-full bg-bg-surface border border-border rounded-md p-2 text-fg focus:outline-none focus:border-tom resize-none';

export function ProdutoFormSheet({ open, onClose, mode, produto, unidadeId }: Props) {
  const qc = useQueryClient();
  const [form, setForm] = useState<ProdutoUpsertInput & { id?: number }>(toForm(produto));
  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [similares, setSimilares] = useState<ProdutoSimilarResult[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Reset form quando abre
  useEffect(() => {
    if (open) {
      setForm(toForm(produto));
      setSimilares([]);
      setError(null);
    }
  }, [open, produto]);

  // Buscar categorias
  useEffect(() => {
    if (!open) return;
    laReportClient
      .from('loja_categorias')
      .select('id, nome, icone')
      .eq('ativo', true)
      .order('nome')
      .then(({ data }: { data: unknown[] | null; error: unknown }) => setCategorias((data as Categoria[]) || []));
  }, [open]);

  // Detecção de duplicata via debounce
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const nome = form.nome.trim();
    if (nome.length < 3 || mode === 'edit') {
      setSimilares([]);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      try {
        const results = await buscarProdutoSimilar(nome, 5);
        setSimilares(results);
      } catch {
        // silencioso — não bloqueia o fluxo
      }
    }, 500);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [form.nome, mode]);

  function set<K extends keyof (ProdutoUpsertInput & { id?: number })>(
    key: K,
    value: (ProdutoUpsertInput & { id?: number })[K]
  ) {
    setForm(f => ({ ...f, [key]: value }));
  }

  async function handleSave() {
    if (!form.nome.trim()) { setError('Nome é obrigatório.'); return; }
    if (!form.categoria_id) { setError('Selecione uma categoria.'); return; }
    if (form.preco <= 0) { setError('Preço deve ser maior que zero.'); return; }
    setSaving(true);
    setError(null);
    try {
      await upsertProduto({
        ...form,
        nome: form.nome.trim(),
        sku: form.sku?.trim() || null,
        foto_url: form.foto_url?.trim() || null,
        descricao: form.descricao?.trim() || null,
      });
      // Invalida queries da loja
      qc.invalidateQueries({ queryKey: ['lareport', 'loja'] });
      if (unidadeId) {
        qc.invalidateQueries({ queryKey: ['lareport', 'loja', unidadeId] });
      }
      setForm(toForm(undefined));
      setSimilares([]);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao salvar produto.');
    } finally {
      setSaving(false);
    }
  }

  const catOptions = categorias.map(c => ({
    value: String(c.id),
    label: `${c.icone ? c.icone + ' ' : ''}${c.nome}`,
  }));

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title={mode === 'create' ? '🆕 Cadastrar Produto' : '✏️ Editar Produto'}
    >
      <div className="space-y-md">
        {/* Nome + detecção de duplicata */}
        <Field label="Nome *">
          <input
            type="text"
            className={INPUT_CLS}
            value={form.nome}
            onChange={e => set('nome', e.target.value)}
            placeholder="Ex: Caderno de Violão"
          />
          {similares.length > 0 && (
            <div className="mt-1 rounded-md bg-warning/10 border border-warning/40 px-3 py-2 text-body-sm text-fg-muted">
              🔎 Produtos parecidos: <strong className="text-fg">{similares.map(s => s.nome).join(', ')}</strong>. Tem certeza que é um produto novo?
            </div>
          )}
        </Field>

        {/* Categoria */}
        <Field label="Categoria *">
          <CustomSelect
            value={form.categoria_id ? String(form.categoria_id) : ''}
            options={catOptions}
            onChange={v => set('categoria_id', Number(v))}
            placeholder="Selecionar categoria"
          />
        </Field>

        {/* SKU */}
        <Field label="SKU" sub="Deixe vazio para gerar automaticamente">
          <input
            type="text"
            className={INPUT_CLS}
            value={form.sku ?? ''}
            onChange={e => set('sku', e.target.value)}
            placeholder="Ex: CAD-VIO-001"
          />
        </Field>

        {/* Preço e Custo */}
        <div className="grid grid-cols-2 gap-sm">
          <Field label="Preço * (R$)">
            <input
              type="number"
              min="0"
              step="0.01"
              className={INPUT_CLS}
              value={form.preco || ''}
              onChange={e => set('preco', parseFloat(e.target.value) || 0)}
              placeholder="0,00"
            />
          </Field>
          <Field label="Custo (R$)">
            <input
              type="number"
              min="0"
              step="0.01"
              className={INPUT_CLS}
              value={form.custo ?? ''}
              onChange={e => set('custo', e.target.value ? parseFloat(e.target.value) : null)}
              placeholder="0,00"
            />
          </Field>
        </div>

        {/* Estoque mínimo e Comissão */}
        <div className="grid grid-cols-2 gap-sm">
          <Field label="Estoque mínimo">
            <input
              type="number"
              min="0"
              className={INPUT_CLS}
              value={form.estoque_minimo ?? 5}
              onChange={e => set('estoque_minimo', parseInt(e.target.value) || 0)}
            />
          </Field>
          <Field label="Comissão especial (%)">
            <input
              type="number"
              min="0"
              max="100"
              step="0.5"
              className={INPUT_CLS}
              value={form.comissao_especial ?? ''}
              onChange={e => set('comissao_especial', e.target.value ? parseFloat(e.target.value) : null)}
              placeholder="—"
            />
          </Field>
        </div>

        {/* Foto URL */}
        <Field label="URL da foto" sub="Cole o link da imagem (upload via TOM em breve)">
          <input
            type="text"
            className={INPUT_CLS}
            value={form.foto_url ?? ''}
            onChange={e => set('foto_url', e.target.value)}
            placeholder="https://..."
          />
        </Field>

        {/* Descrição */}
        <Field label="Descrição">
          <textarea
            className={TEXTAREA_CLS}
            rows={3}
            value={form.descricao ?? ''}
            onChange={e => set('descricao', e.target.value)}
            placeholder="Detalhes opcionais sobre o produto..."
          />
        </Field>

        {/* Checkboxes */}
        <div className="space-y-2">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={form.disponivel_whatsapp ?? false}
              onChange={e => set('disponivel_whatsapp', e.target.checked)}
              className="w-4 h-4 accent-tom"
            />
            <span className="text-body-md text-fg">Disponível no cardápio WhatsApp</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={form.ativo ?? true}
              onChange={e => set('ativo', e.target.checked)}
              className="w-4 h-4 accent-tom"
            />
            <span className="text-body-md text-fg">Produto ativo</span>
          </label>
        </div>

        {/* Erro */}
        {error && (
          <div className="rounded-md bg-danger/10 border border-danger/40 px-3 py-2 text-body-sm text-danger">
            {error}
          </div>
        )}

        {/* Ações */}
        <div className="flex gap-sm pt-2">
          <Button variant="secondary" size="md" onClick={onClose} className="flex-1">
            Cancelar
          </Button>
          <Button variant="primary" size="md" onClick={handleSave} disabled={saving} className="flex-1">
            {saving ? 'Salvando…' : 'Salvar'}
          </Button>
        </div>
      </div>
    </BottomSheet>
  );
}
