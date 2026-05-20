// Sprint Fase 2.1 — Wizard 3 passos para registrar venda multi-item
import { useState, useEffect, useMemo } from 'react';
import { BottomSheet } from '../../../components/BottomSheet';
import { Button } from '../../../components/Button';
import { CustomSelect } from '../../../components/CustomSelect';
import { Field } from '../../../components/Field';
import { showToast } from '../../../components/Toast';
import { ClienteAutocomplete } from '../../../components/ClienteAutocomplete';
import { ProfessorAutocomplete } from '../../../components/ProfessorAutocomplete';
import { useProdutoSearch } from '../../../hooks/useLaReport';
import { registrarVendaMulti } from '../../../lib/lareport-mutations';
import type { VendaItem, ClienteSearchResult, ProfessorSearchResult } from '../../../lib/lareport-mutations';

interface Props {
  open: boolean;
  onClose: () => void;
  unidadeId: string;
  onSuccess?: () => void;
}

const FORMA_PGTO_OPTIONS = [
  { value: 'pix', label: 'Pix' },
  { value: 'credito', label: 'Crédito' },
  { value: 'debito', label: 'Débito' },
  { value: 'dinheiro', label: 'Dinheiro' },
  { value: 'folha', label: 'Folha de pagamento' },
  { value: 'saldo', label: 'Saldo LA' },
];

const TIPO_CLIENTE_OPTIONS = [
  { value: 'avulso', label: 'Avulso' },
  { value: 'aluno', label: 'Aluno' },
  { value: 'colaborador', label: 'Colaborador' },
];

const DESCONTO_TIPO_OPTIONS = [
  { value: 'valor', label: 'R$ (valor fixo)' },
  { value: 'percentual', label: '% (percentual)' },
];

const PARCELAS_OPTIONS = Array.from({ length: 12 }, (_, i) => ({
  value: String(i + 1),
  label: `${i + 1}x`,
}));

interface CarrinhoItem {
  produto_id: number;
  nome: string;
  preco_unitario: number;
  quantidade: number;
}

function resetState() {
  return {
    step: 1,
    termoBusca: '',
    carrinho: [] as CarrinhoItem[],
    tipoCliente: 'avulso' as 'avulso' | 'aluno' | 'colaborador',
    clienteSelecionado: null as ClienteSearchResult | null,
    professorIndicador: null as ProfessorSearchResult | null,
    formaPgto: 'pix' as string,
    parcelas: '1',
    descontoTipo: 'valor' as 'valor' | 'percentual',
    descontoValor: '',
    viawpp: false,
    observacoes: '',
    saving: false,
  };
}

