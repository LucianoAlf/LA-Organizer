import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { PageHeader } from '../../components/PageHeader';
import { Tabs } from '../../components/Tabs';
import { LoadingState } from '../../components/LoadingState';
import { EmptyState } from '../../components/EmptyState';
import { useReportUnidades, useReportSalas, useReportLoja } from '../../hooks/useLaReport';
import { SalaCardMedio } from './components/SalaCardMedio';
import { StatsCards } from './components/StatsCards';
import { useAccess } from '../../hooks/useAccess';
import { useRealtimeSalas } from '../../hooks/useRealtimeSalas';

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
  useRealtimeSalas(unidadeId);

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

      <StatsCards unidadeId={unidadeId} onAtencaoClick={() => navigate(`/inventario/atencao?unit=${unidadeId}`)} />

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
            <SalaCardMedio key={s.id} sala={s} onClick={() => navigate(`/inventario/sala/${s.id}`)} />
          ))}
        </div>
      )}
    </div>
  );
}
