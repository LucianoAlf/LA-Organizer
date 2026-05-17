import { useQuery } from '@tanstack/react-query';
import { laReportClient } from '../lib/lareport-client';
import { useAccess } from './useAccess';
import type {
  ReportUnidade, ReportSala, ReportSalaDetalhe, ReportProduto, ReportAlertas,
  ReportInventarioItem, ReportMovimentacao, ReportManutencao,
} from '../lib/lareport-types';

function applyUnitFilter<Q extends { in: Function; eq: Function }>(
  q: Q,
  column: string,
  unitFilter: string | string[] | null,
): Q {
  if (!unitFilter) return q;
  if (Array.isArray(unitFilter)) return q.in(column, unitFilter) as Q;
  return q.eq(column, unitFilter) as Q;
}

export function useReportUnidades() {
  const access = useAccess('inventario');
  return useQuery({
    queryKey: ['lareport', 'unidades', access.unitFilter],
    enabled: access.allowed,
    staleTime: 60 * 60_000,
    queryFn: async (): Promise<ReportUnidade[]> => {
      let q = laReportClient
        .from('unidades')
        .select('id, nome')
        .eq('ativo', true)
        .order('nome');
      q = applyUnitFilter(q, 'id', access.unitFilter);
      const { data, error } = await q;
      if (error) throw error;
      return (data || []) as ReportUnidade[];
    },
  });
}

export function useReportSalas(unidadeId: string | null) {
  const access = useAccess('inventario');
  return useQuery({
    queryKey: ['lareport', 'salas', unidadeId, access.unitFilter],
    enabled: access.allowed && Boolean(unidadeId),
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<ReportSala[]> => {
      let q = laReportClient
        .from('salas')
        .select('id, nome, tipo_sala, capacidade_maxima, codigo, ativo, unidade_id, buffer_operacional, sala_coringa, unidades(nome)')
        .eq('ativo', true)
        .order('nome');
      if (unidadeId) q = q.eq('unidade_id', unidadeId);
      q = applyUnitFilter(q, 'unidade_id', access.unitFilter);
      const { data, error } = await q;
      if (error) throw error;
      const ids = (data || []).map((s: any) => s.id);
      const countMap = new Map<number, number>();
      if (ids.length) {
        const { data: counts } = await laReportClient
          .from('inventario')
          .select('sala_id')
          .in('sala_id', ids)
          .eq('ativo', true);
        for (const r of (counts || []) as any[]) {
          countMap.set(r.sala_id, (countMap.get(r.sala_id) || 0) + 1);
        }
      }
      return ((data || []) as any[]).map(s => ({ ...s, itens_count: countMap.get(s.id) || 0 })) as ReportSala[];
    },
  });
}

export function useReportSalaDetalhe(salaId: number | null) {
  const access = useAccess('inventario');
  return useQuery({
    queryKey: ['lareport', 'sala', salaId, access.unitFilter],
    enabled: access.allowed && salaId !== null,
    staleTime: 30_000,
    queryFn: async (): Promise<ReportSalaDetalhe> => {
      const [salaRes, itensRes, movsRes, manutsRes] = await Promise.all([
        laReportClient
          .from('salas')
          .select('id, nome, tipo_sala, capacidade_maxima, codigo, ativo, unidade_id, buffer_operacional, sala_coringa, unidades(nome)')
          .eq('id', salaId!)
          .single(),
        laReportClient
          .from('inventario')
          .select('*')
          .eq('sala_id', salaId!)
          .eq('ativo', true)
          .order('nome'),
        laReportClient
          .from('inventario_movimentacoes')
          .select('*, inventario(nome, codigo_patrimonio)')
          .or(`sala_origem_id.eq.${salaId},sala_destino_id.eq.${salaId}`)
          .order('data_movimentacao', { ascending: false })
          .limit(50),
        laReportClient
          .from('inventario_manutencoes')
          .select('*, inventario!inner(nome, codigo_patrimonio, sala_id)')
          .eq('inventario.sala_id', salaId!)
          .order('data_manutencao', { ascending: false })
          .limit(50),
      ]);
      if (salaRes.error) throw salaRes.error;
      if (itensRes.error) throw itensRes.error;
      if (movsRes.error) throw movsRes.error;
      if (manutsRes.error) throw manutsRes.error;
      return {
        sala: salaRes.data as unknown as ReportSala,
        itens: (itensRes.data || []) as ReportInventarioItem[],
        movimentacoes: (movsRes.data || []) as ReportMovimentacao[],
        manutencoes: (manutsRes.data || []) as ReportManutencao[],
      };
    },
  });
}

