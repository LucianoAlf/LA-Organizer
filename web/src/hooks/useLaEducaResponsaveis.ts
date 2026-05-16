import { useQuery } from '@tanstack/react-query';
import { fetchResponsaveisDoEstagiario } from '../lib/laeduca';

export function useLaEducaResponsaveis(estagiarioId: string | undefined) {
  return useQuery({
    queryKey: ['laeduca-responsaveis', estagiarioId],
    queryFn: () => fetchResponsaveisDoEstagiario(estagiarioId!),
    enabled: !!estagiarioId,
    staleTime: 30_000,
  });
}
