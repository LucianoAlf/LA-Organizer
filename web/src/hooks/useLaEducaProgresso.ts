// web/src/hooks/useLaEducaProgresso.ts
import { useQuery } from '@tanstack/react-query';
import { fetchProgressoEstagiarios } from '../lib/laeduca';

export function useLaEducaProgresso(unidade?: string) {
  return useQuery({
    queryKey: ['laeduca-progresso', unidade ?? 'all'],
    queryFn: () => fetchProgressoEstagiarios(unidade),
    staleTime: 30_000,
  });
}
