// Sprint 22.23 (refactor) — extraido de screens/ProjetoDetalhe.tsx.
// Sensors padronizados pra @dnd-kit em todas listas sortable do projeto.
// Delay de 200ms + tolerance 5px pra nao conflitar com tap (toggle/expand/click).

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
    activationConstraint: { delay: 200, tolerance: 5 },
  });
  const touchSensor = useSensor(TouchSensor, {
    activationConstraint: { delay: 200, tolerance: 5 },
  });
  const keyboardSensor = useSensor(KeyboardSensor, {
    coordinateGetter: sortableKeyboardCoordinates,
  });
  return useSensors(pointerSensor, touchSensor, keyboardSensor);
}
