// web/src/components/ChecklistCard.tsx
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { ChecklistItemRow } from './ChecklistItemRow'
import type { OpChecklistCompletion, OpChecklistItemCompletion } from '../types'
import { isChecklistWindowClosed } from '../types'

interface Props {
  completion: OpChecklistCompletion
}

export function ChecklistCard({ completion }: Props) {
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

      // Recalculate threshold locally
      const newDone = !currentDone ? doneCount + 1 : Math.max(doneCount - 1, 0)
      const newPct = totalCount > 0 ? Math.round((newDone / totalCount) * 100) : 0
      if (newPct >= template.completion_threshold && !completion.completed_at) {
        await supabase
          .from('op_checklist_completions')
          .update({ completed_at: new Date().toISOString() })
          .eq('id', completion.id)
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['checklists'] })
    },
  })

  return (
    <div className="bg-bg-surface rounded-xl shadow-sm border border-border p-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-body-md font-semibold text-fg">{template.name}</h2>
        <span className={['text-body-sm font-medium', badge.cls].join(' ')}>
          {badge.label}
        </span>
      </div>

      {/* Progress bar */}
      <div className="w-full bg-bg-app rounded-full h-2 mb-1">
        <div
          className="bg-success h-2 rounded-full transition-all duration-300"
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className="text-label text-fg-muted mb-3">
        {doneCount}/{totalCount} itens ({pct}%)
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
              readonly={readonly}
              onToggle={() =>
                toggleMutation.mutate({ itemId: item.id, currentDone: ic?.is_checked ?? false })
              }
            />
          )
        })}
      </div>
    </div>
  )
}
