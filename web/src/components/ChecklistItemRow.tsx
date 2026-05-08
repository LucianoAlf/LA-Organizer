// web/src/components/ChecklistItemRow.tsx
// Sprint 22.35 — Polish + ações: nota inline, criar tarefa.
// - Toggle continua sendo a ação principal (botão grande clicável)
// - Botões secundários: nota (MessageSquare) e criar tarefa (ListTodo)
// - Nota expande textarea inline abaixo da linha; salva via onSaveNote
// - Criar tarefa: ação direta (parent confirma via toast)
import { useState, useEffect } from 'react'
import { MessageSquarePlus, MessageSquare, ListTodo, Check, X } from 'lucide-react'

interface Props {
  index: number
  name: string
  done: boolean
  note?: string
  readonly: boolean
  onToggle: () => void
  onSaveNote?: (note: string) => void
  onCreateTask?: () => void
}

export function ChecklistItemRow({
  index,
  name,
  done,
  note = '',
  readonly,
  onToggle,
  onSaveNote,
  onCreateTask,
}: Props) {
  const [editingNote, setEditingNote] = useState(false)
  const [draft, setDraft] = useState(note)

  useEffect(() => {
    setDraft(note)
  }, [note])

  const hasNote = !!note.trim()

  function handleSave() {
    if (!onSaveNote) return
    onSaveNote(draft.trim())
    setEditingNote(false)
  }

  function handleCancel() {
    setDraft(note)
    setEditingNote(false)
  }

  return (
    <div className="rounded-lg">
      <div className="flex items-center gap-1">
        <button
          type="button"
          className={[
            'flex-1 flex items-center gap-3 p-2 rounded-lg text-left transition-colors',
            readonly
              ? 'cursor-default opacity-70'
              : 'hover:bg-bg-app cursor-pointer active:opacity-80',
          ].join(' ')}
          onClick={readonly ? undefined : onToggle}
          disabled={readonly}
          aria-pressed={done}
        >
          <span
            className={[
              'w-6 h-6 rounded-md border-2 flex items-center justify-center flex-shrink-0 transition-colors',
              done ? 'bg-success border-success' : 'border-border',
            ].join(' ')}
          >
            {done && (
              <svg className="text-white" width="12" height="12" viewBox="0 0 12 12" fill="none">
                <path
                  d="M2 6l3 3 5-5"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            )}
          </span>
          <span
            className={[
              'text-body-sm',
              done ? 'line-through text-fg-muted' : 'text-fg',
            ].join(' ')}
          >
            {index}. {name}
          </span>
        </button>

        {/* Action buttons (sempre visíveis, mesmo readonly só não dispara) */}
        <div className="flex items-center gap-0.5 flex-shrink-0">
          {onSaveNote && (
            <button
              type="button"
              onClick={() => setEditingNote(v => !v)}
              disabled={readonly && !hasNote}
              className={[
                'p-2 rounded-md transition-colors',
                hasNote ? 'text-tom' : 'text-fg-muted',
                readonly && !hasNote
                  ? 'opacity-40 cursor-not-allowed'
                  : 'hover:bg-bg-app hover:text-fg',
              ].join(' ')}
              aria-label={hasNote ? 'Ver/editar observação' : 'Adicionar observação'}
              title={hasNote ? 'Observação registrada' : 'Adicionar observação'}
            >
              {hasNote ? <MessageSquare size={16} /> : <MessageSquarePlus size={16} />}
            </button>
          )}
          {onCreateTask && !readonly && (
            <button
              type="button"
              onClick={onCreateTask}
              className="p-2 rounded-md text-fg-muted hover:bg-bg-app hover:text-fg transition-colors"
              aria-label="Criar tarefa a partir deste item"
              title="Criar tarefa a partir deste item"
            >
              <ListTodo size={16} />
            </button>
          )}
        </div>
      </div>

      {/* Note display (read-only, quando não está editando) */}
      {hasNote && !editingNote && (
        <div className="ml-10 mr-2 mb-1 -mt-0.5 px-2 py-1 rounded-md bg-bg-app/60 border-l-2 border-tom">
          <p className="text-caption text-fg-secondary whitespace-pre-wrap">{note}</p>
        </div>
      )}

      {/* Note editor */}
      {editingNote && (
        <div className="ml-10 mr-2 mb-2 mt-1 space-y-2">
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
                onClick={handleCancel}
                className="p-1.5 rounded-md text-fg-muted hover:bg-bg-app hover:text-fg transition-colors"
                aria-label="Cancelar"
              >
                <X size={14} />
              </button>
              <button
                type="button"
                onClick={handleSave}
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
