// Sprint Fase 2.3 — Histórico de vendas com filtros + click → estorno.
import { useState, useMemo } from 'react';
import { CustomSelect } from '../../../components/CustomSelect';
import { LoadingState } from '../../../components/LoadingState';
import { EmptyState } from '../../../components/EmptyState';
import { useHistoricoVendas } from '../../../hooks/useLaReport';
import type { HistoricoVenda } from '../../../hooks/useLaReport';
import { EstornoConfirmSheet } from './EstornoConfirmSheet';

interface Props {
  unidadeId: string;
}

const STATUS_OPTS = [
  { value: 'todas', label: 'Todas' },
  { value: 'ativa', label: 'Ativas' },
  { value: 'estornada', label: 'Estornadas' },
];

const FORMA_OPTS = [
  { value: '', label: 'Todas as formas' },
  { value: 'pix', label: 'Pix' },
  { value: 'dinheiro', label: 'Dinheiro' },
  { value: 'debito', label: 'Débito' },
  { value: 'credito', label: 'Crédito' },
  { value: 'folha', label: 'Folha' },
  { value: 'saldo', label: 'Saldo' },
];

const DIAS_OPTS = [
  { value: '7', label: 'Últimos 7 dias' },
  { value: '30', label: 'Últimos 30 dias' },
  { value: '90', label: 'Últimos 90 dias' },
];

function brl(v: number): string {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function fmtDataHora(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  } catch {
    return iso;
  }
}

function resumoItens(venda: HistoricoVenda): string {
  const itens = venda.loja_venda_itens || [];
  if (itens.length === 0) return '(sem itens)';
  const first = itens[0];
  const nome = first.loja_produtos?.nome ?? `Produto #${first.produto_id}`;
  const head = `${first.quantidade}x ${nome}`;
  if (itens.length === 1) return head;
  return `${head} + ${itens.length - 1} outro${itens.length - 1 > 1 ? 's' : ''}`;
}

function clienteLabel(venda: HistoricoVenda): string | null {
  if (venda.loja_alunos?.nome) return `Aluno: ${venda.loja_alunos.nome}`;
  if (venda.cliente_nome) return `Cliente: ${venda.cliente_nome}`;
  if (venda.tipo_cliente === 'avulso') return 'Avulso';
  return null;
}

export function HistoricoVendasView({ unidadeId }: Props) {
  const [status, setStatus] = useState<'todas' | 'ativa' | 'estornada'>('todas');
  const [forma, setForma] = useState<string>('');
  const [dias, setDias] = useState<string>('30');
  const [vendaSel, setVendaSel] = useState<HistoricoVenda | null>(null);

  const { data: vendas = [], isLoading, error } = useHistoricoVendas(unidadeId, {
    status,
    formaPagamento: forma || undefined,
    dias: Number(dias),
    limit: 200,
  });

  const totalAtivas = useMemo(
    () => vendas.filter(v => v.status === 'ativa').reduce((s, v) => s + Number(v.total || 0), 0),
    [vendas],
  );

  return (
    <div className="space-y-md">
      {/* Filtros */}
      <div className="grid grid-cols-1 gap-sm md:grid-cols-3">
        <CustomSelect
          value={status}
          options={STATUS_OPTS}
          onChange={v => setStatus(v as 'todas' | 'ativa' | 'estornada')}
          placeholder="Status"
          size="sm"
        />
        <CustomSelect
          value={forma}
          options={FORMA_OPTS}
          onChange={setForma}
          placeholder="Forma de pagamento"
          size="sm"
        />
        <CustomSelect
          value={dias}
          options={DIAS_OPTS}
          onChange={setDias}
          placeholder="Período"
          size="sm"
        />
      </div>

      {/* Sumário */}
      {!isLoading && vendas.length > 0 && (
        <div className="text-body-sm text-fg-muted">
          {vendas.length} venda{vendas.length > 1 ? 's' : ''} · Ativas: <span className="font-semibold text-fg">{brl(totalAtivas)}</span>
        </div>
      )}

      {error ? (
        <div className="bg-danger/10 border border-danger/40 rounded-md p-md text-body-sm text-danger">
          Erro ao carregar histórico: {(error as Error).message}
        </div>
      ) : isLoading ? (
        <LoadingState />
      ) : vendas.length === 0 ? (
        <EmptyState icon={<span>🧾</span>} title="Sem vendas" description="Nenhuma venda no período selecionado." />
      ) : (
        <div className="space-y-2">
          {vendas.map(v => {
            const isEstornada = v.status === 'estornada';
            const cliente = clienteLabel(v);
            return (
              <button
                key={v.id}
                type="button"
                onClick={() => setVendaSel(v)}
                className={[
                  'w-full text-left bg-bg-surface border rounded-md p-md transition-colors',
                  'hover:bg-bg-elevated focus-ring',
                  isEstornada ? 'border-danger/40 opacity-75' : 'border-border',
                ].join(' ')}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-body-md font-semibold text-fg">{brl(Number(v.total || 0))}</span>
                      <span className="text-body-sm text-fg-muted uppercase">{v.forma_pagamento}</span>
                      {isEstornada && (
                        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-danger/20 text-danger uppercase tracking-wide">
                          Estornada
                        </span>
                      )}
                    </div>
                    <p className="text-body-sm text-fg mt-0.5 truncate">{resumoItens(v)}</p>
                    {v.loja_professores?.nome && (
                      <p className="text-body-sm text-fg-muted truncate">Prof: {v.loja_professores.nome}</p>
                    )}
                    {cliente && (
                      <p className="text-body-sm text-fg-muted truncate">{cliente}</p>
                    )}
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-body-sm text-fg-muted tabular-nums">{fmtDataHora(v.data_venda)}</div>
                    <div className="text-body-sm text-fg-muted">#{v.id}</div>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}

      <EstornoConfirmSheet
        open={vendaSel !== null}
        onClose={() => setVendaSel(null)}
        venda={vendaSel}
      />
    </div>
  );
}