export function VendaWizardSheet({ open, onClose, unidadeId, onSuccess }: Props) {
  const [state, setState] = useState(resetState());

  const { data: resultadosBusca = [] } = useProdutoSearch(state.termoBusca, unidadeId);

  // Reset ao abrir
  useEffect(() => {
    if (open) setState(resetState());
  }, [open]);

  // ---- Carrinho helpers ----
  function adicionarAoCarrinho(prod: { id: number; nome: string; preco: number }) {
    setState(s => {
      const idx = s.carrinho.findIndex(c => c.produto_id === prod.id);
      if (idx >= 0) {
        const novo = [...s.carrinho];
        novo[idx] = { ...novo[idx], quantidade: novo[idx].quantidade + 1 };
        return { ...s, carrinho: novo };
      }
      return {
        ...s,
        carrinho: [...s.carrinho, {
          produto_id: prod.id,
          nome: prod.nome,
          preco_unitario: prod.preco,
          quantidade: 1,
        }],
      };
    });
  }

  function alterarQuantidade(prodId: number, delta: number) {
    setState(s => {
      const novo = s.carrinho.map(c =>
        c.produto_id === prodId ? { ...c, quantidade: Math.max(1, c.quantidade + delta) } : c
      ).filter(c => c.quantidade > 0);
      return { ...s, carrinho: novo };
    });
  }

  function removerItem(prodId: number) {
    setState(s => ({ ...s, carrinho: s.carrinho.filter(c => c.produto_id !== prodId) }));
  }

  // ---- Cálculos ----
  const subtotal = useMemo(
    () => state.carrinho.reduce((acc, c) => acc + c.preco_unitario * c.quantidade, 0),
    [state.carrinho]
  );

  const descontoCalculado = useMemo(() => {
    const v = parseFloat(state.descontoValor) || 0;
    if (state.descontoTipo === 'percentual') return subtotal * (v / 100);
    return v;
  }, [subtotal, state.descontoValor, state.descontoTipo]);

  const total = Math.max(0, subtotal - descontoCalculado);

  // ---- Submeter ----
  async function handleSubmit() {
    if (state.carrinho.length === 0) return;
    setState(s => ({ ...s, saving: true }));
    try {
      const itens: VendaItem[] = state.carrinho.map(c => ({
        produto_id: c.produto_id,
        quantidade: c.quantidade,
        preco_unitario: c.preco_unitario,
        desconto: descontoCalculado > 0 ? descontoCalculado : undefined,
        desconto_tipo: descontoCalculado > 0 ? state.descontoTipo : undefined,
      }));

      await registrarVendaMulti({
        unidade_id: unidadeId,
        forma_pagamento: state.formaPgto as 'pix' | 'dinheiro' | 'debito' | 'credito' | 'folha' | 'saldo',
        itens,
        tipo_cliente: state.tipoCliente,
        aluno_id: state.tipoCliente === 'aluno' ? state.clienteSelecionado?.id ?? null : null,
        colaborador_id: state.tipoCliente === 'colaborador' ? state.clienteSelecionado?.id ?? null : null,
        professor_indicador_id: state.professorIndicador?.id ?? null,
        parcelas: state.formaPgto === 'credito' ? Number(state.parcelas) : null,
        observacoes: state.observacoes || null,
        via_audit: state.viawpp ? 'whatsapp' : null,
      });

      showToast({ kind: 'success', title: 'Venda registrada!', msg: `Total: R$${total.toFixed(2)}` });
      onSuccess?.();
      onClose();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Erro ao registrar venda';
      showToast({ kind: 'error', title: 'Erro', msg });
    } finally {
      setState(s => ({ ...s, saving: false }));
    }
  }

  // ---- Steps ----
  const canGoStep2 = state.carrinho.length > 0;
  const canGoStep3 = true; // tipo avulso não exige seleção
  const canSubmit = state.carrinho.length > 0 && !state.saving;

  // ---- Indicador de step ----
  function StepIndicator() {
    return (
      <div className="flex items-center gap-2 mb-md">
        {[1, 2, 3].map(n => (
          <div key={n} className="flex items-center gap-2">
            <div
              className={[
                'w-7 h-7 rounded-full flex items-center justify-center text-body-sm font-bold',
                state.step === n
                  ? 'bg-tom text-black'
                  : state.step > n
                    ? 'bg-tom/30 text-tom'
                    : 'bg-bg-elevated text-fg-muted',
              ].join(' ')}
            >
              {n}
            </div>
            {n < 3 && <div className={`flex-1 h-px ${state.step > n ? 'bg-tom/50' : 'bg-border'}`} style={{ width: 24 }} />}
          </div>
        ))}
        <span className="text-body-sm text-fg-muted ml-2">
          {state.step === 1 ? 'Produtos' : state.step === 2 ? 'Cliente' : 'Pagamento'}
        </span>
      </div>
    );
  }

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title="Nova venda"
    >
      <div className="px-md pb-md space-y-md">
        <StepIndicator />

        {/* ===== STEP 1: PRODUTOS ===== */}
        {state.step === 1 && (
          <div className="space-y-md">
            <Field label="Buscar produto">
              <input
                type="text"
                value={state.termoBusca}
                onChange={e => setState(s => ({ ...s, termoBusca: e.target.value }))}
                placeholder="Nome ou SKU…"
                className="w-full h-11 px-3 bg-bg-elevated border border-border rounded-md text-body-md text-fg placeholder:text-fg-muted outline-none focus:border-tom transition-colors"
              />
            </Field>

            {/* Resultados da busca */}
            {state.termoBusca.length >= 2 && resultadosBusca.length > 0 && (
              <div className="space-y-2">
                {resultadosBusca.map(p => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => adicionarAoCarrinho(p)}
                    className="w-full flex items-center justify-between bg-bg-elevated border border-border rounded-md px-3 py-2 hover:border-tom transition-colors text-left"
                  >
                    <div>
                      <p className="text-body-md font-semibold text-fg">{p.nome}</p>
                      <p className="text-body-sm text-fg-muted">Estq: {p.estoque} · R${p.preco.toFixed(2)}</p>
                    </div>
                    <span className="text-tom font-bold text-lg">+</span>
                  </button>
                ))}
              </div>
            )}

            {/* Carrinho */}
            {state.carrinho.length > 0 && (
              <div className="space-y-2">
                <p className="text-body-sm text-fg-muted font-semibold uppercase tracking-wide">Carrinho</p>
                {state.carrinho.map(c => (
                  <div key={c.produto_id} className="flex items-center gap-2 bg-bg-surface border border-border rounded-md px-3 py-2">
                    <div className="flex-1 min-w-0">
                      <p className="text-body-md font-semibold text-fg truncate">{c.nome}</p>
                      <p className="text-body-sm text-fg-muted">R${(c.preco_unitario * c.quantidade).toFixed(2)}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <button type="button" onClick={() => alterarQuantidade(c.produto_id, -1)}
                        className="w-7 h-7 rounded-full bg-bg-elevated border border-border text-fg font-bold flex items-center justify-center">−</button>
                      <span className="text-body-md font-semibold text-fg w-5 text-center">{c.quantidade}</span>
                      <button type="button" onClick={() => alterarQuantidade(c.produto_id, 1)}
                        className="w-7 h-7 rounded-full bg-bg-elevated border border-border text-fg font-bold flex items-center justify-center">+</button>
                      <button type="button" onClick={() => removerItem(c.produto_id)}
                        className="w-7 h-7 rounded-full bg-danger/10 border border-danger/30 text-danger flex items-center justify-center text-body-sm">✕</button>
                    </div>
                  </div>
                ))}
                <div className="flex justify-between items-center pt-1">
                  <span className="text-body-sm text-fg-muted">Subtotal</span>
                  <span className="text-body-md font-bold text-fg">R${subtotal.toFixed(2)}</span>
                </div>
              </div>
            )}

            <Button
              fullWidth
              disabled={!canGoStep2}
              onClick={() => setState(s => ({ ...s, step: 2 }))}
            >
              Próximo →
            </Button>
          </div>
        )}

        {/* ===== STEP 2: CLIENTE ===== */}
        {state.step === 2 && (
          <div className="space-y-md">
            <Field label="Tipo de cliente">
              <CustomSelect
                value={state.tipoCliente}
                options={TIPO_CLIENTE_OPTIONS}
                onChange={v => setState(s => ({
                  ...s,
                  tipoCliente: v as 'avulso' | 'aluno' | 'colaborador',
                  clienteSelecionado: null,
                }))}
              />
            </Field>

            {(state.tipoCliente === 'aluno' || state.tipoCliente === 'colaborador') && (
              <Field label={state.tipoCliente === 'aluno' ? 'Aluno' : 'Colaborador'}>
                <ClienteAutocomplete
                  tipo={state.tipoCliente}
                  unidadeId={unidadeId}
                  value={state.clienteSelecionado}
                  onChange={c => setState(s => ({ ...s, clienteSelecionado: c }))}
                />
              </Field>
            )}

            <Field label="Professor indicador (opcional)">
              <ProfessorAutocomplete
                unidadeId={unidadeId}
                value={state.professorIndicador}
                onChange={p => setState(s => ({ ...s, professorIndicador: p }))}
              />
            </Field>

            <div className="flex gap-2">
              <Button variant="secondary" onClick={() => setState(s => ({ ...s, step: 1 }))}>← Voltar</Button>
              <Button fullWidth disabled={!canGoStep3} onClick={() => setState(s => ({ ...s, step: 3 }))}>Próximo →</Button>
            </div>
          </div>
        )}

        {/* ===== STEP 3: PAGAMENTO ===== */}
        {state.step === 3 && (
          <div className="space-y-md">
            <Field label="Forma de pagamento">
              <CustomSelect
                value={state.formaPgto}
                options={FORMA_PGTO_OPTIONS}
                onChange={v => setState(s => ({ ...s, formaPgto: v, parcelas: '1' }))}
              />
            </Field>

            {state.formaPgto === 'credito' && (
              <Field label="Parcelas">
                <CustomSelect
                  value={state.parcelas}
                  options={PARCELAS_OPTIONS}
                  onChange={v => setState(s => ({ ...s, parcelas: v }))}
                />
              </Field>
            )}

            <Field label="Desconto">
              <div className="flex gap-2">
                <div className="w-40 shrink-0">
                  <CustomSelect
                    value={state.descontoTipo}
                    options={DESCONTO_TIPO_OPTIONS}
                    onChange={v => setState(s => ({ ...s, descontoTipo: v as 'valor' | 'percentual', descontoValor: '' }))}
                  />
                </div>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={state.descontoValor}
                  onChange={e => setState(s => ({ ...s, descontoValor: e.target.value }))}
                  placeholder={state.descontoTipo === 'percentual' ? '0%' : 'R$ 0,00'}
                  className="flex-1 h-12 px-3 bg-bg-elevated border border-border rounded-md text-body-md text-fg placeholder:text-fg-muted outline-none focus:border-tom transition-colors"
                />
              </div>
            </Field>

            {/* Total ao vivo */}
            <div className="bg-bg-elevated border border-border rounded-md px-3 py-3 space-y-1">
              <div className="flex justify-between text-body-sm text-fg-muted">
                <span>Subtotal</span><span>R${subtotal.toFixed(2)}</span>
              </div>
              {descontoCalculado > 0 && (
                <div className="flex justify-between text-body-sm text-danger">
                  <span>Desconto</span><span>−R${descontoCalculado.toFixed(2)}</span>
                </div>
              )}
              <div className="flex justify-between text-body-lg font-bold text-fg border-t border-border pt-1">
                <span>Total</span><span>R${total.toFixed(2)}</span>
              </div>
            </div>

            <Field label="Observações (opcional)">
              <textarea
                value={state.observacoes}
                onChange={e => setState(s => ({ ...s, observacoes: e.target.value }))}
                rows={2}
                placeholder="Anotações sobre a venda…"
                className="w-full px-3 py-2 bg-bg-elevated border border-border rounded-md text-body-md text-fg placeholder:text-fg-muted outline-none focus:border-tom transition-colors resize-none"
              />
            </Field>

            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={state.viawpp}
                onChange={e => setState(s => ({ ...s, viawpp: e.target.checked }))}
                className="w-4 h-4 accent-tom"
              />
              <span className="text-body-md text-fg">Notificar cliente via WhatsApp</span>
            </label>

            <div className="flex gap-2">
              <Button variant="secondary" onClick={() => setState(s => ({ ...s, step: 2 }))}>← Voltar</Button>
              <Button
                fullWidth
                loading={state.saving}
                disabled={!canSubmit}
                onClick={handleSubmit}
              >
                Finalizar venda · R${total.toFixed(2)}
              </Button>
            </div>
          </div>
        )}
      </div>
    </BottomSheet>
  );
}
