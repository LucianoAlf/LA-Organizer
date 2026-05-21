import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { laReportClient } from '../lib/lareport-client';
import { useAccess } from './useAccess';
import { buscarProduto } from '../lib/lareport-mutations';
import { supabase } from '../lib/supabase';
import type {
  ReportUnidade, ReportSala, ReportSalaDetalhe, ReportProduto, ReportAlertas,
  ReportInventarioItem, ReportMovimentacao, ReportManutencao,
} from '../lib/lareport-types';

// ============================================================
// Sprint Fase 2.3 — Histórico de Vendas / Estorno / Reservas
// ============================================================

export interface HistoricoVendaItem {
  produto_id: number;
  quantidade: number;
  preco_unitario: number;
  loja_produtos?: { nome: string; sku: string | null } | null;
}

export interface HistoricoVenda {
  id: number;
  data_venda: string;
  total: number;
  forma_pagamento: string;
  status: 'ativa' | 'estornada';
  motivo_estorno?: string | null;
  estornada_em?: string | null;
  observacoes?: string | null;
  loja_venda_itens: HistoricoVendaItem[];
  loja_alunos?: { nome: string } | null;
  loja_professores?: { nome: string } | null;
  tipo_cliente?: string | null;
  cliente_nome?: string | null;
}

export function useHistoricoVendas(
  unidadeId: string | null,
  opts?: {
    dias?: number;
    professorId?: number;
    formaPagamento?: string;
    status?: 'ativa' | 'estornada' | 'todas';
    limit?: number;
  },
) {
  const access = useAccess('loja_produtos');
  const dias = opts?.dias ?? 30;
  const status = opts?.status ?? 'todas';
  const limit = opts?.limit ?? 100;
  return useQuery({
    queryKey: [
      'lareport', 'historico-vendas',
      unidadeId, dias, opts?.professorId ?? null,
      opts?.formaPagamento ?? null, status, limit,
      access.unitFilter,
    ],
    enabled: access.allowed && Boolean(unidadeId),
    staleTime: 30_000,
    queryFn: async (): Promise<HistoricoVenda[]> => {
      const qs = new URLSearchParams();
      qs.set('unidade_id', unidadeId!);
      qs.set('dias', String(dias));
      qs.set('status', status);
      qs.set('limit', String(limit));
      if (opts?.professorId) qs.set('professor_id', String(opts.professorId));
      if (opts?.formaPagamento) qs.set('forma_pagamento', opts.formaPagamento);
      const { data: sess } = await supabase.auth.getSession();
      const r = await fetch(`/api/lareport/loja/historico-vendas?${qs}`, {
        headers: { Authorization: `Bearer ${sess.session?.access_token ?? ''}` },
      });
      if (!r.ok) {
        const txt = await r.text();
        throw new Error(txt || `historico-vendas HTTP ${r.status}`);
      }
      const j = await r.json();
      return (j.data || []) as HistoricoVenda[];
    },
  });
}

export interface ReportReserva {
  id: number;
  produto_id: number;
  variacao_id: number | null;
  unidade_id: string;
  aluno_id: number | null;
  cliente_nome: string;
  quantidade: number;
  prazo: string;
  status: 'ativa' | 'finalizada' | 'expirada' | 'cancelada';
  observacoes: string | null;
  created_at: string;
  created_via: string | null;
  finalizada_em: string | null;
  finalizada_venda_id: number | null;
  cancelada_em: string | null;
  motivo_cancelamento: string | null;
  loja_produtos?: { nome: string; sku: string | null } | null;
  loja_alunos?: { nome: string } | null;
}

export function useReservas(
  unidadeId: string | null,
  status: 'ativa' | 'finalizada' | 'expirada' | 'cancelada' | 'todas' = 'ativa',
) {
  const access = useAccess('loja_produtos');
  const qc = useQueryClient();

  useEffect(() => {
    if (!unidadeId) return;
    // Sufixo único: Supabase reusa channel com mesmo nome, fazendo .on()
    // ser chamado após .subscribe() em re-mounts (StrictMode/HMR) → erro
    // "cannot add callbacks after subscribe()".
    const uniq = Math.random().toString(36).slice(2, 10);
    const ch = laReportClient
      .channel(`loja_reservas_${unidadeId}_${uniq}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'loja_reservas', filter: `unidade_id=eq.${unidadeId}` },
        () => qc.invalidateQueries({ queryKey: ['lareport', 'reservas', unidadeId] }),
      )
      .subscribe();
    return () => { laReportClient.removeChannel(ch); };
  }, [unidadeId, qc]);

  return useQuery({
    queryKey: ['lareport', 'reservas', unidadeId, status, access.unitFilter],
    enabled: access.allowed && Boolean(unidadeId),
    staleTime: 30_000,
    queryFn: async (): Promise<ReportReserva[]> => {
      let q = laReportClient
        .from('loja_reservas')
        .select('*, loja_produtos(nome, sku), loja_alunos:alunos!aluno_id(nome)')
        .eq('unidade_id', unidadeId!)
        .order('created_at', { ascending: false });
      if (status !== 'todas') q = q.eq('status', status);
      const { data, error } = await q;
      if (error) throw error;
      return (data || []) as unknown as ReportReserva[];
    },
  });
}


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
  const qc = useQueryClient();

  useEffect(() => {
    if (!unidadeId) return;
    // Sufixo único — vide nota em useReservas (evita colisão de channel).
    const uniq = Math.random().toString(36).slice(2, 10);
    const ch = laReportClient
      .channel(`loja_estoque_${unidadeId}_${uniq}`)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'loja_estoque', filter: `unidade_id=eq.${unidadeId}` },
        () => qc.invalidateQueries({ queryKey: ['lareport', 'loja', unidadeId] })
      )
      .subscribe();
    return () => { laReportClient.removeChannel(ch); };
  }, [unidadeId, qc]);

  return useQuery({
    queryKey: ['lareport', 'loja', unidadeId, access.unitFilter],
    enabled: access.allowed && Boolean(unidadeId),
    staleTime: 60_000,
    queryFn: async (): Promise<ReportProduto[]> => {
      // Sprint Fase B fix — loja_produtos NÃO tem estoque_atual nativo. Saldo
      // mora em loja_estoque (por unidade). JOIN inline filtrado pela unidade
      // selecionada. Se o produto não tem linha em loja_estoque pra essa
      // unidade, saldo é 0 (default).
      const { data, error } = await laReportClient
        .from('loja_produtos')
        .select(`
          *,
          loja_categorias(nome, icone),
          loja_estoque!left(quantidade, unidade_id)
        `)
        .eq('ativo', true)
        .order('nome');
      if (error) throw error;
      return ((data || []) as any[]).map(p => {
        // Estoque pode ter múltiplas linhas (várias unidades) — filtra pela atual.
        const linhas = Array.isArray(p.loja_estoque) ? p.loja_estoque : [];
        const aqui = linhas.find((e: any) => e.unidade_id === unidadeId);
        const estoque = aqui?.quantidade ?? 0;
        return {
          ...p,
          estoque_atual: estoque,
          abaixo_minimo: p.estoque_minimo != null && estoque < p.estoque_minimo,
          zerado: estoque === 0,
        };
      }) as ReportProduto[];
    },
  });
}

export function useProdutoSearch(termo: string, unidadeId: string | null) {
  return useQuery({
    queryKey: ['loja-produto-search', termo, unidadeId],
    queryFn: () => buscarProduto(termo, unidadeId),
    enabled: termo.trim().length >= 2,
    staleTime: 30_000,
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
