// web/src/hooks/useLaEducaEstagiario.ts
import { useQuery } from '@tanstack/react-query';
import { fetchEstagiarioDetalhe } from '../lib/laeduca';

export function useLaEducaEstagiario(estagiarioId: string | undefined) {
  return useQuery({
    queryKey: ['laeduca-estagiario', estagiarioId],
    queryFn: () => fetchEstagiarioDetalhe(estagiarioId!),
    enabled: !!estagiarioId,
    staleTime: 15_000,
  });
}
