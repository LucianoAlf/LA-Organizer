// web/src/components/ChecklistItemRow.tsx
// Sprint 22.36 — Refactor pro design system de TaskRow:
//  - Drag handle ⋮⋮ à esquerda (useSortable)
//  - Checkbox circular grande, click toggle
//  - ⋮ menu por item: Adicionar/editar nota, Criar tarefa, Apagar (só ad-hoc)
//  - Nota inline expandível abaixo
//  - Ad-hoc badge "+" pra diferenciar visualmente
import { useEffect, useState } from 'react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { GripVertical, Check, X } from 'lucide-react'
// `Check` ainda é usado no botão de salvar nota inline.
import { RowMenu, type MenuItem } from './RowMenu'
import { TaskCheckbox } from './TaskCheckbox'

interface Props {
  uid: string
  index: number
  name: string
  done: boolean
  note?: string
  isAdHoc: boolean
  readonly: boolean
  onToggle: () => void
  onSaveNote?: (note: string) => void
  onCreateTask?: () => void
  onDelete?: () => void
  /** Edição inline do texto do item — quando passado, mostra "Editar item" no menu. */
  onRename?: (name: string) => void
  /**
   * Sprint 22.38 — quando true, "Apagar item" aparece independentemente de isAdHoc.
   * Usado por listas pessoais (todo item é deletável). Default: undefined.
   */
  canDelete?: boolean
}

