// Sprint Fase 2.3 — Lista de reservas + ações finalizar/cancelar.
import { useState, useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Tabs } from '../../../components/Tabs';
import { Button } from '../../../components/Button';
import { Field } from '../../../components/Field';
import { CustomSelect } from '../../../components/CustomSelect';
import { BottomSheet } from '../../../components/BottomSheet';
import { LoadingState } from '../../../components/LoadingState';
import { EmptyState } from '../../../components/EmptyState';
import { showToast } from '../../../components/Toast';
import { useReservas } from '../../../hooks/useLaReport';
import type { ReportReserva } from '../../../hooks/useLaReport';
import { cancelarReserva, finalizarReserva } from '../../../lib/lareport-mutations';

interface Props {
  unidadeId: string;
}

type TabId = 'ativa' | 'finalizada' | 'arquivadas';

function diasAteHoje(prazoYmd: string): number {
  try {
    const hoje = new Date();
    hoje.setHours(0, 0, 0, 0);
    const [y, m, d] = prazoYmd.slice(0, 10).split('-').map(Number);
    const prazo = new Date(y, (m || 1) - 1, d || 1);
    prazo.setHours(0, 0, 0, 0);
    return Math.round((prazo.getTime() - hoje.getTime()) / 86_400_000);
  } catch {
    return 0;
  }
}

function fmtDataBR(iso: string): string {
  try {
    const [y, m, d] = iso.slice(0, 10).split('-');
    return `${d}/${m}/${y}`;
  } catch {
    return iso;
  }
}

const FORMA_OPTS = [
  { value: 'pix', label: 'Pix' },
  { value: 'dinheiro', label: 'Dinheiro' },
  { value: 'debito', label: 'Débito' },
  { value: 'credito', label: 'Crédito' },
  { value: 'folha', label: 'Folha' },
  { value: 'saldo', label: 'Saldo' },
];

interface FinalizarSheetProps {
  open: boolean;
  onClose: () => void;
  reserva: ReportReserva | null;
}

function FinalizarSheet({ open, onClose, reserva }: FinalizarSheetProps) {
  const qc = useQueryClient();
  const [forma, setForma] = useState<string>('pix');
  const [preco, setPreco] = useState<string>('');
  const [saving, setSaving] = useState(false);

  const precoNum = Number(preco);
  const canSubmit = !saving && reserva != null && Number.isFinite(precoNum) && precoNum > 0 && forma.length > 0;

  async function handle() {
    if (!reserva || !canSubmit) return;
    setSaving(true);
    try {
      const r = await finalizarReserva({
        reserva_id: reserva.id,
        forma_pagamento: forma as 'pix' | 'dinheiro' | 'debito' | 'credito' | 'folha' | 'saldo',
        preco_unitario: precoNum,
      });
      qc.invalidateQueries({ queryKey: ['lareport', 'reservas'] });
      qc.invalidateQueries({ queryKey: ['lareport', 'loja'] });
      qc.invalidateQueries({ queryKey: ['lareport', 'historico-vendas'] });
      showToast({ kind: 'success', title: `Venda #${r.venda_id} registrada`, msg: 'Reserva finalizada.' });
      onClose();
      setPreco('');
    } catch (e) {
      showToast({ kind: 'error', title: 'Falha ao finalizar', msg: e instanceof Error ? e.message : String(e) });
    } finally {
      setSaving(false);
    }
  }

  return (
    <BottomSheet open={open} onClose={onClose} title={reserva ? `Finalizar reserva #${reserva.id}` : 'Finalizar'}>
      <div className="space-y-md">
        {reserva && (
          <div className="bg-bg-elevated border border-border rounded-md p-md text-body-sm space-y-1">
            <div className="flex justify-between"><span className="text-fg-muted">Cliente</span><span className="text-fg">{reserva.cliente_nome}</span></div>
            <div className="flex justify-between"><span className="text-fg-muted">Produto</span><span className="text-fg">{reserva.loja_produtos?.nome ?? `#${reserva.produto_id}`}</span></div>
            <div className="flex justify-between"><span className="text-fg-muted">Quantidade</span><span className="text-fg tabular-nums">{reserva.quantidade}</span></div>
          </div>
        )}

        <Field label="Forma de pagamento">
          <CustomSelect value={forma} options={FORMA_OPTS} onChange={setForma} />
        </Field>

        <Field label="Preço unitário (R$)" sub="O total será preço × quantidade.">
          <input
            type="number"
            min={0}
            step={0.01}
            value={preco}
            onChange={e => setPreco(e.target.value)}
            placeholder="0,00"
            className="w-full bg-bg-surface border border-border rounded-md p-2 text-fg focus:outline-none focus:border-tom"
          />
        </Field>

        <div className="flex gap-sm pt-1">
          <Button variant="ghost" size="md" fullWidth onClick={onClose} disabled={saving}>Cancelar</Button>
          <Button variant="primary" size="md" fullWidth onClick={handle} disabled={!canSubmit} loading={saving}>
            Finalizar venda
          </Button>
        </div>
      </div>
    </BottomSheet>
  );
}

