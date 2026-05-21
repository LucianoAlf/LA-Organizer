// Lojinha UI Hub — Página standalone de reservas.
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { PageHeader } from '../../components/PageHeader';
import { LoadingState } from '../../components/LoadingState';
import { EmptyState } from '../../components/EmptyState';
import { Fab } from '../../components/Fab';
import { BottomSheet } from '../../components/BottomSheet';
import { Button } from '../../components/Button';
import { Field } from '../../components/Field';
import { CustomSelect } from '../../components/CustomSelect';
import { UnidadeChip } from '../../components/UnidadeChip';
import { ChipFilterRow } from '../../components/ChipFilterRow';
import { ReservaSheet } from './components/ReservaSheet';
import { useUnidadeSelecionada } from '../../hooks/useUnidadeSelecionada';
import { useReservas } from '../../hooks/useLaReport';
import type { ReportReserva } from '../../hooks/useLaReport';
import { cancelarReserva, finalizarReserva } from '../../lib/lareport-mutations';
import { showToast } from '../../components/Toast';

type StatusFiltro = 'ativa' | 'finalizada' | 'arquivada';

const FORMA_OPTS = [
  { value: 'pix', label: 'Pix' },
  { value: 'dinheiro', label: 'Dinheiro' },
  { value: 'debito', label: 'Débito' },
  { value: 'credito', label: 'Crédito' },
  { value: 'folha', label: 'Folha' },
  { value: 'saldo', label: 'Saldo' },
];

function diasAteHoje(prazoYmd: string | null): number | null {
  if (!prazoYmd) return null;
  try {
    const hoje = new Date();
    hoje.setHours(0, 0, 0, 0);
    const [y, m, d] = prazoYmd.slice(0, 10).split('-').map(Number);
    const prazo = new Date(y, (m || 1) - 1, d || 1);
    prazo.setHours(0, 0, 0, 0);
    return Math.round((prazo.getTime() - hoje.getTime()) / 86_400_000);
  } catch {
    return null;
  }
}

