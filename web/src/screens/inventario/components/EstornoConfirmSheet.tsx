// Sprint Fase 2.3 — Confirma estorno de venda (visualiza + exige motivo).
import { useState, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { BottomSheet } from '../../../components/BottomSheet';
import { Button } from '../../../components/Button';
import { Field } from '../../../components/Field';
import { showToast } from '../../../components/Toast';
import { estornarVenda } from '../../../lib/lareport-mutations';
import type { HistoricoVenda } from '../../../hooks/useLaReport';

interface Props {
  open: boolean;
  onClose: () => void;
  venda: HistoricoVenda | null;
}

function brl(v: number): string {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function fmtData(iso: string): string {
  try {
    return new Date(iso).toLocaleString('pt-BR');
  } catch {
    return iso;
  }
}

export function EstornoConfirmSheet({ open, onClose, venda }: Props) {
  const qc = useQueryClient();
  const [motivo, setMotivo] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) {
      setMotivo('');
      setSaving(false);
    }
  }, [open]);

  if (!venda) {
    return (
      <BottomSheet open={open} onClose={onClose} title="Estorno">
        <p className="text-body-sm text-fg-muted">Nenhuma venda selecionada.</p>
      </BottomSheet>
    );
  }

  const isEstornada = venda.status === 'estornada';
  const motivoTrim = motivo.trim();
  const motivoInvalido = motivoTrim.length > 0 && (motivoTrim.length < 5 || motivoTrim.length > 500);
  const canConfirm = !isEstornada && motivoTrim.length >= 5 && motivoTrim.length <= 500 && !saving;

  async function handleConfirm() {
    if (!venda || !canConfirm) return;
    setSaving(true);
    try {
      await estornarVenda(venda.id, motivoTrim);
      qc.invalidateQueries({ queryKey: ['lareport', 'historico-vendas'] });
      qc.invalidateQueries({ queryKey: ['lareport', 'loja'] });
      qc.invalidateQueries({ queryKey: ['lareport', 'alertas'] });
      showToast({ kind: 'success', title: `Venda #${venda.id} estornada`, msg: 'Estoque devolvido.' });
      onClose();
    } catch (e) {
      showToast({ kind: 'error', title: 'Falha ao estornar', msg: e instanceof Error ? e.message : String(e) });
    } finally {
      setSaving(false);
    }
  }

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title={isEstornada ? `Venda #${venda.id} (estornada)` : `Estornar venda #${venda.id}`}
    >
      <div className="space-y-md">
        {/* Resumo */}
        <div className="bg-bg-elevated border border-border rounded-md p-md space-y-1 text-body-sm">
          <div className="flex justify-between">
            <span className="text-fg-muted">Data</span>
            <span className="text-fg tabular-nums">{fmtData(venda.data_venda)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-fg-muted">Total</span>
            <span className="text-fg font-semibold">{brl(Number(venda.total || 0))}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-fg-muted">Forma</span>
            <span className="text-fg uppercase">{venda.forma_pagamento}</span>
          </div>
          {venda.loja_alunos?.nome && (
            <div className="flex justify-between">
              <span className="text-fg-muted">Aluno</span>
              <span className="text-fg">{venda.loja_alunos.nome}</span>
            </div>
          )}
          {venda.cliente_nome && !venda.loja_alunos?.nome && (
            <div className="flex justify-between">
              <span className="text-fg-muted">Cliente</span>
              <span className="text-fg">{venda.cliente_nome}</span>
            </div>
          )}
          {venda.loja_professores?.nome && (
            <div className="flex justify-between">
              <span className="text-fg-muted">Professor</span>
              <span className="text-fg">{venda.loja_professores.nome}</span>
            </div>
          )}
        </div>

        {/* Itens */}
        <div className="border border-border rounded-md divide-y divide-border">
          {(venda.loja_venda_itens || []).map((it, i) => (
            <div key={i} className="px-md py-2 flex justify-between items-center text-body-sm">
              <div className="min-w-0">
                <div className="text-fg truncate">{(it as any).produto_nome ?? it.loja_produtos?.nome ?? `Produto #${it.produto_id}`}</div>
                {it.loja_produtos?.sku && (
                  <div className="text-fg-muted text-[11px]">{it.loja_produtos.sku}</div>
                )}
              </div>
              <div className="text-fg tabular-nums shrink-0 ml-2">
                {it.quantidade} × {brl(Number(it.preco_unitario || 0))}
              </div>
            </div>
          ))}
        </div>

        {isEstornada ? (
          <div className="bg-danger/10 border border-danger/40 rounded-md p-md text-body-sm">
            <div className="font-semibold text-danger mb-1">Venda já estornada</div>
            {venda.estornada_em && (
              <div className="text-fg-muted">Em: {fmtData(venda.estornada_em)}</div>
            )}
            {venda.motivo_estorno && (
              <div className="text-fg mt-1"><strong>Motivo:</strong> {venda.motivo_estorno}</div>
            )}
          </div>
        ) : (
          <>
            <Field label="Motivo do estorno" sub="Mínimo 5 caracteres. Vai pro log de auditoria.">
              <textarea
                value={motivo}
                onChange={e => setMotivo(e.target.value)}
                rows={3}
                maxLength={500}
                placeholder="Ex.: cliente desistiu, produto com defeito, erro de cobrança…"
                className={[
                  'w-full bg-bg-surface border rounded-md p-2 text-body-md text-fg',
                  'focus:outline-none focus:border-tom resize-none',
                  motivoInvalido ? 'border-danger' : 'border-border',
                ].join(' ')}
              />
              <div className="text-[11px] text-fg-muted text-right tabular-nums">
                {motivoTrim.length}/500 (mín 5)
              </div>
            </Field>

            <div className="bg-danger/10 border border-danger/40 rounded-md p-md text-body-sm text-fg">
              ⚠️ <strong className="text-danger">Estoque será devolvido.</strong> Comissão
              do professor (se houver) será debitada da carteira. <strong>Ação irreversível.</strong>
            </div>

            <div className="flex gap-sm pt-1">
              <Button variant="ghost" size="md" fullWidth onClick={onClose} disabled={saving}>
                Cancelar
              </Button>
              <Button variant="danger" size="md" fullWidth onClick={handleConfirm} disabled={!canConfirm} loading={saving}>
                Confirmar estorno
              </Button>
            </div>
          </>
        )}
      </div>
    </BottomSheet>
  );
}
