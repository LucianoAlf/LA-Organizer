import { useState, useEffect, useMemo } from 'react';
import { PageHeader } from '../../components/PageHeader';
import { Tabs } from '../../components/Tabs';
import { StatCard } from '../../components/StatCard';
import { LoadingState } from '../../components/LoadingState';
import { EmptyState } from '../../components/EmptyState';
import { Fab } from '../../components/Fab';
import { useReportUnidades, useReportLoja } from '../../hooks/useLaReport';
import { ProdutoCard } from './components/ProdutoCard';
import { VendaSheet } from './components/VendaSheet';
import { EntradaEstoqueSheet } from './components/EntradaEstoqueSheet';

export function InventarioLojaPage() {
  const { data: unidades = [], isLoading: lU } = useReportUnidades();
  const [unidadeId, setUnidadeId] = useState<string>('');
  const [vendaOpen, setVendaOpen] = useState(false);
  const [entradaOpen, setEntradaOpen] = useState(false);

  useEffect(() => {
    if (!unidadeId && unidades.length > 0) {
      const barra = unidades.find(u => u.nome === 'Barra');
      setUnidadeId(barra?.id || unidades[0].id);
    }
  }, [unidades, unidadeId]);

  const { data: produtos = [], isLoading } = useReportLoja(unidadeId || null);
  const baixos = useMemo(() => produtos.filter(p => p.abaixo_minimo || p.zerado), [produtos]);
  const totalUnidades = useMemo(() => produtos.reduce((s, p) => s + p.estoque_atual, 0), [produtos]);
  const valorEstoque = useMemo(
    () => produtos.reduce((s, p) => s + p.estoque_atual * (p.custo ?? 0), 0),
    [produtos]
  );

  if (lU) return <LoadingState />;

  return (
    <div className="space-y-md pb-xl">
      <PageHeader title="🛍 Lojinha" backTo="/inventario" />

      <Tabs
        tabs={unidades.map(u => ({ id: u.id, label: u.nome }))}
        active={unidadeId}
        onChange={setUnidadeId}
      />

      {baixos.length > 0 && (
        <div className="bg-danger/10 border border-danger/40 border-l-4 rounded-md p-md text-body-sm">
          ⚠️ <strong className="text-danger">{baixos.length} produto{baixos.length > 1 ? 's' : ''} abaixo do estoque mínimo nesta unidade.</strong>
          <br />Tom já avisou na segunda. Pra encomendar: <code className="bg-bg-surface px-1 rounded">/loja encomenda</code>.
        </div>
      )}

      <div className="grid grid-cols-3 gap-sm">
        <StatCard label="Produtos" value={produtos.length} />
        <StatCard label="Unidades" value={totalUnidades} />
        <StatCard label="Valor estq." value={`R$${valorEstoque.toFixed(0)}`} />
      </div>

      <div className="flex items-center gap-sm">
        <h3 className="text-body-sm text-fg-muted font-semibold uppercase tracking-wide">Produtos</h3>
        <div className="flex-1 h-px bg-border" />
      </div>

      {isLoading ? (
        <LoadingState />
      ) : produtos.length === 0 ? (
        <EmptyState icon={<span>🛍</span>} title="Sem produtos" description="Nenhum produto cadastrado na lojinha." />
      ) : (
        <div className="space-y-2">
          {produtos.map(p => <ProdutoCard key={p.id} produto={p} />)}
        </div>
      )}

      <div className="bg-warning/10 border border-warning/40 rounded-md p-md text-body-sm text-fg-muted">
        💡 <strong className="text-fg">Recebeu mercadoria?</strong> Escreve no TOM "recebi 50 cadernos de violão pra Barra" ou use o botão abaixo.
      </div>

      {/* FAB Venda — direita (padrão do componente) */}
      <Fab
        onClick={() => setVendaOpen(true)}
        label="Venda"
        ariaLabel="Registrar venda"
      />

      {/* FAB Entrada de estoque — esquerda */}
      <button
        type="button"
        onClick={() => setEntradaOpen(true)}
        aria-label="Registrar entrada de estoque"
        className={[
          'fixed z-20 left-md md:left-lg',
          'bottom-[96px] md:bottom-md',
          'h-14 px-5 rounded-full bg-bg-surface border border-border text-fg shadow-soft',
          'hover:bg-bg-elevated active:bg-bg-app',
          'inline-flex items-center gap-2 font-semibold focus-ring',
        ].join(' ')}
        style={{ marginBottom: 'env(safe-area-inset-bottom)' }}
      >
        <span aria-hidden>📦</span>
        <span className="hidden sm:inline">Entrada</span>
      </button>

      <VendaSheet
        open={vendaOpen}
        onClose={() => setVendaOpen(false)}
        unidadeId={unidadeId}
      />

      <EntradaEstoqueSheet
        open={entradaOpen}
        onClose={() => setEntradaOpen(false)}
        unidadeId={unidadeId}
      />
    </div>
  );
}
