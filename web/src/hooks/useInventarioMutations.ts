import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createItem, updateItem, deleteItem, moverItem, registrarManutencao } from '../lib/lareport-mutations';

export function useInventarioMutations(salaId?: number | null) {
  const qc = useQueryClient();
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['lareport', 'sala', salaId] });
    qc.invalidateQueries({ queryKey: ['lareport', 'salas'] });
    qc.invalidateQueries({ queryKey: ['lareport', 'stats'] });
  };
  return {
    create: useMutation({ mutationFn: createItem, onSuccess: invalidate }),
    update: useMutation({ mutationFn: ({ id, payload }: { id: number; payload: any }) => updateItem(id, payload), onSuccess: invalidate }),
    remove: useMutation({ mutationFn: deleteItem, onSuccess: invalidate }),
    mover: useMutation({ mutationFn: ({ id, sala_destino_id, motivo }: { id: number; sala_destino_id: number; motivo?: string }) => moverItem(id, { sala_destino_id, motivo }), onSuccess: invalidate }),
    manutencao: useMutation({ mutationFn: ({ id, payload }: { id: number; payload: any }) => registrarManutencao(id, payload), onSuccess: invalidate }),
  };
}
