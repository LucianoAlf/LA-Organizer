// Sprint Fase 2.2 — Transferência de estoque entre unidades.
import { useState, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { BottomSheet } from '../../../components/BottomSheet';
import { Field } from '../../../components/Field';
import { CustomSelect } from '../../../components/CustomSelect';
import { Button } from '../../../components/Button';
import { useReportUnidades, useProdutoSearch } from '../../../hooks/useLaReport';
import { transferirEstoque } from '../../../lib/lareport-mutations';

interface Props {
  open: boolean;
  onClose: () => void;
  unidadeOrigem: string;
}

const INPUT_CLS =
  'w-full bg-bg-surface border border-border rounded-md p-2 text-fg focus:outline-none focus:border-tom';

interface FormState {
  termoBusca: string;
  produtoId: number | null;
  produtoNome: string;
  unidadeDestino: string;
  quantidade: number;
  motivo: string;
}

const EMPTY: FormState = {
  termoBusca: '',
  produtoId: null,
  produtoNome: '',
  unidadeDestino: '',
  quantidade: 1,
  motivo: '',
};

export function TransferenciaSheet({ open, onClose, unidadeOrigem }: Props) {
  const qc = useQueryClient();
  const { data: unidades = [] } = useReportUnidades();
  const [form, setForm] = useState<FormState>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resultado, setResultado] = useState<{ saldo_origem: number; saldo_destino: number } | null>(null);

  const { data: resultadosBusca = [] } = useProdutoSearch(form.termoBusca, unidadeOrigem);

  // Reset ao abrir
  useEffect(() => {
    if (open) {
      setForm(EMPTY);
      setError(null);
      setResultado(null);
    }
  }, [open]);

  const unidadeOrigemNome = unidades.find(u => u.id === unidadeOrigem)?.nome ?? unidadeOrigem;

  const destOptions = unidades
    .filter(u => u.id !== unidadeOrigem)
    .map(u => ({ value: u.id, label: u.nome }));

  function selecionarProduto(id: number, nome: string) {
    setForm(f => ({ ...f, produtoId: id, produtoNome: nome, termoBusca: nome }));
  }

  async function handleTransferir() {
    if (!form.produtoId) { setError('Selecione um produto.'); return; }
    if (!form.unidadeDestino) { setError('Selecione a unidade destino.'); return; }
    if (form.quantidade <= 0) { setError('Quantidade deve ser maior que zero.'); return; }
    if (!form.motivo.trim()) { setError('Motivo é obrigatório.'); return; }
    if (form.unidadeDestino === unidadeOrigem) { setError('Destino deve ser diferente da origem.'); return; }

    setSaving(true);
    setError(null);
    try {
      const res = await transferirEstoque({
        produto_id: form.produtoId,
        unidade_origem: unidadeOrigem,
        unidade_destino: form.unidadeDestino,
        quantidade: form.quantidade,
        motivo: form.motivo.trim(),
      });

      const destNome = unidades.find(u => u.id === form.unidadeDestino)?.nome ?? form.unidadeDestino;
      const msg = `✅ ${form.produtoNome} −${form.quantidade} transferido. Origem: ${res.saldo_origem}un. ${destNome}: ${res.saldo_destino}un.`;

      // Invalida queries loja para ambas unidades
      qc.invalidateQueries({ queryKey: ['lareport', 'loja'] });
      qc.invalidateQueries({ queryKey: ['loja-produto-search'] });

      // Mostra resultado brevemente antes de fechar
      setResultado({ saldo_origem: res.saldo_origem, saldo_destino: res.saldo_destino });
      console.info(msg); // fallback — toast system pode ser adicionado depois
      setTimeout(() => {
        setForm(EMPTY);
        setResultado(null);
        onClose();
      }, 1800);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao transferir estoque.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <BottomSheet open={open} onClose={onClose} title="🔄 Transferir Estoque">
      <div className="space-y-md">
        {/* Produto — autocomplete */}
        <Field label="Produto">
          <input
            type="text"
            className={INPUT_CLS}
            value={form.termoBusca}
            onChange={e => setForm(f => ({ ...f, termoBusca: e.target.value, produtoId: null, produtoNome: '' }))}
            placeholder="Nome ou SKU…"
          />
          {form.termoBusca.length >= 2 && !form.produtoId && resultadosBusca.length > 0 && (
            <div className="mt-1 space-y-1">
              {resultadosBusca.map(p => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => selecionarProduto(p.id, p.nome)}
                  className="w-full flex items-center justify-between bg-bg-elevated border border-border rounded-md px-3 py-2 hover:border-tom transition-colors text-left"
                >
                  <div>
                    <p className="text-body-md font-semibold text-fg">{p.nome}</p>
                    <p className="text-body-sm text-fg-muted">Estq: {p.estoque} · R${p.preco.toFixed(2)}</p>
                  </div>
                  <span className="text-tom font-bold">→</span>
                </button>
              ))}
            </div>
          )}
          {form.produtoId && (
            <div className="mt-1 rounded-md bg-bg-elevated border border-tom/40 px-3 py-1 text-body-sm text-fg flex items-center justify-between">
              <span>✅ {form.produtoNome}</span>
              <button
                type="button"
                onClick={() => setForm(f => ({ ...f, produtoId: null, produtoNome: '', termoBusca: '' }))}
                className="text-fg-muted hover:text-danger"
              >
                ✕
              </button>
            </div>
          )}
        </Field>

        {/* Origem (readonly) */}
        <Field label="De (origem)">
          <div className="w-full h-11 px-3 flex items-center bg-bg-elevated border border-border rounded-md text-fg-muted text-body-md">
            {unidadeOrigemNome}
          </div>
        </Field>

        {/* Destino */}
        <Field label="Para (destino)">
          <CustomSelect
            value={form.unidadeDestino}
            options={destOptions}
            onChange={v => setForm(f => ({ ...f, unidadeDestino: v }))}
            placeholder="Selecionar unidade"
          />
        </Field>

        {/* Quantidade */}
        <Field label="Quantidade">
          <input
            type="number"
            min="1"
            className={INPUT_CLS}
            value={form.quantidade}
            onChange={e => setForm(f => ({ ...f, quantidade: parseInt(e.target.value) || 1 }))}
          />
        </Field>

        {/* Motivo */}
        <Field label="Motivo *">
          <input
            type="text"
            className={INPUT_CLS}
            value={form.motivo}
            onChange={e => setForm(f => ({ ...f, motivo: e.target.value }))}
            placeholder="Ex: Reforço de estoque para evento"
          />
        </Field>

        {/* Resultado sucesso */}
        {resultado && (
          <div className="rounded-md bg-success/10 border border-success/40 px-3 py-2 text-body-sm text-fg">
            ✅ Transferido! Saldo origem: <strong>{resultado.saldo_origem}</strong> · Destino: <strong>{resultado.saldo_destino}</strong>
          </div>
        )}

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
          <Button
            variant="primary"
            size="md"
            onClick={handleTransferir}
            disabled={saving || !!resultado}
            className="flex-1"
          >
            {saving ? 'Transferindo…' : 'Transferir'}
          </Button>
        </div>
      </div>
    </BottomSheet>
  );
}