export function ChecklistItemRow({
  uid,
  index,
  name,
  done,
  note = '',
  isAdHoc,
  readonly,
  onToggle,
  onSaveNote,
  onCreateTask,
  onDelete,
  onRename,
  canDelete,
}: Props) {
  const [editingNote, setEditingNote] = useState(false)
  const [draft, setDraft] = useState(note)
  const [editingName, setEditingName] = useState(false)
  const [nameDraft, setNameDraft] = useState(name)

  useEffect(() => {
    setDraft(note)
  }, [note])

  useEffect(() => {
    setNameDraft(name)
  }, [name])

  const hasNote = !!note.trim()

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: uid, disabled: readonly })

  // Sprint 22.39d — UX de drag fluida: item "levantado" (shadow + scale) em vez
  // de fantasma transparente. O transform ja segue o cursor; o feedback visual
  // de "card erguido" e o que torna o arrasto convincente.
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition: isDragging ? 'none' : transition,
    zIndex: isDragging ? 50 : undefined,
    boxShadow: isDragging ? '0 12px 28px -8px rgba(0,0,0,0.35)' : undefined,
    background: isDragging ? 'var(--bg-surface, #fff)' : undefined,
    cursor: isDragging ? 'grabbing' : undefined,
  }

  function handleSaveNote() {
    if (!onSaveNote) return
    onSaveNote(draft.trim())
    setEditingNote(false)
  }

  function handleCancelNote() {
    setDraft(note)
    setEditingNote(false)
  }

  function handleSaveName() {
    if (!onRename) return
    const v = nameDraft.trim()
    if (v && v !== name) onRename(v)
    setEditingName(false)
  }

  function handleCancelName() {
    setNameDraft(name)
    setEditingName(false)
  }

  // Build row menu
  const menu: MenuItem[] = []
  if (onRename && !readonly) {
    menu.push({
      label: 'Editar item',
      onClick: () => { setNameDraft(name); setEditingName(true) },
    })
  }
  if (onSaveNote) {
    menu.push({
      label: hasNote ? 'Editar observação' : 'Adicionar observação',
      onClick: () => setEditingNote(true),
    })
  }
  if (onCreateTask && !readonly) {
    menu.push({
      label: 'Criar tarefa',
      onClick: onCreateTask,
    })
  }
  if (onDelete && (isAdHoc || canDelete) && !readonly) {
    menu.push({
      label: 'Apagar item',
      onClick: onDelete,
      danger: true,
      confirm: 'Apagar esse item?',
    })
  }

  return (
    <div ref={setNodeRef} style={style} className="rounded-lg">
      <div className="flex items-center gap-1">
        {/* Drag handle (só quando não readonly) */}
        {!readonly ? (
          <button
            type="button"
            {...attributes}
            {...listeners}
            className="touch-manipulation cursor-grab active:cursor-grabbing p-1 text-fg-muted hover:text-fg flex-shrink-0 focus-ring rounded-sm"
            aria-label="Reordenar item"
          >
            <GripVertical size={14} />
          </button>
        ) : (
          <span className="w-6 flex-shrink-0" aria-hidden />
        )}

        {/* Checkbox padronizado (mesma do /projetos via TaskCheckbox) */}
        <TaskCheckbox
          done={done}
          disabled={readonly}
          onClick={readonly ? undefined : onToggle}
          ariaLabel={done ? 'Desmarcar item' : 'Marcar item'}
        />

        {/* Label clicável também marca/desmarca — ou input de edição do texto */}
        {editingName ? (
          <div className="flex-1 flex items-center gap-1 min-w-0 px-1 py-1">
            <input
              value={nameDraft}
              onChange={e => setNameDraft(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') { e.preventDefault(); handleSaveName() }
                if (e.key === 'Escape') { e.preventDefault(); handleCancelName() }
              }}
              className="flex-1 min-w-0 text-body-sm bg-bg-app border border-border rounded-md px-2 py-1.5 text-fg placeholder:text-fg-muted focus:outline-none focus:border-tom"
              autoFocus
            />
            <button
              type="button"
              onClick={handleCancelName}
              className="p-1.5 rounded-md text-fg-muted hover:bg-bg-app hover:text-fg transition-colors flex-shrink-0"
              aria-label="Cancelar"
            >
              <X size={14} />
            </button>
            <button
              type="button"
              onClick={handleSaveName}
              className="p-1.5 rounded-md text-success hover:bg-bg-app transition-colors flex-shrink-0"
              aria-label="Salvar item"
            >
              <Check size={14} />
            </button>
          </div>
        ) : (
          <button
            type="button"
            className={[
              'flex-1 flex items-center gap-2 px-2 py-2 rounded-lg text-left transition-colors min-w-0',
              readonly
                ? 'cursor-default opacity-70'
                : 'hover:bg-bg-app cursor-pointer active:opacity-80',
            ].join(' ')}
            onClick={readonly ? undefined : onToggle}
            disabled={readonly}
            aria-pressed={done}
          >
            <span className="flex-1 min-w-0">
              <span
                className={[
                  'text-body-sm',
                  done ? 'line-through text-fg-muted' : 'text-fg',
                ].join(' ')}
              >
                {index}. {name}
              </span>
              {isAdHoc && (
                <span className="ml-2 inline-flex items-center text-[10px] px-1.5 py-0.5 rounded bg-tom/10 text-tom font-medium">
                  +ad-hoc
                </span>
              )}
            </span>
          </button>
        )}

        {/* RowMenu (always rendered if any menu item) */}
        {menu.length > 0 && (
          <div className="flex-shrink-0">
            <RowMenu items={menu} />
          </div>
        )}
      </div>

      {/* Note display */}
      {hasNote && !editingNote && (
        <div className="ml-12 mr-2 mb-1 -mt-0.5 px-2 py-1 rounded-md bg-bg-app/60 border-l-2 border-tom">
          <p className="text-caption text-fg-secondary whitespace-pre-wrap">{note}</p>
        </div>
      )}

      {/* Note editor inline */}
      {editingNote && (
        <div className="ml-12 mr-2 mb-2 mt-1 space-y-2">
          <textarea
            value={draft}
            onChange={e => setDraft(e.target.value)}
            placeholder="Observação (ex: 'porta da sala 2 travou')"
            rows={2}
            disabled={readonly}
            className="w-full text-body-sm bg-bg-app border border-border rounded-md p-2 text-fg placeholder:text-fg-muted resize-y focus:outline-none focus:border-brand"
            autoFocus
          />
          {!readonly && (
            <div className="flex justify-end gap-1">
              <button
                type="button"
                onClick={handleCancelNote}
                className="p-1.5 rounded-md text-fg-muted hover:bg-bg-app hover:text-fg transition-colors"
                aria-label="Cancelar"
              >
                <X size={14} />
              </button>
              <button
                type="button"
                onClick={handleSaveNote}
                className="p-1.5 rounded-md text-success hover:bg-bg-app transition-colors"
                aria-label="Salvar observação"
              >
                <Check size={14} />
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
