import { useQuery } from '@tanstack/react-query';
import {
  fetchReportUnidades, fetchReportSalas, fetchReportSalaDetalhe,
  fetchReportLoja, fetchReportAlertas,
} from '../lib/lareport';

export function useReportUnidades() {
  return useQuery({
    queryKey: ['lareport-unidades'],
    queryFn: fetchReportUnidades,
    staleTime: 60 * 60_000,
  });
}

export function useReportSalas(unidadeId: string | null) {
  return useQuery({
    queryKey: ['lareport-salas', unidadeId],
    queryFn: () => fetchReportSalas(unidadeId!),
    enabled: !!unidadeId,
    staleTime: 5 * 60_000,
  });
}

export function useReportSalaDetalhe(salaId: number | null) {
  return useQuery({
    queryKey: ['lareport-sala', salaId],
    queryFn: () => fetchReportSalaDetalhe(salaId!),
    enabled: !!salaId,
    staleTime: 30_000,
  });
}

export function useReportLoja(unidadeId: string | null) {
  return useQuery({
    queryKey: ['lareport-loja', unidadeId],
    queryFn: () => fetchReportLoja(unidadeId!),
    enabled: !!unidadeId,
    staleTime: 60_000,
  });
}

export function useReportAlertas(unidadeId?: string | null) {
  return useQuery({
    queryKey: ['lareport-alertas', unidadeId ?? 'all'],
    queryFn: () => fetchReportAlertas(unidadeId ?? undefined),
    staleTime: 60_000,
  });
}
