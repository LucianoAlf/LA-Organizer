import { useQuery } from '@tanstack/react-query';
import { fetchPilares } from '../lib/laeduca';

export function useLaEducaPilares() {
  return useQuery({
    queryKey: ['laeduca-pilares'],
    queryFn: fetchPilares,
    staleTime: 60_000,
  });
}
