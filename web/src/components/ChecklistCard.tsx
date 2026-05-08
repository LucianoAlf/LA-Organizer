// web/src/components/ChecklistCard.tsx
// Sprint 22.35 — Polish + notas/ações por item.
// - Progress bar dinâmica: 🟢 ≥90%, 🟡 70–89%, 🔴 <70% (alinhado com aderência do PRD §4)
// - Tick visual na barra mostrando o threshold (meta) do template
// - Heading do card como h3 + text-section-title (não colide com h2 da página)
// - Toast quando auto-completa (atinge threshold)
// - Notas inline por item (campo `notes` em op_checklist_item_completions)
// - Ação "Criar tarefa" a partir de um item (skill subfluxo 5)
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { ChecklistItemRow } from './ChecklistItemRow'
import { showToast } from './Toast'
import type { OpChecklistCompletion, OpChecklistItemCompletion } from '../types'
import { isChecklistWindowClosed } from '../types'

interface Props {
  completion: OpChecklistCompletion
}

function progressTone(pct: number) {
  if (pct >= 90) return { bar: 'bg-success', text: 'text-success' }
  if (pct >= 70) return { bar: 'bg-warning', text: 'text-warning' }
  return { bar: 'bg-danger', text: 'text-danger' }
}

export function ChecklistCard({ completion }: Props) {
  const { collaborator } = useAuth()
  const queryClient = useQueryClient()
  const template = completion.op_checklists
  const items = [...(template.op_checklist_items ?? [])].sort(
    (a, b) => a.sort_order - b.sort_order
  )
  const itemCompletions: OpChecklistItemCompletion[] =
    completion.op_checklist_item_completions ?? []

  const doneCount = itemCompletions.filter(ic => ic.is_checked).length
  const totalCount = items.length
  const pct = totalCount > 0 ? Math.round((doneCount / totalCount) * 100) : 0
  const windowClosed = isChecklistWindowClosed(completion.dispatched_at)
  const readonly = !!completion.completed_at || windowClosed
  const tone = progressTone(pct)
  const threshold = template.completion_threshold

  const badge = completion.completed_at
    ? { label: '✅ Completo', cls: 'text-success' }
    : windowClosed
    ? { label: '⏰ Encerrado', cls: 'text-fg-muted' }
    : doneCount > 0
    ? { label: '🔄 Em andamento', cls: 'text-tom' }
    : { label: '⏳ Pendente', cls: 'text-fg-muted' }

  const toggleMutation = useMutation({
    mutationFn: async ({
      itemId,
      currentDone,
    }: {
      itemId: string
      currentDone: boolean
    }) => {
      const late = isChecklistWindowClosed(completion.dispatched_at)
      const { error } = await supabase.from('op_checklist_item_completions').upsert(
        {
          completion_id: completion.id,
          item_id: itemId,
          is_checked: !currentDone,
          channel: 'pwa',
          late,
        },
        { onConflict: 'completion_id,item_id' }
      )
      if (error) throw error

      // Recalculate threshold locally (closure value, mas com only-1-toggle rate isso é seguro)
      const newDone = !currentDone ? doneCount + 1 : Math.max(doneCount - 1, 0)
      const newPct = totalCount > 0 ? Math.round((newDone / totalCount) * 100) : 0
      const justCompleted =
        newPct >= template.completion_threshold && !completion.completed_at
      if (justCompleted) {
        await supabase
          .from('op_checklist_completions')
          .update({ completed_at: new Date().toISOString() })
          .eq('id', completion.id)
      }
      return { justCompleted }
    },
    onSuccess: ({ justCompleted }) => {
      if (justCompleted) {
        showToast({
          kind: 'success',
          title: '🎉 Checklist concluído!',
          msg: `${template.name} fechado por hoje.`,
        })
      }
    },
    onError: (err: Error) => {
      showToast({
        kind: 'error',
        title: 'Não consegui marcar',
        msg: err.message,
      })
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['checklists'] })
    },
  })

  const saveNoteMutation = useMutation({
    mutationFn: async ({ itemId, note }: { itemId: string; note: string }) => {
      const existing = itemCompletions.find(c => c.item_id === itemId)
      const late = isChecklistWindowClosed(completion.dispatched_at)
      const { error } = await supabase.from('op_checklist_item_completions').upsert(
        {
          completion_id: completion.id,
          item_id: itemId,
          is_checked: existing?.is_checked ?? false,
          channel: 'pwa',
          late,
          notes: note || null,
        },
        { onConflict: 'completion_id,item_id' }
      )
      if (error) throw error
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

  return (
    <div className="bg-bg-surface rounded-xl shadow-sm border border-border p-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-section-title text-fg">{template.name}</h3>
        <span className={['text-body-sm font-medium', badge.cls].join(' ')}>
          {badge.label}
        </span>
      </div>

      {/* Progress bar com tick no threshold */}
      <div className="relative w-full bg-bg-app rounded-full h-2 mb-1 overflow-visible">
        <div
          className={['h-2 rounded-full transition-all duration-300', tone.bar].join(' ')}
          style={{ width: `${pct}%` }}
          role="progressbar"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`Progresso ${pct}%, meta ${threshold}%`}
        />
        {/* Tick do threshold (meta) */}
        <div
          className="absolute top-[-2px] h-3 w-px bg-fg-muted opacity-70"
          style={{ left: `${threshold}%` }}
          aria-hidden
          title={`Meta: ${threshold}%`}
        />
      </div>
      <p className="text-label text-fg-muted mb-3">
        <span className={tone.text}>
          {doneCount}/{totalCount} itens ({pct}%)
        </span>
        <span className="ml-1">· meta {threshold}%</span>
      </p>

      {/* Items */}
      <div className="space-y-1">
        {items.map((item, index) => {
          const ic = itemCompletions.find(c => c.item_id === item.id)
          return (
            <ChecklistItemRow
              key={item.id}
              index={index + 1}
              name={item.description}
              done={ic?.is_checked ?? false}
              note={ic?.notes ?? ''}
              readonly={readonly}
              onToggle={() =>
                toggleMutation.mutate({ itemId: item.id, currentDone: ic?.is_checked ?? false })
              }
              onSaveNote={(note) =>
                saveNoteMutation.mutate({ itemId: item.id, note })
              }
              onCreateTask={() =>
                createTaskMutation.mutate({ title: item.description })
              }
            />
          )
        })}
      </div>
    </div>
  )
}
