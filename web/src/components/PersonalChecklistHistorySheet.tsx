// web/src/components/PersonalChecklistHistorySheet.tsx
// Drawer (BottomSheet) com o histórico dia-a-dia de uma lista pessoal recorrente.
// Mold: AderenciaTabela (badge de data + barra de progresso) em formato timeline.
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { BottomSheet } from './BottomSheet'
import { useAuth } from '../contexts/AuthContext'
import { fetchPersonalHistory, type PersonalHistoryDay } from '../lib/personalCompletions'
import { brShort, dowShort } from '../utils/date'
import { LoadingState } from './LoadingState'
import { EmptyState } from './EmptyState'
import type { PersonalChecklist } from '../types'

interface Props {
  open: boolean
  onClose: () => void
  list: PersonalChecklist
}

export function PersonalChecklistHistorySheet({ open, onClose, list }: Props) {
  const { collaborator } = useAuth()
  const collabId = collaborator?.id ?? null

  const { data: days = [], isLoading } = useQuery({
    queryKey: ['personal-history', list.id, collabId],
    enabled: open && !!collabId,
    queryFn: () => fetchPersonalHistory(list.id, collabId!, 30),
    staleTime: 30_000,
  })

  return (
    <BottomSheet open={open} onClose={onClose} title={`Histórico — ${list.name}`}>
      {isLoading ? (
        <LoadingState rows={3} />
      ) : days.length === 0 ? (
        <EmptyState
          title="Sem histórico ainda"
          description="Quando você marcar itens dia a dia, o histórico aparece aqui."
        />
      ) : (
        <div className="space-y-2">
          {days.map((d) => (
            <HistoryRow key={d.reference_date} day={d} />
          ))}
        </div>
      )}
    </BottomSheet>
  )
}

function HistoryRow({ day }: { day: PersonalHistoryDay }) {
  const [expanded, setExpanded] = useState(false)
  return (
    <div className="bg-bg-app rounded-lg border border-border">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center gap-2 p-3 text-left focus-ring rounded-lg"
        aria-expanded={expanded}
      >
        <span className="text-fg-muted flex-shrink-0">
          {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        </span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between mb-1">
            <span className="text-body-sm text-fg font-medium tabular-nums">
              {dowShort(day.reference_date)} {brShort(day.reference_date)}
            </span>
            <span className="text-body-sm text-fg-muted tabular-nums">
              {day.done}/{day.total} ({day.pct}%)
            </span>
          </div>
          <div className="h-2 bg-bg-surface rounded-full overflow-hidden">
            <div className="h-full bg-tom transition-all" style={{ width: `${day.pct}%` }} />
          </div>
        </div>
      </button>
      {expanded && (
        <ul className="px-3 pb-3 pt-1 space-y-1 border-t border-border">
          {day.items.map((it) => (
            <li key={it.id} className="flex items-center gap-2 text-body-sm">
              <span className={it.is_checked ? 'text-tom' : 'text-fg-muted'}>
                {it.is_checked ? '✓' : '○'}
              </span>
              <span className={it.is_checked ? 'text-fg' : 'text-fg-muted line-through'}>
                {it.description}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
