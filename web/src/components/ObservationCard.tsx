// web/src/components/ObservationCard.tsx
// Sprint 22.37 — card de observação capturada (drilldown).
import type { AdherenceObservation } from '../types'

interface Props {
  obs: AdherenceObservation
}

function fmtDateBR(ymd: string): string {
  if (!ymd || ymd.length < 10) return ymd
  const [, m, d] = ymd.split('-')
  return `${d}/${m}`
}

export function ObservationCard({ obs }: Props) {
  return (
    <div className="bg-bg-surface rounded-xl border border-border border-l-2 border-l-tom p-3">
      <p className="text-body-sm text-fg whitespace-pre-wrap">{obs.notes}</p>
      <p className="mt-1 text-caption text-fg-muted">
        {obs.template_name}
        {obs.item_description && <span> · {obs.item_description}</span>}
        <span> · {fmtDateBR(obs.reference_date)}</span>
      </p>
    </div>
  )
}