function fmtDataBR(iso: string | null): string {
  if (!iso) return '—';
  try {
    const [y, m, d] = iso.slice(0, 10).split('-');
    return `${d}/${m}/${y}`;
  } catch {
    return iso;
  }
}

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
  const canSubmit =
    !saving && reserva != null && Number.isFinite(precoNum) && precoNum > 0 && forma.length > 0;

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
      showToast({
        kind: 'error',
        title: 'Falha ao finalizar',
        msg: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title={reserva ? `Finalizar reserva #${reserva.id}` : 'Finalizar'}
    >
      <div className="space-y-md">
        {reserva && (
          <div className="bg-bg-elevated border border-border rounded-md p-md text-body-sm space-y-1">
            <div className="flex justify-between">
              <span className="text-fg-muted">Cliente</span>
              <span className="text-fg">{reserva.cliente_nome}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-fg-muted">Produto</span>
              <span className="text-fg">{reserva.loja_produtos?.nome ?? `#${reserva.produto_id}`}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-fg-muted">Quantidade</span>
              <span className="text-fg tabular-nums">{reserva.quantidade}</span>
            </div>
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
          <Button variant="ghost" size="md" fullWidth onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button
            variant="primary"
            size="md"
            fullWidth
            onClick={handle}
            disabled={!canSubmit}
            loading={saving}
          >
            Finalizar venda
          </Button>
        </div>
      </div>
    </BottomSheet>
  );
}

export function ReservasPage() {
  const qc = useQueryClient();
  const { unidadeId } = useUnidadeSelecionada();
  const [statusFiltro, setStatusFiltro] = useState<StatusFiltro>('ativa');
  const [reservaOpen, setReservaOpen] = useState(false);
  const [finalizando, setFinalizando] = useState<ReportReserva | null>(null);

  const queryStatus = statusFiltro === 'arquivada' ? 'todas' : statusFiltro;
  const { data: reservas = [], isLoading } = useReservas(unidadeId || '', queryStatus as any);

  const visiveis =
    statusFiltro === 'arquivada'
      ? reservas.filter(r => r.status === 'cancelada' || r.status === 'expirada')
      : reservas;

  const counts = {
    ativa: reservas.filter(r => r.status === 'ativa').length,
    finalizada: reservas.filter(r => r.status === 'finalizada').length,
    arquivada: reservas.filter(r => r.status === 'cancelada' || r.status === 'expirada').length,
  };

  async function handleCancelar(r: ReportReserva) {
    if (!window.confirm(`Cancelar reserva #${r.id} de ${r.cliente_nome}?`)) return;
    const motivo = window.prompt('Motivo do cancelamento (opcional):') || undefined;
    try {
      await cancelarReserva(r.id, motivo);
      qc.invalidateQueries({ queryKey: ['lareport', 'reservas'] });
      qc.invalidateQueries({ queryKey: ['lareport', 'loja'] });
      showToast({ kind: 'success', title: `Reserva #${r.id} cancelada` });
    } catch (e) {
      showToast({
        kind: 'error',
        title: 'Falha ao cancelar',
        msg: e instanceof Error ? e.message : String(e),
      });
    }
  }

  return (
    <div className="space-y-md pb-xl">
      <div className="flex items-center justify-between gap-sm">
        <PageHeader title="🔖 Reservas" backTo={`/inventario/loja?unit=${unidadeId ?? ''}`} />
        <UnidadeChip />
      </div>

      <ChipFilterRow
        items={[
          { id: 'ativa', label: 'Ativas', count: counts.ativa },
          { id: 'finalizada', label: 'Finalizadas', count: counts.finalizada },
          { id: 'arquivada', label: 'Arquivadas', count: counts.arquivada },
        ]}
        activeId={statusFiltro}
        onChange={id => setStatusFiltro(id as StatusFiltro)}
      />

      {isLoading ? (
        <LoadingState />
      ) : visiveis.length === 0 ? (
        <EmptyState icon={<span>🔖</span>} title="Sem reservas" description="Nada por aqui." />
      ) : (
        <div className="space-y-2">
          {visiveis.map(r => {
            const ndays = diasAteHoje(r.prazo);
            const vencida = ndays !== null && ndays < 0 && r.status === 'ativa';
            const vencimentoLabel =
              r.status === 'ativa'
                ? ndays === null
                  ? '—'
                  : vencida
                    ? `Vencida há ${Math.abs(ndays)}d`
                    : ndays === 0
                      ? 'Vence hoje'
                      : `Vence em ${ndays}d`
                : r.status === 'finalizada'
                  ? 'Finalizada'
                  : r.status === 'cancelada'
                    ? 'Cancelada'
                    : 'Expirada';
            const vencimentoCls =
              r.status === 'ativa'
                ? vencida
                  ? 'bg-danger/20 text-danger'
                  : ndays !== null && ndays <= 2
                    ? 'bg-warning/20 text-warning'
                    : 'bg-bg-app text-fg-muted'
                : r.status === 'finalizada'
                  ? 'bg-success/20 text-success'
                  : 'bg-bg-app text-fg-muted';
            const produtoNome = r.loja_produtos?.nome ?? `Produto #${r.produto_id}`;
            const cliente = r.cliente_nome ?? '—';
            return (
              <div key={r.id} className="bg-bg-surface border border-border rounded-xl p-md">
                <div className="flex items-center gap-3">
                  <div className="text-xl">🔖</div>
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-fg truncate">
                      {cliente} · {r.quantidade}×
                    </div>
                    <div className="text-body-sm text-fg-muted truncate">{produtoNome}</div>
                  </div>
                  <span className={`text-[10px] font-semibold px-2 py-1 rounded-md uppercase tracking-wide ${vencimentoCls}`}>
                    {vencimentoLabel}
                  </span>
                </div>
                {r.status === 'ativa' && (
                  <div className="flex gap-2 mt-3 pt-3 border-t border-border items-center">
                    <Button variant="primary" size="sm" onClick={() => setFinalizando(r)}>
                      Finalizar
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => handleCancelar(r)}>
                      Cancelar
                    </Button>
                    <span className="flex-1 text-right text-body-sm text-fg-muted">
                      Prazo: {fmtDataBR(r.prazo)}
                    </span>
                  </div>
                )}
                {r.status === 'cancelada' && r.motivo_cancelamento && (
                  <div className="text-body-sm text-fg-muted mt-2">
                    <strong>Motivo:</strong> {r.motivo_cancelamento}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <Fab label="Reserva" ariaLabel="Criar reserva" onClick={() => setReservaOpen(true)} />
      <ReservaSheet
        open={reservaOpen}
        onClose={() => setReservaOpen(false)}
        unidadeId={unidadeId || ''}
      />

      <FinalizarSheet
        open={finalizando !== null}
        onClose={() => setFinalizando(null)}
        reserva={finalizando}
      />
    </div>
  );
}
