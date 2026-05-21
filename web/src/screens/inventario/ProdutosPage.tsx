import { useState, useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { PageHeader } from '../../components/PageHeader';
import { LoadingState } from '../../components/LoadingState';
import { EmptyState } from '../../components/EmptyState';
import { Fab } from '../../components/Fab';
import { UnidadeChip } from '../../components/UnidadeChip';
import { ChipFilterRow } from '../../components/ChipFilterRow';
import { ProdutoCard } from './components/ProdutoCard';
import { ProdutoFormSheet } from './components/ProdutoFormSheet';
import { useReportLoja } from '../../hooks/useLaReport';
import { useUnidadeSelecionada } from '../../hooks/useUnidadeSelecionada';
import { desativarProduto } from '../../lib/lareport-mutations';
import type { ReportProduto } from '../../lib/lareport-types';

type Filtro = 'todos' | 'baixo' | 'zerado';

export function ProdutosPage() {
  const qc = useQueryClient();
  const { unidadeId } = useUnidadeSelecionada();
  const { data: produtos = [], isLoading } = useReportLoja(unidadeId || null);
  const [filtro, setFiltro] = useState<Filtro>('todos');
  const [busca, setBusca] = useState('');
  const [produtoOpen, setProdutoOpen] = useState(false);
  const [editando, setEditando] = useState<ReportProduto | null>(null);

  const baixos = produtos.filter(p => p.abaixo_minimo);
  const zerados = produtos.filter(p => p.zerado);

  const visiveis = useMemo(() => {
    let lista: ReportProduto[] = produtos;
    if (filtro === 'baixo') lista = baixos;
    else if (filtro === 'zerado') lista = zerados;
    const q = busca.trim().toLowerCase();
    if (q.length >= 2) lista = lista.filter(p => p.nome.toLowerCase().includes(q) || (p.sku ?? '').toLowerCase().includes(q));
    return lista;
  }, [produtos, filtro, busca, baixos, zerados]);

  return (
    <div className="space-y-md pb-xl">
      <div className="flex items-center justify-between gap-sm">
        <PageHeader title="📦 Produtos" backTo={`/inventario/loja?unit=${unidadeId}`} />
        <UnidadeChip />
      </div>

      <input
        type="search"
        inputMode="search"
        placeholder="Buscar produto..."
        value={busca}
        onChange={e => setBusca(e.target.value)}
        className="w-full bg-bg-surface border border-border rounded-md p-2 text-fg focus:outline-none focus:border-tom"
      />

      <ChipFilterRow
        items={[
          { id: 'todos',  label: 'Todos',         count: produtos.length },
          { id: 'baixo',  label: 'Estoque baixo', count: baixos.length },
          { id: 'zerado', label: 'Sem estoque',   count: zerados.length },
        ]}
        activeId={filtro}
        onChange={id => setFiltro(id as Filtro)}
      />

      {isLoading ? (
        <LoadingState />
      ) : visiveis.length === 0 ? (
        <EmptyState icon={<span>📦</span>} title="Sem produtos" description="Nenhum produto encontrado." />
      ) : (
        <div className="space-y-2">
          {visiveis.map(p => (
            <ProdutoCard
              key={p.id}
              produto={p}
              onEdit={() => { setEditando(p); setProdutoOpen(true); }}
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

      <Fab label="Cadastrar" ariaLabel="Cadastrar produto" onClick={() => { setEditando(null); setProdutoOpen(true); }} />

      <ProdutoFormSheet
        open={produtoOpen}
        onClose={() => { setProdutoOpen(false); setEditando(null); }}
        mode={editando ? 'edit' : 'create'}
        produto={editando ? {
          id: editando.id,
          nome: editando.nome,
          sku: editando.sku ?? '',
          preco: editando.preco,
          custo: editando.custo,
          estoque_minimo: editando.estoque_minimo ?? undefined,
          foto_url: editando.foto_url ?? '',
          disponivel_whatsapp: editando.disponivel_whatsapp,
          ativo: editando.ativo,
        } : undefined}
        unidadeId={unidadeId || undefined}
      />
    </div>
  );
}
