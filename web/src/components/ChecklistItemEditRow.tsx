// web/src/components/ChecklistItemEditRow.tsx
import { ChevronUp, ChevronDown, Trash2 } from 'lucide-react'

interface Props {
  description: string
  index: number
  isFirst: boolean
  isLast: boolean
  onMoveUp: () => void
  onMoveDown: () => void
  onChange: (value: string) => void
  onDelete: () => void
}

export function ChecklistItemEditRow({
  description, index, isFirst, isLast,
  onMoveUp, onMoveDown, onChange, onDelete,
}: Props) {
  return (
    <div className="flex items-center gap-2 py-1">
      <div className="flex flex-col gap-0.5">
        <button
          type="button"
          onClick={onMoveUp}
          disabled={isFirst}
          className="p-0.5 rounded text-fg-muted hover:text-fg disabled:opacity-20 disabled:cursor-not-allowed"
          aria-label="Mover item para cima"
        >
          <ChevronUp size={16} />
        </button>
        <button
          type="button"
          onClick={onMoveDown}
          disabled={isLast}
          className="p-0.5 rounded text-fg-muted hover:text-fg disabled:opacity-20 disabled:cursor-not-allowed"
          aria-label="Mover item para baixo"
        >
          <ChevronDown size={16} />
        </button>
      </div>

      <span className="text-fg-muted text-caption w-5 text-right flex-shrink-0">
        {index}.
      </span>

      <input
        type="text"
        value={description}
        onChange={e => onChange(e.target.value)}
        className="flex-1 bg-transparent border-b border-border text-body-sm text-fg py-0.5 focus:outline-none focus:border-brand"
        placeholder="Descrição do item"
      />

      <button
        type="button"
        onClick={onDelete}
        className="p-1 rounded text-fg-muted hover:text-danger transition-colors"
        aria-label="Remover item"
      >
        <Trash2 size={15} />
      </button>
    </div>
  )
}
