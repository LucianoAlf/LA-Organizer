// Lista de checkpoints de UM pilar pra avaliação — com DnD por estagiário
import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DraggableAttributes,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import type { SyntheticListenerMap } from '@dnd-kit/core/dist/hooks/utilities';
import { CSS } from '@dnd-kit/utilities';
import { useAuth } from '../../contexts/AuthContext';
import { useLaEducaEstagiario } from '../../hooks/useLaEducaEstagiario';
import { useLaEducaPilares } from '../../hooks/useLaEducaPilares';
import { useLaEducaResponsaveis } from '../../hooks/useLaEducaResponsaveis';
import { PageHeader } from '../../components/PageHeader';
import { LoadingState } from '../../components/LoadingState';
import { CheckpointRow } from './components/CheckpointRow';
import { ancorarAvaliacao } from '../../lib/laeduca';
import { supabase } from '../../lib/supabase';
import { showToast } from '../../components/Toast';
import type { AvaliacaoComCheckpoint } from '../../lib/laeduca-types';

// ─── Item arrastável de avaliação ─────────────────────────────────────────────
function SortableAvaliacaoItem({
  item,
  pilarCodigo,
  posicao,
  canReorder,
  onAncorar,
}: {
  item: AvaliacaoComCheckpoint;
  pilarCodigo: string;
  posicao: number;
  canReorder: boolean;
  onAncorar: (params: { nota: number; observacoes: string; justificativaBaixa: string | null }) => Promise<void>;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.id });

  const posicaoLabel = `${pilarCodigo}.${posicao}`;

  return (
    <li
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.5 : 1,
      }}
    >
      <CheckpointRow
        item={item}
        onAncorar={onAncorar}
        posicaoLabel={posicaoLabel}
        canReorder={canReorder}
        dragHandleListeners={listeners as SyntheticListenerMap}
        dragHandleAttributes={attributes as DraggableAttributes}
      />
    </li>
  );
}

// ─── Página principal ─────────────────────────────────────────────────────────
export function LaEducaPilarPage() {
  const { id, pilar } = useParams<{ id: string; pilar: string }>();
  const { collaborator, role } = useAuth();
  const qc = useQueryClient();
  const { data, isLoading, error } = useLaEducaEstagiario(id);
  const { data: pilares, isLoading: pilaresLoading } = useLaEducaPilares();
  const { data: responsaveis = [] } = useLaEducaResponsaveis(id);

  // Estado local dos itens para DnD optimistic
  const [localItems, setLocalItems] = useState<AvaliacaoComCheckpoint[] | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  if (isLoading || pilaresLoading) return <LoadingState />;
  if (error || !data) return <div className="p-md text-danger">Estagiário não encontrado.</div>;

  const pilarObj = (pilares ?? []).find(p => p.codigo === pilar);
  if (!pilarObj) return <div className="p-md text-danger">Pilar inválido.</div>;

  const serverItems = data.avaliacoes_por_pilar[pilarObj.codigo] ?? [];
  const items = localItems ?? serverItems;

  // Sincroniza localItems quando serverItems muda (após refetch)
  if (localItems !== null && serverItems !== data.avaliacoes_por_pilar[pilarObj.codigo]) {
    // refetch aconteceu — limpar estado local
    setLocalItems(null);
  }

  const responsavelDoPilar = responsaveis.find(r => r.pilar_codigo === pilarObj.codigo);
  const responsavelNome = responsavelDoPilar
    ? responsavelDoPilar.instrutor_nome
    : (data.progresso.mentor_nome ?? '—');
  const ehInstrutor = !!responsavelDoPilar;

  // Permissão de reordenar
  const canReorder =
    role === 'coordinator' ||
    role === 'director' ||
    data.estagiario.mentor_id === collaborator?.id ||
    responsavelDoPilar?.instrutor_id === collaborator?.id;

  async function handleDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;

    const oldIdx = items.findIndex(i => i.id === active.id);
    const newIdx = items.findIndex(i => i.id === over.id);
    const reordered = arrayMove(items, oldIdx, newIdx);

    // Optimistic update local
    setLocalItems(reordered);

    try {
      await Promise.all(
        reordered.map((av, idx) =>
          supabase
            .from('la_educa_avaliacoes')
            .update({ sort_order: idx + 1 })
            .eq('id', av.id),
        ),
      );
      qc.invalidateQueries({ queryKey: ['laeduca-estagiario', id] });
    } catch {
      showToast({ kind: 'error', title: 'Erro ao reordenar checkpoints.' });
      setLocalItems(null);
    }
  }

  async function handleAncorar(avaliacaoId: string, params: { nota: number; observacoes: string; justificativaBaixa: string | null }) {
    if (!collaborator) return;
    try {
      await ancorarAvaliacao({
        avaliacaoId,
        nota: params.nota,
        observacoes: params.observacoes.trim() || null,
        justificativaBaixa: params.justificativaBaixa,
        avaliadorId: collaborator.id,
      });
      qc.invalidateQueries({ queryKey: ['laeduca-estagiario', id] });
      qc.invalidateQueries({ queryKey: ['laeduca-progresso'] });
      setLocalItems(null);
      showToast({ kind: 'success', title: 'Checkpoint ancorado.' });
    } catch (e) {
      showToast({ kind: 'error', title: 'Falha', msg: (e as Error).message });
    }
  }

  return (
    <div className="space-y-md pb-xl">
      <PageHeader
        title={pilarObj.nome}
        subtitle={`${data.estagiario.nome} · ${items.filter(i => i.ancorado).length}/${items.length} ancorados`}
        backTo={`/la-educa/${id}`}
      />

      <div className="bg-bg-surface rounded-lg p-sm border border-border text-body-sm text-fg-muted">
        Responsável por este pilar:{' '}
        <strong className="text-fg">{responsavelNome}</strong>
        {!ehInstrutor && <span> (mentor)</span>}
      </div>

      {pilarObj.foco && (
        <div className="bg-warning/10 border-l-4 border-warning rounded-r-lg p-md">
          <div className="text-body-sm font-semibold text-warning mb-1">Foco do pilar</div>
          <p className="text-body-sm text-fg-muted">{pilarObj.foco}</p>
        </div>
      )}

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={items.map(i => i.id)} strategy={verticalListSortingStrategy}>
          <ul className="space-y-sm">
            {items.map((item, idx) => (
              <SortableAvaliacaoItem
                key={item.id}
                item={item}
                pilarCodigo={pilarObj.codigo}
                posicao={idx + 1}
                canReorder={canReorder}
                onAncorar={p => handleAncorar(item.id, p)}
              />
            ))}
          </ul>
        </SortableContext>
      </DndContext>
    </div>
  );
}
