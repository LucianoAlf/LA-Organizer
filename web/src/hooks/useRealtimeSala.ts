import { useQueryClient } from '@tanstack/react-query';
import { useRealtimeRow } from '../lib/lareport-realtime';

export function useRealtimeSala(salaId: number | null) {
  const qc = useQueryClient();
  const enabled = salaId !== null;
  const invalidate = () => { qc.invalidateQueries({ queryKey: ['lareport', 'sala', salaId] }); };

  useRealtimeRow('inventario', salaId ? `sala_id=eq.${salaId}` : undefined, invalidate, enabled);
  useRealtimeRow('inventario_movimentacoes', salaId ? `sala_origem_id=eq.${salaId}` : undefined, invalidate, enabled);
  useRealtimeRow('inventario_movimentacoes', salaId ? `sala_destino_id=eq.${salaId}` : undefined, invalidate, enabled);
  useRealtimeRow('inventario_manutencoes', undefined, invalidate, enabled);
}
