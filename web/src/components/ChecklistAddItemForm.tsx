// web/src/components/ChecklistAddItemForm.tsx
// Sprint 22.36 Fatia 5 — input inline pra criar item ad-hoc na instância de checklist.
// Items ad-hoc vivem em op_checklist_completion_extra_items, não poluem o template.
import { useState, FormEvent, KeyboardEvent } from 'react'
import { Plus } from 'lucide-react'

interface Props {
  onAdd: (description: string) => void
  busy?: boolean
}

export function ChecklistAddItemForm({ onAdd, busy }: Props) {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')

  function submit(e?: FormEvent) {
    if (e) e.preventDefault()
    const t = text.trim()
    if (!t) return
    onAdd(t)
    setText('')
    setOpen(false)
  }

  function onKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Escape') {
      setText('')
      setOpen(false)
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="w-full flex items-center gap-2 mt-1 px-2 py-2 text-body-sm text-fg-muted hover:text-fg hover:bg-bg-app rounded-lg transition-colors focus-ring"
        aria-label="Adicionar item"
      >
        <Plus size={14} />
        <span>+ Item</span>
      </button>
    )
  }

  return (
    <form onSubmit={submit} className="flex items-center gap-2 mt-1 px-2 py-1">
      <input
        type="text"
        value={text}
        autoFocus
        onChange={e => setText(e.target.value)}
        onKeyDown={onKey}
        placeholder="Novo item..."
        disabled={busy}
        className="flex-1 text-body-sm bg-bg-app border border-border rounded-md p-2 text-fg placeholder:text-fg-muted focus:outline-none focus:border-brand"
      />
      <button
        type="submit"
        disabled={busy || !text.trim()}
        className="px-3 py-2 text-body-sm rounded-md bg-brand text-white disabled:opacity-50 hover:opacity-90 transition-opacity"
      >
        Adicionar
      </button>
      <button
        type="button"
        onClick={() => { setText(''); setOpen(false); }}
        className="px-2 py-2 text-body-sm text-fg-muted hover:text-fg transition-colors"
      >
        ✕
      </button>
    </form>
  )
}
