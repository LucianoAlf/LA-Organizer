// web/src/components/PersonalChecklistCard.tsx
// Sprint 22.38 — Card de lista pessoal (mercado, viagem, remédios, geral).
// Reusa ChecklistItemRow + ChecklistAddItemForm + RowMenu do design system.
// RLS owner-only no banco; aqui assumimos que o user logado é o owner.
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
import {
  toggleItem, addItem, updateItemDescription, deleteItem, reorderItems,
  renameList, changeListType, archiveList, saveItemNote,
} from '../lib/personalChecklists'
import {
  PERSONAL_LIST_TYPE_ICON,
  PERSONAL_LIST_TYPE_LABEL,
  type PersonalChecklist,
  type PersonalChecklistItem,
  type PersonalListType,
} from '../types'

interface Props {
  list: PersonalChecklist
}

const TYPES: PersonalListType[] = ['shopping', 'travel', 'meds', 'general']

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
  const renameMutation = useMutation({
    mutationFn: (name: string) => renameList(list.id, name),
    onSuccess: invalidate,
  })
  const typeMutation = useMutation({
    mutationFn: (t: PersonalListType) => changeListType(list.id, t),
    onSuccess: invalidate,
  })
  const archiveMutation = useMutation({
    mutationFn: () => archiveList(list.id),
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

  // ⋮ menu do card. "Mudar tipo" só faz sentido pra context='personal'.
  const isPersonal = list.context === 'personal'
  const cardMenu: MenuItem[] = [
    {
      label: 'Renomear',
      onClick: () => {
        const next = window.prompt('Novo nome', list.name)
        if (next && next.trim() && next !== list.name) renameMutation.mutate(next.trim())
      },
    },
    ...(isPersonal ? [{
      label: 'Mudar tipo',
      onClick: () => {
        const labels = TYPES.map(t => `${PERSONAL_LIST_TYPE_ICON[t]} ${PERSONAL_LIST_TYPE_LABEL[t]}`).join('\n')
        const next = window.prompt(
          `Digite o tipo:\n\n${labels}\n\n(shopping / travel / meds / general)`,
          list.list_type,
        )
        if (next && (TYPES as string[]).includes(next) && next !== list.list_type) {
          typeMutation.mutate(next as PersonalListType)
        }
      },
    }] : []),
    {
      label: 'Arquivar',
      onClick: () => archiveMutation.mutate(),
      danger: true,
      confirm: 'Arquivar essa lista? Some da visualização.',
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
                {PERSONAL_LIST_TYPE_ICON[list.list_type]}
              </span>
              <h3 className="text-section-title text-fg truncate">{list.name}</h3>
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
    </div>
  )
}
