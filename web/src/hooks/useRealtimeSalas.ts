import { useQueryClient } from '@tanstack/react-query';
import { useRealtimeRow } from '../lib/lareport-realtime';

export function useRealtimeSalas(unidadeId?: string) {
  const qc = useQueryClient();
  const invalidate = () => { qc.invalidateQueries({ queryKey: ['lareport', 'salas', unidadeId] }); };
  useRealtimeRow('inventario', undefined, invalidate, Boolean(unidadeId));
  useRealtimeRow('salas', undefined, invalidate, Boolean(unidadeId));
}
