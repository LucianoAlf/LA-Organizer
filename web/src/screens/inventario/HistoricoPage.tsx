// Lojinha UI Hub — Histórico de vendas como página standalone.
import { useState, useMemo } from 'react';
import { PageHeader } from '../../components/PageHeader';
import { LoadingState } from '../../components/LoadingState';
import { EmptyState } from '../../components/EmptyState';
import { BottomSheet } from '../../components/BottomSheet';
import { Field } from '../../components/Field';
import { CustomSelect } from '../../components/CustomSelect';
import { Button } from '../../components/Button';
import { UnidadeChip } from '../../components/UnidadeChip';
import { ChipFilterRow } from '../../components/ChipFilterRow';
import { EstornoConfirmSheet } from './components/EstornoConfirmSheet';
import { useUnidadeSelecionada } from '../../hooks/useUnidadeSelecionada';
import { useHistoricoVendas } from '../../hooks/useLaReport';
import type { HistoricoVenda } from '../../hooks/useLaReport';

type Periodo = '7' | '30' | '90';
type StatusFiltro = 'todas' | 'ativa' | 'estornada';

function brl(n: number): string {
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function fmtData(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function clienteLabel(v: HistoricoVenda): string {
  if (v.loja_alunos?.nome) return v.loja_alunos.nome;
  if (v.cliente_nome) return v.cliente_nome;
  return 'Avulso';
}

export function HistoricoPage() {
  const { unidadeId } = useUnidadeSelecionada();
  const [periodo, setPeriodo] = useState<Periodo>('30');
  const [status, setStatus] = useState<StatusFiltro>('ativa');
  const [forma, setForma] = useState<string>('');
  const [filtrosOpen, setFiltrosOpen] = useState(false);
  const [vendaSelecionada, setVendaSelecionada] = useState<HistoricoVenda | null>(null);

  const { data: vendas = [], isLoading } = useHistoricoVendas(unidadeId || '', {
    dias: Number(periodo),
    status,
    formaPagamento: forma || undefined,
    limit: 200,
  });

  const total = useMemo(
    () => vendas.filter(v => v.status === 'ativa').reduce((s, v) => s + Number(v.total ?? 0), 0),
    [vendas],
  );

  return (
    <div className="space-y-md pb-xl">
      <div className="flex items-center justify-between gap-sm">
        <PageHeader title="📊 Histórico" backTo={`/inventario/loja?unit=${unidadeId ?? ''}`} />
        <UnidadeChip />
      </div>

      <ChipFilterRow
        items={[
          { id: '30', label: '30 dias' },
          { id: '7', label: '7d' },
          { id: '90', label: '90d' },
        ]}
        activeId={periodo}
        onChange={id => setPeriodo(id as Periodo)}
        extra={
          <button
            type="button"
            onClick={() => setFiltrosOpen(true)}
            className="whitespace-nowrap rounded-full px-3 py-1.5 text-body-sm border bg-bg-surface text-fg-muted border-border hover:border-tom/50"
          >
            Filtros ⚙
          </button>
        }
      />

      <div className="text-body-sm text-fg-muted">
        <strong className="text-fg">
          {vendas.length} venda{vendas.length !== 1 ? 's' : ''}
        </strong>{' '}
        · {brl(total)}
      </div>

      {isLoading ? (
        <LoadingState />
      ) : vendas.length === 0 ? (
        <EmptyState icon={<span>📊</span>} title="Sem vendas" description="Nenhuma venda no período." />
      ) : (
        <div className="space-y-2">
          {vendas.map(v => {
            const estornada = v.status === 'estornada';
            const itens = v.loja_venda_itens || [];
            const primeiro = itens[0];
            const nomeProd =
              (primeiro as any)?.produto_nome ??
              primeiro?.loja_produtos?.nome ??
              (primeiro ? `Produto #${primeiro.produto_id}` : '(sem itens)');
            const cliente = clienteLabel(v);
            const qtd = primeiro?.quantidade ?? 0;
            return (
              <button
                key={v.id}
                type="button"
                onClick={() => !estornada && setVendaSelecionada(v)}
                disabled={estornada}
                className={[
                  'w-full text-left bg-bg-surface border border-border rounded-xl p-md flex items-center gap-3',
                  estornada ? 'opacity-50 cursor-not-allowed' : 'hover:border-tom/40',
                ].join(' ')}
              >
                <div className="text-xl">{estornada ? '↩️' : '💰'}</div>
                <div className="flex-1 min-w-0">
                  <div className="text-fg font-medium truncate">
                    {qtd}× {nomeProd} · {cliente}
                  </div>
                  <div className="text-fg-muted text-body-sm">
                    {fmtData(v.data_venda)} ·{' '}
                    <span className="inline-block px-2 py-0.5 rounded-md bg-bg-app text-xs">
                      {v.forma_pagamento?.toUpperCase()}
                    </span>{' '}
                    <span className="inline-block px-2 py-0.5 rounded-md bg-bg-app text-xs">#{v.id}</span>
                    {estornada && (
                      <span className="ml-1 inline-block px-2 py-0.5 rounded-md bg-danger/20 text-danger text-xs">
                        ESTORNADA
                      </span>
                    )}
                  </div>
                </div>
                <div className={`tabular-nums shrink-0 ${estornada ? 'line-through' : ''}`}>
                  {brl(Number(v.total ?? 0))}
                </div>
              </button>
            );
          })}
        </div>
      )}

      <BottomSheet open={filtrosOpen} onClose={() => setFiltrosOpen(false)} title="Filtros">
        <div className="space-y-md">
          <Field label="Status">
            <CustomSelect
              value={status}
              options={[
                { value: 'ativa', label: 'Ativas' },
                { value: 'estornada', label: 'Estornadas' },
                { value: 'todas', label: 'Todas' },
              ]}
              onChange={v => setStatus(v as StatusFiltro)}
            />
          </Field>
          <Field label="Forma de pagamento">
            <CustomSelect
              value={forma}
              options={[
                { value: '', label: 'Todas as formas' },
                { value: 'pix', label: 'PIX' },
                { value: 'dinheiro', label: 'Dinheiro' },
                { value: 'debito', label: 'Débito' },
                { value: 'credito', label: 'Crédito' },
                { value: 'folha', label: 'Folha' },
                { value: 'saldo', label: 'Saldo' },
              ]}
              onChange={setForma}
            />
          </Field>
          <Button variant="primary" fullWidth onClick={() => setFiltrosOpen(false)}>
            Aplicar
          </Button>
        </div>
      </BottomSheet>

      <EstornoConfirmSheet
        open={!!vendaSelecionada}
        onClose={() => setVendaSelecionada(null)}
        venda={vendaSelecionada}
      />
    </div>
  );
}
