import { useState, useEffect, useMemo } from 'react';
import { PageHeader } from '../../components/PageHeader';
import { Tabs } from '../../components/Tabs';
import { StatCard } from '../../components/StatCard';
import { LoadingState } from '../../components/LoadingState';
import { EmptyState } from '../../components/EmptyState';
import { Fab } from '../../components/Fab';
import { useReportUnidades, useReportLoja } from '../../hooks/useLaReport';
import { useQueryClient } from '@tanstack/react-query';
import { ProdutoCard } from './components/ProdutoCard';
import { VendaWizardSheet } from './components/VendaWizardSheet';
import { EntradaRicaSheet } from './components/EntradaRicaSheet';
import { ProdutoFormSheet } from './components/ProdutoFormSheet';
import { TransferenciaSheet } from './components/TransferenciaSheet';
import { desativarProduto } from '../../lib/lareport-mutations';
import type { ReportProduto } from '../../lib/lareport-types';

export function InventarioLojaPage() {
  const qc = useQueryClient();
  const { data: unidades = [], isLoading: lU } = useReportUnidades();
  const [unidadeId, setUnidadeId] = useState<string>('');
  const [vendaOpen, setVendaOpen] = useState(false);
  const [entradaOpen, setEntradaOpen] = useState(false);
  const [produtoOpen, setProdutoOpen] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);
  const [editandoProduto, setEditandoProduto] = useState<ReportProduto | null>(null);

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
          {produtos.map(p => (
            <ProdutoCard
              key={p.id}
              produto={p}
              onEdit={() => { setEditandoProduto(p); setProdutoOpen(true); }}
              onDeactivate={async () => {
                if (!window.confirm('Desativar produto? Vendas antigas não mudam.')) return;
                try {
                  await desativarProduto(p.id);
                  qc.invalidateQueries({ queryKey: ['lareport', 'loja'] });
                } catch (e) {
                  alert(e instanceof Error ? e.message : 'Erro ao desativar.');
                }
              }}
            />
          ))}
        </div>
      )}

      <div className="bg-warning/10 border border-warning/40 rounded-md p-md text-body-sm text-fg-muted">
        💡 <strong className="text-fg">Recebeu mercadoria?</strong> Escreve no TOM "recebi 50 cadernos de violão pra Barra" ou use o botão abaixo.
      </div>

      {/* FAB com menu de 4 ações (Sprint Fase 2.2). */}
      <Fab
        label="Novo"
        ariaLabel="Nova operação na lojinha"
        actions={[
          { icon: '💰', label: 'Registrar venda', onClick: () => setVendaOpen(true) },
          { icon: '📦', label: 'Lançar entrada', onClick: () => setEntradaOpen(true) },
          { icon: '🆕', label: 'Cadastrar produto', onClick: () => { setEditandoProduto(null); setProdutoOpen(true); } },
          { icon: '🔄', label: 'Transferir estoque', onClick: () => setTransferOpen(true) },
        ]}
      />

      <VendaWizardSheet
        open={vendaOpen}
        onClose={() => setVendaOpen(false)}
        unidadeId={unidadeId}
      />

      <EntradaRicaSheet
        open={entradaOpen}
        onClose={() => setEntradaOpen(false)}
        unidadeId={unidadeId}
      />

      <ProdutoFormSheet
        open={produtoOpen}
        onClose={() => { setProdutoOpen(false); setEditandoProduto(null); }}
        mode={editandoProduto ? 'edit' : 'create'}
        produto={editandoProduto ? {
          id: editandoProduto.id,
          nome: editandoProduto.nome,
          sku: editandoProduto.sku,
          preco: editandoProduto.preco,
          custo: editandoProduto.custo,
          estoque_minimo: editandoProduto.estoque_minimo ?? undefined,
          foto_url: editandoProduto.foto_url,
          disponivel_whatsapp: editandoProduto.disponivel_whatsapp,
          ativo: editandoProduto.ativo,
        } : undefined}
        unidadeId={unidadeId}
      />

      <TransferenciaSheet
        open={transferOpen}
        onClose={() => setTransferOpen(false)}
        unidadeOrigem={unidadeId}
      />
    </div>
  );
}
