// Sprint Fase B — Lojinha bidirecional
// Sheet para registrar entrada de estoque (recebimento de mercadoria).
import { useState, useEffect } from 'react';
import { BottomSheet } from '../../../components/BottomSheet';
import { Button } from '../../../components/Button';
import { Field } from '../../../components/Field';
import { showToast } from '../../../components/Toast';
import { useProdutoSearch } from '../../../hooks/useLaReport';
import { registrarEntradaEstoque } from '../../../lib/lareport-mutations';

interface Props {
  open: boolean;
  onClose: () => void;
  unidadeId: string;
  onSuccess?: () => void;
}

export function EntradaEstoqueSheet({ open, onClose, unidadeId, onSuccess }: Props) {
  const [termo, setTermo] = useState('');
  const [produtoId, setProdutoId] = useState<number | null>(null);
  const [produtoNome, setProdutoNome] = useState('');
  const [quantidade, setQuantidade] = useState(1);
  const [obs, setObs] = useState('');
  const [saving, setSaving] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const { data: resultados = [] } = useProdutoSearch(termo, unidadeId);

  // Reset ao abrir
  useEffect(() => {
    if (open) {
      setTermo('');
      setProdutoId(null);
      setProdutoNome('');
      setQuantidade(1);
      setObs('');
      setErro(null);
    }
  }, [open]);

  function selecionarProduto(id: number, nome: string) {
    setProdutoId(id);
    setProdutoNome(nome);
    setTermo('');
  }

  async function submit() {
    if (!produtoId) { setErro('Selecione um produto.'); return; }
    if (quantidade < 1) { setErro('Quantidade deve ser ao menos 1.'); return; }
    setSaving(true);
    setErro(null);
    try {
      const result = await registrarEntradaEstoque({
        produto_id: produtoId,
        unidade_id: unidadeId,
        quantidade,
        observacoes: obs || null,
      });
      showToast({
        kind: 'success',
        title: 'Entrada registrada!',
        msg: `Novo saldo: ${result.saldo_apos} un.`,
      });
      onSuccess?.();
      onClose();
    } catch (e: any) {
      setErro(e.message || 'Erro ao registrar entrada.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <BottomSheet open={open} onClose={onClose} title="Entrada de Estoque">
      <div className="p-md space-y-md">

        {/* Busca de produto */}
        <Field label="Produto">
          {produtoId ? (
            <div className="flex items-center justify-between bg-bg-surface border border-border rounded-md px-3 py-2">
              <span className="text-body-md text-fg">{produtoNome}</span>
              <button
                type="button"
                onClick={() => { setProdutoId(null); setProdutoNome(''); }}
                className="text-fg-muted text-body-sm hover:text-danger ml-2"
              >
                Trocar
              </button>
            </div>
          ) : (
            <>
              <input
                type="text"
                value={termo}
                onChange={e => setTermo(e.target.value)}
                placeholder="Buscar produto por nome ou SKU…"
                className="w-full bg-bg-surface border border-border rounded-md p-2 text-fg focus:outline-none focus:border-tom"
              />
              {resultados.length > 0 && (
                <div className="mt-1 border border-border rounded-md bg-bg-surface overflow-hidden shadow-soft">
                  {resultados.map(p => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => selecionarProduto(p.id, p.nome)}
                      className="w-full text-left px-3 py-2 hover:bg-bg-elevated transition-colors"
                    >
                      <div className="text-body-sm font-semibold text-fg">{p.nome}</div>
                      <div className="text-body-sm text-fg-muted">
                        SKU: {p.sku} · Estoque atual: {p.estoque}
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </Field>

        {/* Quantidade recebida */}
        <Field label="Quantidade recebida">
          <input
            type="number"
            min={1}
            value={quantidade}
            onChange={e => setQuantidade(Number(e.target.value))}
            className="w-full bg-bg-surface border border-border rounded-md p-2 text-fg focus:outline-none focus:border-tom"
          />
        </Field>

        {/* Observações */}
        <Field label="Observações" sub="Opcional — ex: NF 12345, fornecedor X">
          <input
            type="text"
            value={obs}
            onChange={e => setObs(e.target.value)}
            placeholder="Ex: NF 12345, Fornecedor Mel-Remi…"
            className="w-full bg-bg-surface border border-border rounded-md p-2 text-fg focus:outline-none focus:border-tom"
          />
        </Field>

        {erro && (
          <p className="text-body-sm text-danger">{erro}</p>
        )}

        <div className="flex gap-sm pt-sm">
          <Button variant="secondary" fullWidth onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button variant="primary" fullWidth onClick={submit} loading={saving}>
            Registrar Entrada
          </Button>
        </div>
      </div>
    </BottomSheet>
  );
}
