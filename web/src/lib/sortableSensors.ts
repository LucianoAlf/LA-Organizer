// Sprint 22.23 (refactor) — extraido de screens/ProjetoDetalhe.tsx.
// Sensors padronizados pra @dnd-kit em todas listas sortable do projeto.
//
// Sprint 22.39c — Pointer agora usa `distance: 5` (instant grab) ao inves de
// `delay: 200`. User reclamou que tinha que segurar pra arrastar; agora arrasta
// imediato no mousedown (com 5px de tolerancia pra distinguir de click puro).
// Touch continua com delay 200ms pra nao conflitar com scroll vertical mobile.

import {
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable';

export function useSortableSensors() {
  // Hooks chamados em ordem fixa — wrapper usado dentro de componentes que sao
  // sortable hosts (CheckpointSortableList, SortableTaskList, etc.).
  const pointerSensor = useSensor(PointerSensor, {
    // distance ativa drag apos 5px de movimento — sem delay (instant grab).
    activationConstraint: { distance: 5 },
  });
  const touchSensor = useSensor(TouchSensor, {
    activationConstraint: { delay: 200, tolerance: 5 },
  });
  const keyboardSensor = useSensor(KeyboardSensor, {
    coordinateGetter: sortableKeyboardCoordinates,
  });
  return useSensors(pointerSensor, touchSensor, keyboardSensor);
}