export function ReservasView({ unidadeId }: Props) {
  const qc = useQueryClient();
  const [tab, setTab] = useState<TabId>('ativa');

  // 'arquivadas' = expirada + cancelada → buscar 'todas' e filtrar localmente.
  const queryStatus = tab === 'arquivadas' ? 'todas' : tab;
  const { data: all = [], isLoading, error } = useReservas(unidadeId, queryStatus);

  const reservas = useMemo(() => {
    if (tab !== 'arquivadas') return all;
    return all.filter(r => r.status === 'cancelada' || r.status === 'expirada');
  }, [all, tab]);

  const [finalizando, setFinalizando] = useState<ReportReserva | null>(null);

  async function handleCancelar(r: ReportReserva) {
    if (!window.confirm(`Cancelar reserva #${r.id} de ${r.cliente_nome}?`)) return;
    const motivo = window.prompt('Motivo do cancelamento (opcional):') || undefined;
    try {
      await cancelarReserva(r.id, motivo);
      qc.invalidateQueries({ queryKey: ['lareport', 'reservas'] });
      qc.invalidateQueries({ queryKey: ['lareport', 'loja'] });
      showToast({ kind: 'success', title: `Reserva #${r.id} cancelada` });
    } catch (e) {
      showToast({ kind: 'error', title: 'Falha ao cancelar', msg: e instanceof Error ? e.message : String(e) });
    }
  }

  return (
    <div className="space-y-md">
      <Tabs<TabId>
        tabs={[
          { id: 'ativa', label: 'Ativas' },
          { id: 'finalizada', label: 'Finalizadas' },
          { id: 'arquivadas', label: 'Canceladas/Expiradas' },
        ]}
        active={tab}
        onChange={setTab}
      />

      {error ? (
        <div className="bg-danger/10 border border-danger/40 rounded-md p-md text-body-sm text-danger">
          Erro ao carregar reservas: {(error as Error).message}
        </div>
      ) : isLoading ? (
        <LoadingState />
      ) : reservas.length === 0 ? (
        <EmptyState icon={<span>🔖</span>} title="Sem reservas" description="Nada por aqui no momento." />
      ) : (
        <div className="space-y-2">
          {reservas.map(r => {
            const ndays = diasAteHoje(r.prazo);
            const vencida = ndays < 0 && r.status === 'ativa';
            return (
              <div key={r.id} className="bg-bg-surface border border-border rounded-md p-md space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="text-body-md font-semibold text-fg truncate">{r.cliente_nome}</div>
                    <div className="text-body-sm text-fg truncate">
                      {r.loja_produtos?.nome ?? `Produto #${r.produto_id}`} · <span className="tabular-nums">{r.quantidade}x</span>
                    </div>
                    {r.observacoes && (
                      <div className="text-body-sm text-fg-muted italic mt-0.5 line-clamp-2">{r.observacoes}</div>
                    )}
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-body-sm text-fg-muted tabular-nums">Prazo: {fmtDataBR(r.prazo)}</div>
                    {r.status === 'ativa' && (
                      <span className={[
                        'text-[10px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wide',
                        vencida ? 'bg-danger/20 text-danger' : ndays <= 2 ? 'bg-warning/20 text-warning' : 'bg-bg-elevated text-fg-muted',
                      ].join(' ')}>
                        {vencida ? `Vencida há ${Math.abs(ndays)}d` : ndays === 0 ? 'Vence hoje' : `Vence em ${ndays}d`}
                      </span>
                    )}
                    {r.status === 'finalizada' && (
                      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wide bg-success/20 text-success">
                        Finalizada
                      </span>
                    )}
                    {r.status === 'cancelada' && (
                      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wide bg-danger/20 text-danger">
                        Cancelada
                      </span>
                    )}
                    {r.status === 'expirada' && (
                      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wide bg-fg-muted/20 text-fg-muted">
                        Expirada
                      </span>
                    )}
                  </div>
                </div>

                {r.status === 'ativa' && (
                  <div className="flex gap-2 pt-1">
                    <Button variant="primary" size="sm" onClick={() => setFinalizando(r)}>
                      Finalizar (vender)
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => handleCancelar(r)}>
                      Cancelar
                    </Button>
                  </div>
                )}

                {r.status === 'cancelada' && r.motivo_cancelamento && (
                  <div className="text-body-sm text-fg-muted">
                    <strong>Motivo:</strong> {r.motivo_cancelamento}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <FinalizarSheet
        open={finalizando !== null}
        onClose={() => setFinalizando(null)}
        reserva={finalizando}
      />
    </div>
  );
}
