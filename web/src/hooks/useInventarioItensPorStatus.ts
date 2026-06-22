import { useQuery } from '@tanstack/react-query';
import { laReportClient } from '../lib/lareport-client';
import { useAccess } from './useAccess';
import { aplicaFiltroStatus, type InventarioStatusTipo } from '../lib/inventario-status';
import type { ReportInventarioItem } from '../lib/lareport-types';

// Lista os itens que compõem um card de status (atencao | manutencao) de uma unidade.
// Reusa o MESMO filtro do contador (aplicaFiltroStatus) → a lista bate com o número do card.
export function useInventarioItensPorStatus(
  unidadeId: string | undefined,
  tipo: InventarioStatusTipo | null,
) {
  const access = useAccess('inventario');
  return useQuery<ReportInventarioItem[]>({
    queryKey: ['lareport', 'por-status', tipo, unidadeId, access.unitFilter],
    enabled: access.allowed && Boolean(unidadeId) && tipo != null,
    queryFn: async () => {
      let q: any = laReportClient.from('inventario').select('*');
      if (unidadeId) q = q.eq('unidade_id', unidadeId);
      if (access.unitFilter) {
        const f = access.unitFilter;
        if (Array.isArray(f)) q = q.in('unidade_id', f);
        else q = q.eq('unidade_id', f);
      }
      q = aplicaFiltroStatus(q, tipo as InventarioStatusTipo);
      q = tipo === 'atencao'
        ? q.order('proxima_revisao', { ascending: true })
        : q.order('nome', { ascending: true });
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as ReportInventarioItem[];
    },
  });
}
