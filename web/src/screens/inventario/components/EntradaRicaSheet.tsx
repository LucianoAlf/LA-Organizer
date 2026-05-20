// Sprint Fase 2.1 — Entrada rica multi-item com NF para Lojinha
import { useState, useEffect } from 'react';
import { BottomSheet } from '../../../components/BottomSheet';
import { Button } from '../../../components/Button';
import { Field } from '../../../components/Field';
import { showToast } from '../../../components/Toast';
import { useProdutoSearch } from '../../../hooks/useLaReport';
import { registrarEntradaMulti } from '../../../lib/lareport-mutations';
import type { EntradaItem } from '../../../lib/lareport-mutations';

interface Props {
  open: boolean;
  onClose: () => void;
  unidadeId: string;
  onSuccess?: () => void;
}

interface ItemLocal {
  produto_id: number;
  nome: string;
  quantidade: number;
  preco_custo: string; // string p/ input controlado
}

function emptyItem(): ItemLocal {
  return { produto_id: 0, nome: '', quantidade: 1, preco_custo: '' };
}

function EntradaItemRow({
  item,
  index,
  unidadeId,
  onUpdate,
  onRemove,
}: {
  item: ItemLocal;
  index: number;
  unidadeId: string;
  onUpdate: (idx: number, patch: Partial<ItemLocal>) => void;
  onRemove: (idx: number) => void;
}) {
  const [termo, setTermo] = useState('');
  const [showList, setShowList] = useState(false);
  const { data: resultados = [] } = useProdutoSearch(termo, unidadeId);

  return (
    <div className="bg-bg-elevated border border-border rounded-md p-3 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-body-sm text-fg-muted font-semibold uppercase tracking-wide">Item {index + 1}</span>
        <button
          type="button"
          onClick={() => onRemove(index)}
          className="text-danger text-body-sm hover:underline"
        >
          Remover
        </button>
      </div>

      {/* Busca do produto */}
      {item.produto_id === 0 ? (
        <div className="relative">
          <input
            type="text"
            value={termo}
            onChange={e => { setTermo(e.target.value); setShowList(true); }}
            onFocus={() => setShowList(true)}
            onBlur={() => setTimeout(() => setShowList(false), 150)}
            placeholder="Buscar produto por nome ou SKU…"
            className="w-full h-11 px-3 bg-bg-surface border border-border rounded-md text-body-md text-fg placeholder:text-fg-muted outline-none focus:border-tom transition-colors"
          />
          {showList && termo.length >= 2 && (
            <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-bg-surface border border-border rounded-md shadow-soft max-h-40 overflow-y-auto">
              {resultados.length === 0 ? (
                <div className="px-3 py-2 text-body-sm text-fg-muted">Nenhum resultado</div>
              ) : resultados.map(p => (
                <button
                  key={p.id}
                  type="button"
                  onMouseDown={() => {
                    onUpdate(index, { produto_id: p.id, nome: p.nome });
                    setTermo('');
                    setShowList(false);
                  }}
                  className="w-full text-left px-3 py-2 hover:bg-bg-elevated transition-colors border-b border-border/50 last:border-0"
                >
                  <p className="text-body-md font-semibold text-fg">{p.nome}</p>
                  <p className="text-body-sm text-fg-muted">Estq: {p.estoque} · R${p.preco.toFixed(2)}</p>
                </button>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="flex items-center justify-between bg-bg-surface border border-border rounded-md px-3 py-2">
          <span className="text-body-md font-semibold text-fg">{item.nome}</span>
          <button
            type="button"
            onClick={() => onUpdate(index, { produto_id: 0, nome: '' })}
            className="text-body-sm text-tom underline"
          >
            Trocar
          </button>
        </div>
      )}

      {/* Quantidade + custo */}
      <div className="flex gap-3">
        <div className="flex-1">
          <label className="text-body-sm font-semibold text-fg block mb-1">Qtd</label>
          <input
            type="number"
            min="1"
            value={item.quantidade}
            onChange={e => onUpdate(index, { quantidade: Math.max(1, Number(e.target.value)) })}
            className="w-full h-11 px-3 bg-bg-surface border border-border rounded-md text-body-md text-fg outline-none focus:border-tom transition-colors"
          />
        </div>
        <div className="flex-1">
          <label className="text-body-sm font-semibold text-fg block mb-1">Custo unit. (R$)</label>
          <input
            type="number"
            min="0"
            step="0.01"
            value={item.preco_custo}
            onChange={e => onUpdate(index, { preco_custo: e.target.value })}
            placeholder="0,00"
            className="w-full h-11 px-3 bg-bg-surface border border-border rounded-md text-body-md text-fg placeholder:text-fg-muted outline-none focus:border-tom transition-colors"
          />
        </div>
      </div>
    </div>
  );
}

export function EntradaRicaSheet({ open, onClose, unidadeId, onSuccess }: Props) {
  const [itens, setItens] = useState<ItemLocal[]>([emptyItem()]);
  const [fornecedor, setFornecedor] = useState('');
  const [notaFiscal, setNotaFiscal] = useState('');
  const [observacao, setObservacao] = useState('');
  const [saving, setSaving] = useState(false);

  // Reset ao abrir
  useEffect(() => {
    if (open) {
      setItens([emptyItem()]);
      setFornecedor('');
      setNotaFiscal('');
      setObservacao('');
      setSaving(false);
    }
  }, [open]);

  function updateItem(idx: number, patch: Partial<ItemLocal>) {
    setItens(prev => prev.map((it, i) => i === idx ? { ...it, ...patch } : it));
  }

  function removeItem(idx: number) {
    setItens(prev => prev.filter((_, i) => i !== idx));
  }

  function adicionarItem() {
    setItens(prev => [...prev, emptyItem()]);
  }

  const totalEntrada = itens.reduce((acc, it) => {
    const custo = parseFloat(it.preco_custo) || 0;
    return acc + custo * it.quantidade;
  }, 0);

  const canSubmit = itens.length > 0 && itens.every(it => it.produto_id !== 0 && it.quantidade >= 1) && !saving;

  async function handleSubmit() {
    setSaving(true);
    try {
      const entradaItens: EntradaItem[] = itens.map(it => ({
        produto_id: it.produto_id,
        quantidade: it.quantidade,
        preco_custo: parseFloat(it.preco_custo) || null,
      }));

      await registrarEntradaMulti({
        unidade_id: unidadeId,
        itens: entradaItens,
        fornecedor: fornecedor || null,
        nota_fiscal: notaFiscal || null,
        observacao: observacao || null,
      });

      showToast({
        kind: 'success',
        title: 'Entrada registrada!',
        msg: `${itens.length} item(ns) · Total R$${totalEntrada.toFixed(2)}`,
      });
      onSuccess?.();
      onClose();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Erro ao registrar entrada';
      showToast({ kind: 'error', title: 'Erro', msg });
    } finally {
      setSaving(false);
    }
  }

  return (
    <BottomSheet open={open} onClose={onClose} title="Lançar entrada de estoque">
      <div className="px-md pb-md space-y-md">

        {/* Itens */}
        <div className="space-y-3">
          {itens.map((item, idx) => (
            <EntradaItemRow
              key={idx}
              item={item}
              index={idx}
              unidadeId={unidadeId}
              onUpdate={updateItem}
              onRemove={removeItem}
            />
          ))}
        </div>

        <Button
          variant="secondary"
          fullWidth
          onClick={adicionarItem}
          leadingIcon={<span>+</span>}
        >
          Adicionar item
        </Button>

        {/* NF + Fornecedor */}
        <Field label="Fornecedor (opcional)">
          <input
            type="text"
            value={fornecedor}
            onChange={e => setFornecedor(e.target.value)}
            placeholder="Nome do fornecedor…"
            className="w-full h-11 px-3 bg-bg-elevated border border-border rounded-md text-body-md text-fg placeholder:text-fg-muted outline-none focus:border-tom transition-colors"
          />
        </Field>

        <Field label="Nota fiscal (opcional)">
          <input
            type="text"
            value={notaFiscal}
            onChange={e => setNotaFiscal(e.target.value)}
            placeholder="Número ou código da NF…"
            className="w-full h-11 px-3 bg-bg-elevated border border-border rounded-md text-body-md text-fg placeholder:text-fg-muted outline-none focus:border-tom transition-colors"
          />
        </Field>

        <Field label="Observações (opcional)">
          <textarea
            value={observacao}
            onChange={e => setObservacao(e.target.value)}
            rows={2}
            placeholder="Anotações sobre o recebimento…"
            className="w-full px-3 py-2 bg-bg-elevated border border-border rounded-md text-body-md text-fg placeholder:text-fg-muted outline-none focus:border-tom transition-colors resize-none"
          />
        </Field>

        {/* Total calculado */}
        {totalEntrada > 0 && (
          <div className="flex justify-between items-center bg-bg-elevated border border-border rounded-md px-3 py-2">
            <span className="text-body-md text-fg-muted">Total da entrada</span>
            <span className="text-body-lg font-bold text-fg">R${totalEntrada.toFixed(2)}</span>
          </div>
        )}

        <Button
          fullWidth
          loading={saving}
          disabled={!canSubmit}
          onClick={handleSubmit}
        >
          Confirmar entrada
        </Button>
      </div>
    </BottomSheet>
  );
}
