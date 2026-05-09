// web/src/components/ChecklistItemEditRow.tsx
// Sprint 22.39b — Refactor pra DnD (mesmo padrao de ChecklistItemRow):
// grip handle ⋮⋮ a esquerda via useSortable. Setinhas ↑↓ removidas.
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { GripVertical, Trash2 } from 'lucide-react'

interface Props {
  /** Identificador estavel do item para o SortableContext. */
  uid: string
  description: string
  index: number
  onChange: (value: string) => void
  onDelete: () => void
}

export function ChecklistItemEditRow({ uid, description, index, onChange, onDelete }: Props) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: uid })

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  }

  return (
    <div ref={setNodeRef} style={style} className="flex items-center gap-2 py-1">
      <button
        type="button"
        {...attributes}
        {...listeners}
        className="touch-manipulation cursor-grab active:cursor-grabbing p-1 text-fg-muted hover:text-fg flex-shrink-0 focus-ring rounded-sm"
        aria-label="Reordenar item"
      >
        <GripVertical size={14} />
      </button>

      <span className="text-fg-muted text-caption w-5 text-right flex-shrink-0">
        {index}.
      </span>

      <input
        type="text"
        value={description}
        onChange={e => onChange(e.target.value)}
        className="flex-1 bg-transparent border-b border-border text-body-sm text-fg py-0.5 focus:outline-none focus:border-tom"
        placeholder="Descrição do item"
      />

      <button
        type="button"
        onClick={onDelete}
        className="p-1 rounded text-fg-muted hover:text-danger transition-colors focus-ring"
        aria-label="Remover item"
      >
        <Trash2 size={15} />
      </button>
    </div>
  )
}
