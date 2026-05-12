// Sprint 22.23 (refactor) — extraido de screens/ProjetoDetalhe.tsx.
// Sensors padronizados pra @dnd-kit em todas listas sortable do projeto.
//
// Sprint 23.7 — DnD handle-only. Listeners movidos para o grip icon em todos
// os componentes. O touch-none sai do card e fica só no handle. Sensor ajustado:
// Pointer usa distance:8 (distingue click de drag), Touch usa delay:250ms para
// mobile não conflitar com scroll. Card inteiro volta a ser scrollável.

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
    activationConstraint: { distance: 8 },
  });
  const touchSensor = useSensor(TouchSensor, {
    activationConstraint: { delay: 250, tolerance: 8 },
  });
  const keyboardSensor = useSensor(KeyboardSensor, {
    coordinateGetter: sortableKeyboardCoordinates,
  });
  return useSensors(pointerSensor, touchSensor, keyboardSensor);
}
