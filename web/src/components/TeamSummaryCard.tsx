// web/src/components/TeamSummaryCard.tsx
// Sprint 22.37 — resumo agregado da equipe filtrada. Mostra geral + count <70.
import type { AdherenceByCollab } from '../types'

interface Props {
  rows: AdherenceByCollab[]
}

export function TeamSummaryCard({ rows }: Props) {
  if (rows.length === 0) return null

  const totalDispatched = rows.reduce((acc, r) => acc + r.dispatched, 0)
  const totalCompleted = rows.reduce((acc, r) => acc + r.completed, 0)
  const overall = totalDispatched > 0
    ? Math.round((totalCompleted / totalDispatched) * 100)
    : 0
  const belowThreshold = rows.filter((r) => r.pct < 70).length

  const overallTextCls =
    overall >= 90 ? 'text-success' : overall >= 70 ? 'text-warning' : 'text-danger'

  return (
    <div className="bg-bg-surface rounded-xl border border-border p-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <div className="text-caption text-fg-muted uppercase tracking-wide">Equipe</div>
          <div className={['text-heading-sm font-bold tabular-nums', overallTextCls].join(' ')}>
            {overall}%
          </div>
        </div>
        <div className="text-right">
          <div className="text-caption text-fg-muted uppercase tracking-wide">Abaixo de 70%</div>
          <div className={['text-heading-sm font-bold tabular-nums', belowThreshold > 0 ? 'text-danger' : 'text-fg'].join(' ')}>
            {belowThreshold}
          </div>
        </div>
      </div>
    </div>
  )
}
