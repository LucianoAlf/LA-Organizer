import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { PageHeader } from '../../components/PageHeader';
import { Tabs } from '../../components/Tabs';
import { LoadingState } from '../../components/LoadingState';
import { EmptyState } from '../../components/EmptyState';
import { useReportUnidades, useReportSalas, useReportLoja } from '../../hooks/useLaReport';
import { SalaCardMedio } from './components/SalaCardMedio';
import { StatsCards } from './components/StatsCards';
import { useAccess } from '../../hooks/useAccess';
import { useRealtimeSalas } from '../../hooks/useRealtimeSalas';
import { laReportClient } from '../../lib/lareport-client';

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

  // Pendências abertas (aberta + em_andamento) por sala — badge no SalaCardMedio
  const { data: pendCounts = {} } = useQuery<Record<number, number>>({
    queryKey: ['lareport', 'pend-counts', unidadeId],
    enabled: Boolean(unidadeId),
    staleTime: 30_000,
    queryFn: async () => {
      const { data, error } = await laReportClient
        .from('inventario_pendencias')
        .select('sala_id')
        .eq('unidade_id', unidadeId!)
        .in('status', ['aberta', 'em_andamento']);
      if (error) throw error;
      const map: Record<number, number> = {};
      for (const r of (data || []) as any[]) {
        map[r.sala_id] = (map[r.sala_id] || 0) + 1;
      }
      return map;
    },
  });

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
            <SalaCardMedio key={s.id} sala={s} pendCount={pendCounts[s.id] || 0} onClick={() => navigate(`/inventario/sala/${s.id}`)} />
          ))}
        </div>
      )}
    </div>
  );
}
