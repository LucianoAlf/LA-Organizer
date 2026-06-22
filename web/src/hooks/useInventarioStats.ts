import { useQuery } from '@tanstack/react-query';
import { laReportClient } from '../lib/lareport-client';
import { useAccess } from './useAccess';
import { aplicaFiltroStatus } from '../lib/inventario-status';

export function useInventarioStats(unidadeId?: string) {
  const access = useAccess('inventario');
  return useQuery({
    queryKey: ['lareport', 'stats', unidadeId, access.unitFilter],
    enabled: access.allowed && Boolean(unidadeId),
    queryFn: async () => {
      const applyFilters = (q: any) => {
        if (unidadeId) q = q.eq('unidade_id', unidadeId);
        if (access.unitFilter) {
          const f = access.unitFilter;
          if (Array.isArray(f)) q = q.in('unidade_id', f);
          else q = q.eq('unidade_id', f);
        }
        return q;
      };

      const [totalRes, valorRes, manutRes, atencaoRes] = await Promise.all([
        applyFilters(laReportClient.from('inventario').select('id', { count: 'exact', head: true }).eq('ativo', true)),
        applyFilters(laReportClient.from('inventario').select('valor_compra').eq('ativo', true)),
        aplicaFiltroStatus(applyFilters(laReportClient.from('inventario').select('id', { count: 'exact', head: true })), 'manutencao'),
        aplicaFiltroStatus(applyFilters(laReportClient.from('inventario').select('id', { count: 'exact', head: true })), 'atencao'),
      ]);

      const valorTotal = (valorRes.data || []).reduce((s: number, r: any) => s + (Number(r.valor_compra) || 0), 0);

      return {
        total: totalRes.count ?? 0,
        valor: valorTotal,
        manutencao: manutRes.count ?? 0,
        atencao: atencaoRes.count ?? 0,
      };
    },
  });
}
