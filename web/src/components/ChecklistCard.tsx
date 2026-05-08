// web/src/components/ChecklistCard.tsx
// Sprint 22.36 — Refactor pro design system de /projetos:
//  - Header colapsável (chevron + click toggle, persiste em localStorage)
//  - ⋮ menu no card (Editar template via /mais/checklists-templates)
//  - Drag handle ⋮⋮ por item, reorder per-user via op_checklist_item_completions.user_sort_order
//  - "+ Item" cria item ad-hoc (op_checklist_completion_extra_items)
//  - ⋮ menu por item: Adicionar/editar nota, Criar tarefa, Apagar (só ad-hoc)
//  - Auto-colapsa quando completa 100%
//  - Notifica TOM via /internal/checklist-completed quando bate 100% (2 Zaps)
//
// Fatia 1: meta sempre 100%, barra dinâmica 🔴<70/🟡70-99/🟢100, sem tick.
import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
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
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { showToast } from './Toast'
import { RowMenu, type MenuItem } from './RowMenu'
import { ChecklistItemRow } from './ChecklistItemRow'
import { ChecklistAddItemForm } from './ChecklistAddItemForm'
import { notifyChecklistCompleted } from '../lib/tomEngine'
import type {
  OpChecklistCompletion,
  OpChecklistItemCompletion,
  OpChecklistCompletionExtraItem,
} from '../types'
import { isChecklistWindowClosed } from '../types'

interface Props {
  completion: OpChecklistCompletion
}

// Sprint 22.36 (revisão) — alinhado com /projetos: barra sempre `bg-tom`,
// igual a ProjectCard. Sem escala vermelho/amarelo (semântica diferente do resto
// do app). Cor é única, intensidade é dada pelo preenchimento (% width).

interface UnifiedItem {
  id: string
  description: string
  done: boolean
  note: string
  isAdHoc: boolean
  templateSortOrder: number
  userSortOrder: number | null
}

