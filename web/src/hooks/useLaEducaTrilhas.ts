import { useQuery } from '@tanstack/react-query';
import { fetchTrilhas } from '../lib/laeduca';

export function useLaEducaTrilhas() {
  return useQuery({
    queryKey: ['laeduca-trilhas'],
    queryFn: fetchTrilhas,
    staleTime: 60_000,
  });
}
