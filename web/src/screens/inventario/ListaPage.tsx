import { useState, useMemo, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { PageHeader } from '../../components/PageHeader';
import { Tabs } from '../../components/Tabs';
import { StatCard } from '../../components/StatCard';
import { LoadingState } from '../../components/LoadingState';
import { EmptyState } from '../../components/EmptyState';
import { useReportUnidades, useReportSalas, useReportLoja, useReportAlertas } from '../../hooks/useLaReport';
import { SalaCard } from './components/SalaCard';

export function InventarioListaPage() {
  const navigate = useNavigate();
  const { data: unidades = [], isLoading: lU } = useReportUnidades();
  const [unidadeId, setUnidadeId] = useState<string>('');

  useEffect(() => {
    if (!unidadeId && unidades.length > 0) {
      const barra = unidades.find(u => u.nome === 'Barra');
      setUnidadeId(barra?.id || unidades[0].id);
    }
  }, [unidades, unidadeId]);

  const { data: salas = [], isLoading: lS } = useReportSalas(unidadeId || null);
  const { data: produtos = [] } = useReportLoja(unidadeId || null);
  const { data: alertas } = useReportAlertas(unidadeId || undefined);

  const totalItens = useMemo(() => salas.reduce((s, sl) => s + (sl.itens_count ?? 0), 0), [salas]);
  const totalManutencao = alertas?.manutencoes_pendentes.length ?? 0;
  const estoqueBaixoCount = produtos.filter(p => p.abaixo_minimo || p.zerado).length;

  if (lU) return <LoadingState />;
  if (unidades.length === 0) {
    return (
      <div className="space-y-md pb-xl">
        <PageHeader title="Inventário" backTo="/mais" />
        <EmptyState icon={<span>📦</span>} title="Sem unidades" description="Nenhuma unidade configurada no LA Report." />
      </div>
    );
  }

  return (
    <div className="space-y-md pb-xl">
      <PageHeader title="Inventário" backTo="/mais" />

      <Tabs
        tabs={unidades.map(u => ({ id: u.id, label: u.nome }))}
        active={unidadeId}
        onChange={setUnidadeId}
      />

      <div className="grid grid-cols-3 gap-sm">
        <StatCard label="Salas" value={salas.length} />
        <StatCard label="Itens" value={totalItens} />
        <StatCard label="Manut." value={totalManutencao} />
      </div>

      <button
        type="button"
        onClick={() => navigate('/inventario/loja')}
        className="w-full bg-fg text-bg-surface rounded-lg p-md flex items-center gap-md text-left hover:opacity-90"
      >
        <span className="text-2xl">🛍</span>
        <div className="flex-1">
          <div className="font-semibold">Lojinha</div>
          <div className="text-body-sm opacity-60">
            {produtos.length} produtos{estoqueBaixoCount > 0 ? ` · estoque baixo: ${estoqueBaixoCount} ⚠️` : ''}
          </div>
        </div>
        <span className="opacity-60">›</span>
      </button>

      <div className="flex items-center gap-sm">
        <h3 className="text-body-sm text-fg-muted font-semibold uppercase tracking-wide">Salas ({salas.length})</h3>
        <div className="flex-1 h-px bg-border" />
      </div>

      {lS ? (
        <LoadingState />
      ) : salas.length === 0 ? (
        <EmptyState icon={<span>🏠</span>} title="Sem salas ativas" description="Nenhuma sala ativa nesta unidade." />
      ) : (
        <div className="space-y-2">
          {salas.map(s => (
            <SalaCard key={s.id} sala={s} onClick={() => navigate(`/inventario/sala/${s.id}`)} />
          ))}
        </div>
      )}
    </div>
  );
}
