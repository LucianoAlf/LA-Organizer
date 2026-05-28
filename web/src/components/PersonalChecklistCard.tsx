// web/src/components/PersonalChecklistCard.tsx
// Sprint 22.38 — Card de lista pessoal (mercado, viagem, remédios, geral).
// Reusa ChecklistItemRow + ChecklistAddItemForm + RowMenu do design system.
// RLS owner-only no banco; aqui assumimos que o user logado é o owner.
// Sprint 29.x — Remover window.prompt/confirm. Edição via PersonalChecklistSheet,
// confirmações via ConfirmDialog. Emoji customizável via icon_emoji.
import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ChevronDown, ChevronRight } from 'lucide-react'
import {
  DndContext,
  closestCenter,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { useSortableSensors } from '../lib/sortableSensors'
import { RowMenu, type MenuItem } from './RowMenu'
import { ChecklistItemRow } from './ChecklistItemRow'
import { ChecklistAddItemForm } from './ChecklistAddItemForm'
import { PersonalChecklistSheet } from './PersonalChecklistSheet'
import { ConfirmDialog } from './ConfirmDialog'
import {
  toggleItem, addItem, deleteItem, reorderItems,
  archiveList, deleteList, saveItemNote,
} from '../lib/personalChecklists'
import {
  PERSONAL_LIST_TYPE_ICON,
  type PersonalChecklist,
  type PersonalChecklistItem,
} from '../types'

interface Props {
  list: PersonalChecklist
}

export function PersonalChecklistCard({ list }: Props) {
  const queryClient = useQueryClient()
  const sensors = useSortableSensors()

  const items: PersonalChecklistItem[] = useMemo(() => {
    return [...(list.personal_checklist_items ?? [])].sort((a, b) => a.sort_order - b.sort_order)
  }, [list.personal_checklist_items])

  const totalCount = items.length
  const doneCount = items.filter(i => i.is_done).length
  const pct = totalCount > 0 ? Math.round((doneCount / totalCount) * 100) : 0
  const allDone = totalCount > 0 && doneCount === totalCount

  // Collapse state — auto-colapsa quando 100%
  const storageKey = `personal-checklist:collapsed:${list.id}`
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false
    const stored = localStorage.getItem(storageKey)
    if (stored !== null) return stored === '1'
    return allDone
  })
  useEffect(() => {
    try { localStorage.setItem(storageKey, collapsed ? '1' : '0') } catch { /* noop */ }
  }, [collapsed, storageKey])

  // Auto-colapsa quando bate 100% (uma vez)
  const [autoCollapsed, setAutoCollapsed] = useState(false)
  useEffect(() => {
    if (allDone && !autoCollapsed && !collapsed) {
      setCollapsed(true)
      setAutoCollapsed(true)
    }
    if (!allDone && autoCollapsed) setAutoCollapsed(false)
  }, [allDone, autoCollapsed, collapsed])

  // Sheet de edição e dialogs de confirmação
  const [editSheetOpen, setEditSheetOpen]   = useState(false)
  const [confirmAction, setConfirmAction]   = useState<'archive' | 'delete' | null>(null)

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['personal-checklists'] })

  const toggleMutation = useMutation({
    mutationFn: ({ id, isDone }: { id: string; isDone: boolean }) => toggleItem(id, isDone),
    onSuccess: invalidate,
  })
  const addMutation = useMutation({
    mutationFn: (description: string) => {
      const nextOrder = items.length ? Math.max(...items.map(i => i.sort_order)) + 1 : 1
      return addItem(list.id, description, nextOrder)
    },
    onSuccess: invalidate,
  })
  const noteMutation = useMutation({
    mutationFn: ({ id, note }: { id: string; note: string }) => saveItemNote(id, note),
    onSuccess: invalidate,
  })
  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteItem(id),
    onSuccess: invalidate,
  })
  const reorderMutation = useMutation({
    mutationFn: (ordered: { id: string; sort_order: number }[]) => reorderItems(ordered),
    onSuccess: invalidate,
  })
  const archiveMutation = useMutation({
    mutationFn: () => archiveList(list.id),
    onSuccess: invalidate,
  })
  const deleteListMutation = useMutation({
    mutationFn: () => deleteList(list.id),
    onSuccess: invalidate,
  })

  function handleDragEnd(e: DragEndEvent) {
    const { active, over } = e
    if (!over || active.id === over.id) return
    const oldIndex = items.findIndex(i => i.id === active.id)
    const newIndex = items.findIndex(i => i.id === over.id)
    if (oldIndex === -1 || newIndex === -1) return
    const reordered = [...items]
    const [moved] = reordered.splice(oldIndex, 1)
    reordered.splice(newIndex, 0, moved)
    const updates = reordered.map((it, i) => ({ id: it.id, sort_order: i + 1 }))
    reorderMutation.mutate(updates)
  }

  // Menu do card — sem window.prompt/confirm
  const cardMenu: MenuItem[] = [
    {
      label: 'Editar',
      onClick: () => setEditSheetOpen(true),
    },
    {
      label: 'Arquivar',
      onClick: () => setConfirmAction('archive'),
    },
    {
      label: 'Apagar lista',
      danger: true,
      onClick: () => setConfirmAction('delete'),
    },
  ]

  return (
    <div className="bg-bg-surface rounded-xl shadow-sm border border-border">
      <div className="flex items-stretch">
        <button
          type="button"
          onClick={() => setCollapsed(v => !v)}
          className="flex-1 flex items-center gap-2 p-4 text-left focus-ring rounded-l-xl"
          aria-expanded={!collapsed}
        >
          <span className="text-fg-muted flex-shrink-0">
            {collapsed ? <ChevronRight size={18} /> : <ChevronDown size={18} />}
          </span>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1.5">
              <span className="text-lg flex-shrink-0" aria-hidden>
                {list.icon_emoji ?? PERSONAL_LIST_TYPE_ICON[list.list_type]}
              </span>
              <h3 className="text-card-title text-fg truncate">{list.name}</h3>
            </div>
            <div
              className="h-2 bg-bg-app rounded-full overflow-hidden"
              role="progressbar"
              aria-valuenow={pct}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label={`Progresso ${pct}%`}
            >
              <div
                className="h-full bg-tom transition-all"
                style={{ width: `${pct}%` }}
              />
            </div>
            <p className="text-body-sm text-fg-muted mt-1.5 tabular-nums">
              {doneCount}/{totalCount} itens ({pct}%)
            </p>
          </div>
        </button>
        <div className="flex items-center pr-2">
          <RowMenu items={cardMenu} />
        </div>
      </div>

      {!collapsed && (
        <div className="px-4 pb-4 space-y-1 border-t border-border pt-2">
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={items.map(i => i.id)}
              strategy={verticalListSortingStrategy}
            >
              {items.map((it, idx) => (
                <ChecklistItemRow
                  key={it.id}
                  uid={it.id}
                  index={idx + 1}
                  name={it.description}
                  done={it.is_done}
                  note={it.note ?? ''}
                  isAdHoc={false}
                  readonly={false}
                  canDelete
                  onToggle={() => toggleMutation.mutate({ id: it.id, isDone: !it.is_done })}
                  onSaveNote={(note) => noteMutation.mutate({ id: it.id, note })}
                  onDelete={() => deleteMutation.mutate(it.id)}
                />
              ))}
            </SortableContext>
          </DndContext>

          <ChecklistAddItemForm
            onAdd={(description) => addMutation.mutate(description)}
            busy={addMutation.isPending}
          />
        </div>
      )}

      {/* Sheet de edição */}
      <PersonalChecklistSheet
        open={editSheetOpen}
        onClose={() => setEditSheetOpen(false)}
        context={list.context}
        editList={list}
      />

      {/* Confirmação: arquivar */}
      <ConfirmDialog
        open={confirmAction === 'archive'}
        onClose={() => setConfirmAction(null)}
        title={`Arquivar "${list.name}"?`}
        description="A lista some da visualização mas pode ser recuperada depois."
        confirmLabel="Arquivar"
        confirmVariant="primary"
        onConfirm={() => { archiveMutation.mutate(); setConfirmAction(null) }}
        isPending={archiveMutation.isPending}
      />

      {/* Confirmação: apagar */}
      <ConfirmDialog
        open={confirmAction === 'delete'}
        onClose={() => setConfirmAction(null)}
        title={`Apagar "${list.name}"?`}
        description="Essa ação não pode ser desfeita. Todos os itens serão removidos."
        confirmLabel="Apagar lista"
        confirmVariant="danger"
        onConfirm={() => { deleteListMutation.mutate(); setConfirmAction(null) }}
        isPending={deleteListMutation.isPending}
      />
    </div>
  )
}