export function useReportLoja(unidadeId: string | null) {
  const access = useAccess('loja_produtos');
  return useQuery({
    queryKey: ['lareport', 'loja', unidadeId, access.unitFilter],
    enabled: access.allowed && Boolean(unidadeId),
    staleTime: 60_000,
    queryFn: async (): Promise<ReportProduto[]> => {
      const { data, error } = await laReportClient
        .from('loja_produtos')
        .select('*, loja_categorias(nome, icone)')
        .eq('ativo', true)
        .order('nome');
      if (error) throw error;
      return ((data || []) as any[]).map(p => ({
        ...p,
        estoque_atual: p.estoque_atual ?? 0,
        abaixo_minimo: p.estoque_minimo != null && (p.estoque_atual ?? 0) < p.estoque_minimo,
        zerado: (p.estoque_atual ?? 0) === 0,
      })) as ReportProduto[];
    },
  });
}

export function useReportAlertas(unidadeId?: string | null) {
  const access = useAccess('inventario');
  return useQuery({
    queryKey: ['lareport', 'alertas', unidadeId ?? 'all', access.unitFilter],
    enabled: access.allowed,
    staleTime: 60_000,
    queryFn: async (): Promise<ReportAlertas> => {
      let estoqueQ = laReportClient
        .from('loja_produtos')
        .select('*, loja_categorias(nome, icone)')
        .eq('ativo', true);

      let invQ = laReportClient
        .from('inventario')
        .select('*')
        .eq('ativo', true)
        .not('proxima_revisao', 'is', null)
        .order('proxima_revisao', { ascending: true })
        .limit(50);
      if (unidadeId) invQ = invQ.eq('unidade_id', unidadeId);
      invQ = applyUnitFilter(invQ, 'unidade_id', access.unitFilter);

      let manutQ = laReportClient
        .from('inventario_manutencoes')
        .select('*, inventario!inner(nome, codigo_patrimonio, sala_id, unidade_id)')
        .not('data_proxima_revisao', 'is', null)
        .order('data_proxima_revisao', { ascending: true })
        .limit(50);
      if (unidadeId) manutQ = manutQ.eq('inventario.unidade_id', unidadeId);
      if (access.unitFilter) {
        const f = access.unitFilter;
        if (Array.isArray(f)) manutQ = manutQ.in('inventario.unidade_id', f);
        else manutQ = manutQ.eq('inventario.unidade_id', f);
      }

      const [estoqueRes, invRes, manutRes] = await Promise.all([estoqueQ, invQ, manutQ]);
      if (estoqueRes.error) throw estoqueRes.error;
      if (invRes.error) throw invRes.error;
      if (manutRes.error) throw manutRes.error;

      const estoque_baixo = ((estoqueRes.data || []) as any[])
        .map(p => ({
          ...p,
          estoque_atual: p.estoque_atual ?? 0,
          abaixo_minimo: p.estoque_minimo != null && (p.estoque_atual ?? 0) < p.estoque_minimo,
          zerado: (p.estoque_atual ?? 0) === 0,
        }))
        .filter(p => p.abaixo_minimo || p.zerado) as ReportProduto[];

      return {
        estoque_baixo,
        manutencoes_pendentes: (manutRes.data || []) as ReportManutencao[],
        revisoes_proximas: (invRes.data || []) as ReportInventarioItem[],
      };
    },
  });
}