export function ChecklistCard({ completion }: Props) {
  const { collaborator } = useAuth()
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const sensors = useSortableSensors()

  const template = completion.op_checklists
  const isLeadership =
    collaborator?.role === 'coordinator' || collaborator?.role === 'director'

  // ─── Build unified item list (template + ad-hoc) sorted by user_sort_order ?? sort_order
  const itemCompletions: OpChecklistItemCompletion[] =
    completion.op_checklist_item_completions ?? []
  const extraItems: OpChecklistCompletionExtraItem[] =
    completion.op_checklist_completion_extra_items ?? []

  const unified: UnifiedItem[] = useMemo(() => {
    const fromTemplate: UnifiedItem[] = (template.op_checklist_items ?? []).map(it => {
      const ic = itemCompletions.find(c => c.item_id === it.id)
      return {
        id: `tpl:${it.id}`,
        description: it.description,
        done: ic?.is_checked ?? false,
        note: ic?.notes ?? '',
        isAdHoc: false,
        templateSortOrder: it.sort_order,
        userSortOrder: ic?.user_sort_order ?? null,
      }
    })
    const fromAdhoc: UnifiedItem[] = extraItems.map(ex => ({
      id: `adhoc:${ex.id}`,
      description: ex.description,
      done: ex.is_checked,
      note: ex.notes ?? '',
      isAdHoc: true,
      templateSortOrder: ex.sort_order,
      userSortOrder: ex.user_sort_order ?? null,
    }))
    return [...fromTemplate, ...fromAdhoc].sort((a, b) => {
      const aOrd = a.userSortOrder ?? a.templateSortOrder
      const bOrd = b.userSortOrder ?? b.templateSortOrder
      return aOrd - bOrd
    })
  }, [template.op_checklist_items, itemCompletions, extraItems])

  const totalCount = unified.length
  const doneCount = unified.filter(u => u.done).length
  const pct = totalCount > 0 ? Math.round((doneCount / totalCount) * 100) : 0
  const windowClosed = isChecklistWindowClosed(completion.dispatched_at)
  // Sprint 22.36 (revisão) — só bloqueia interação quando a janela 6h fechou.
  // Antes: readonly assim que completed_at era setado → user não conseguia
  // desmarcar item (mesmo padrão do TaskRow no /projetos: tarefa "done" pode
  // ser re-aberta clicando no checkbox).
  const readonly = windowClosed

  // ─── Collapse state per-completion (auto-colapsa quando completo)
  const storageKey = `checklist:collapsed:${completion.id}`
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false
    const stored = localStorage.getItem(storageKey)
    if (stored !== null) return stored === '1'
    // Default: completos começam colapsados
    return !!completion.completed_at
  })
  useEffect(() => {
    try {
      localStorage.setItem(storageKey, collapsed ? '1' : '0')
    } catch {
      // localStorage cheio/disabled — silenciar
    }
  }, [collapsed, storageKey])

  const badge = completion.completed_at
    ? { label: '✅ Completo', cls: 'text-tom' }
    : windowClosed
    ? { label: '⏰ Encerrado', cls: 'text-fg-muted' }
    : doneCount > 0
    ? { label: '🔄 Em andamento', cls: 'text-tom' }
    : { label: '⏳ Pendente', cls: 'text-fg-muted' }

  // ─── Mutations ──────────────────────────────────────────────────────────

  // Toggle: marca/desmarca item, recalcula pct, marca completed_at se 100%, dispara TOM.
  const toggleMutation = useMutation({
    mutationFn: async ({ uid, currentDone }: { uid: string; currentDone: boolean }) => {
      const next = !currentDone
      const late = isChecklistWindowClosed(completion.dispatched_at)
      if (uid.startsWith('tpl:')) {
        const itemId = uid.slice(4)
        const { error } = await supabase
          .from('op_checklist_item_completions')
          .upsert(
            {
              completion_id: completion.id,
              item_id: itemId,
              is_checked: next,
              channel: 'pwa',
              late,
            },
            { onConflict: 'completion_id,item_id' }
          )
        if (error) throw error
      } else {
        const exId = uid.slice(6)
        const { error } = await supabase
          .from('op_checklist_completion_extra_items')
          .update({ is_checked: next })
          .eq('id', exId)
        if (error) throw error
      }

      // Recalcula
      const newDone = next ? doneCount + 1 : Math.max(doneCount - 1, 0)
      const newPct = totalCount > 0 ? Math.round((newDone / totalCount) * 100) : 0
      const justCompleted = newPct >= 100 && !completion.completed_at
      const justUncompleted = newPct < 100 && !!completion.completed_at
      if (justCompleted) {
        await supabase
          .from('op_checklist_completions')
          .update({ completed_at: new Date().toISOString() })
          .eq('id', completion.id)
      } else if (justUncompleted) {
        // Sprint 22.36 (revisão) — user desmarcou item num checklist 100%.
        // Limpa completed_at pra refletir que voltou pra "em andamento".
        await supabase
          .from('op_checklist_completions')
          .update({ completed_at: null })
          .eq('id', completion.id)
      }
      return { justCompleted, justUncompleted }
    },
    onSuccess: async ({ justCompleted, justUncompleted }) => {
      if (justCompleted) {
        showToast({
          kind: 'success',
          title: '🎉 Checklist concluído!',
          msg: `${template.name} fechado por hoje.`,
        })
        setCollapsed(true)
        const r = await notifyChecklistCompleted(completion.id)
        if (!r.ok) {
          console.warn('[ChecklistCard] notifyChecklistCompleted falhou:', r.reason)
        }
      } else if (justUncompleted) {
        // Reabriu o card, retira o auto-colapse pra usuário ver o que falta.
        setCollapsed(false)
      }
    },
    onError: (err: Error) => {
      showToast({ kind: 'error', title: 'Não consegui marcar', msg: err.message })
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['checklists'] })
    },
  })

  // Save note
  const saveNoteMutation = useMutation({
    mutationFn: async ({ uid, note }: { uid: string; note: string }) => {
      const trimmed = note.trim()
      const value = trimmed || null
      const late = isChecklistWindowClosed(completion.dispatched_at)
      if (uid.startsWith('tpl:')) {
        const itemId = uid.slice(4)
        const existing = itemCompletions.find(c => c.item_id === itemId)
        const { error } = await supabase
          .from('op_checklist_item_completions')
          .upsert(
            {
              completion_id: completion.id,
              item_id: itemId,
              is_checked: existing?.is_checked ?? false,
              channel: 'pwa',
              late,
              notes: value,
            },
            { onConflict: 'completion_id,item_id' }
          )
        if (error) throw error
      } else {
        const exId = uid.slice(6)
        const { error } = await supabase
          .from('op_checklist_completion_extra_items')
          .update({ notes: value })
          .eq('id', exId)
        if (error) throw error
      }
    },
    onSuccess: () => {
      showToast({ kind: 'success', title: 'Observação registrada' })
    },
    onError: (err: Error) => {
      showToast({ kind: 'error', title: 'Não consegui salvar', msg: err.message })
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['checklists'] })
    },
  })

  // Create task from item description
  const createTaskMutation = useMutation({
    mutationFn: async ({ title }: { title: string }) => {
      if (!collaborator) throw new Error('Sem usuário autenticado')
      const today = new Date().toISOString().slice(0, 10)
      const { error } = await supabase.from('tasks').insert({
        title,
        context: 'work',
        status: 'pending',
        due_date: today,
        created_by: collaborator.id,
        assigned_to: collaborator.id,
        source: 'manual',
      })
      if (error) throw error
    },
    onSuccess: () => {
      showToast({
        kind: 'success',
        title: 'Tarefa criada',
        msg: 'Aparece em Agenda > Hoje.',
      })
      queryClient.invalidateQueries({ queryKey: ['tasks'] })
    },
    onError: (err: Error) => {
      showToast({ kind: 'error', title: 'Não criou tarefa', msg: err.message })
    },
  })

  // Add ad-hoc item
  const addItemMutation = useMutation({
    mutationFn: async (description: string) => {
      if (!collaborator) throw new Error('Sem usuário autenticado')
      const trimmed = description.trim()
      if (!trimmed) throw new Error('Descrição vazia')
      // sort_order: depois do maior ad-hoc atual
      const maxOrder = Math.max(
        9999,
        ...extraItems.map(e => e.sort_order ?? 9999)
      )
      const { error } = await supabase
        .from('op_checklist_completion_extra_items')
        .insert({
          completion_id: completion.id,
          description: trimmed,
          sort_order: maxOrder + 1,
          created_by: collaborator.id,
        })
      if (error) throw error
    },
    onSuccess: () => {
      showToast({ kind: 'success', title: 'Item adicionado' })
    },
    onError: (err: Error) => {
      showToast({ kind: 'error', title: 'Não adicionou', msg: err.message })
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['checklists'] })
    },
  })

  // Delete ad-hoc item
  const deleteItemMutation = useMutation({
    mutationFn: async (uid: string) => {
      if (!uid.startsWith('adhoc:')) throw new Error('Apenas items ad-hoc podem ser apagados')
      const exId = uid.slice(6)
      const { error } = await supabase
        .from('op_checklist_completion_extra_items')
        .delete()
        .eq('id', exId)
      if (error) throw error
    },
    onSuccess: () => {
      showToast({ kind: 'success', title: 'Item apagado' })
    },
    onError: (err: Error) => {
      showToast({ kind: 'error', title: 'Não consegui apagar', msg: err.message })
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['checklists'] })
    },
  })

  // Reorder per-user via DnD
  const reorderMutation = useMutation({
    mutationFn: async (orderedIds: string[]) => {
      const late = isChecklistWindowClosed(completion.dispatched_at)
      await Promise.all(orderedIds.map(async (uid, idx) => {
        const newOrder = idx + 1
        if (uid.startsWith('tpl:')) {
          const itemId = uid.slice(4)
          const ic = itemCompletions.find(c => c.item_id === itemId)
          const { error } = await supabase
            .from('op_checklist_item_completions')
            .upsert(
              {
                completion_id: completion.id,
                item_id: itemId,
                is_checked: ic?.is_checked ?? false,
                channel: 'pwa',
                late,
                user_sort_order: newOrder,
              },
              { onConflict: 'completion_id,item_id' }
            )
          if (error) throw new Error(error.message)
        } else {
          const exId = uid.slice(6)
          const { error } = await supabase
            .from('op_checklist_completion_extra_items')
            .update({ user_sort_order: newOrder })
            .eq('id', exId)
          if (error) throw new Error(error.message)
        }
      }))
    },
    onError: (err: Error) => {
      showToast({ kind: 'error', title: 'Não consegui reordenar', msg: err.message })
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['checklists'] })
    },
  })

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const ids = unified.map(u => u.id)
    const oldIdx = ids.indexOf(String(active.id))
    const newIdx = ids.indexOf(String(over.id))
    if (oldIdx < 0 || newIdx < 0) return
    const next = [...ids]
    next.splice(oldIdx, 1)
    next.splice(newIdx, 0, String(active.id))
    reorderMutation.mutate(next)
  }

  // ─── Card menu items
  const cardMenu: MenuItem[] = []
  if (isLeadership) {
    cardMenu.push({
      label: 'Editar template',
      onClick: () => navigate('/mais/checklists-templates'),
    })
  }

  return (
    <div className="bg-bg-surface rounded-xl shadow-sm border border-border">
      {/* Header (clickable to toggle collapse) */}
      <button
        type="button"
        onClick={() => setCollapsed(v => !v)}
        className="w-full flex items-center gap-2 p-4 text-left focus-ring rounded-t-xl"
        aria-expanded={!collapsed}
      >
        <span className="text-fg-muted flex-shrink-0">
          {collapsed ? <ChevronRight size={18} /> : <ChevronDown size={18} />}
        </span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-section-title text-fg truncate">{template.name}</h3>
            <div className="flex items-center gap-1 flex-shrink-0">
              <span className={['text-body-sm font-medium whitespace-nowrap', badge.cls].join(' ')}>
                {badge.label}
              </span>
              {cardMenu.length > 0 && (
                <span onClick={e => e.stopPropagation()}>
                  <RowMenu items={cardMenu} />
                </span>
              )}
            </div>
          </div>

          {/* Progress bar — mesmo token de /projetos (bg-tom em fundo bg-bg-elevated) */}
          <div className="mt-2 h-1.5 w-full bg-bg-elevated rounded-full overflow-hidden">
            <div
              className="h-full bg-tom transition-[width]"
              style={{ width: `${pct}%` }}
              role="progressbar"
              aria-valuenow={pct}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label={`Progresso ${pct}%`}
            />
          </div>
          <p className="text-body-sm text-fg-muted mt-1.5 tabular-nums">
            {doneCount}/{totalCount} itens ({pct}%)
          </p>
        </div>
      </button>

      {/* Items (when expanded) */}
      {!collapsed && (
        <div className="px-4 pb-4 space-y-1 border-t border-border pt-2">
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={unified.map(u => u.id)}
              strategy={verticalListSortingStrategy}
            >
              {unified.map((u, idx) => (
                <ChecklistItemRow
                  key={u.id}
                  uid={u.id}
                  index={idx + 1}
                  name={u.description}
                  done={u.done}
                  note={u.note}
                  isAdHoc={u.isAdHoc}
                  readonly={readonly}
                  onToggle={() =>
                    toggleMutation.mutate({ uid: u.id, currentDone: u.done })
                  }
                  onSaveNote={(note) =>
                    saveNoteMutation.mutate({ uid: u.id, note })
                  }
                  onCreateTask={() =>
                    createTaskMutation.mutate({ title: u.description })
                  }
                  onDelete={() => deleteItemMutation.mutate(u.id)}
                />
              ))}
            </SortableContext>
          </DndContext>

          {/* + Item (só quando não readonly) */}
          {!readonly && (
            <ChecklistAddItemForm
              onAdd={(text) => addItemMutation.mutate(text)}
              busy={addItemMutation.isPending}
            />
          )}
        </div>
      )}
    </div>
  )
}
