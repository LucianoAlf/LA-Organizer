// web/src/components/CollabHeaderCard.tsx
// Sprint 22.37 — header do drilldown.
import { adherenceTone } from '../lib/adherence'
import type { AdherenceByCollab } from '../types'

interface Props {
  data: AdherenceByCollab
  windowLabel: string
}

const ROLE_LABEL: Record<string, string> = {
  director: 'direção',
  manager: 'gerente',
  coordinator: 'coordenador',
  collaborator: 'colaborador',
}

const UNIT_LABEL: Record<string, string> = {
  barra: 'Barra',
  recreio: 'Recreio',
  campo_grande: 'Campo Grande',
  all: 'Todas',
}

function initials(fullName: string) {
  const parts = fullName.trim().split(/\s+/)
  const first = parts[0]?.[0] ?? '?'
  const last = parts[parts.length - 1]?.[0] ?? ''
  return (first + (parts.length > 1 ? last : '')).toUpperCase()
}

export function CollabHeaderCard({ data, windowLabel }: Props) {
  const tone = adherenceTone(data.pct)
  const pctCls =
    tone === 'success' ? 'text-success' : tone === 'warning' ? 'text-warning' : 'text-danger'
  const subline = [
    UNIT_LABEL[data.unit ?? ''] ?? data.unit,
    ROLE_LABEL[data.role] ?? data.role,
  ].filter(Boolean).join(' · ')

  return (
    <div className="bg-bg-surface rounded-xl border border-border p-4">
      <div className="flex items-center gap-3">
        <div className="w-12 h-12 rounded-full bg-tom text-black flex items-center justify-center font-semibold flex-shrink-0">
          {initials(data.full_name)}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-section-title text-fg">{data.full_name}</div>
          {subline && <div className="text-body-sm text-fg-muted">{subline}</div>}
        </div>
        <div className="text-right">
          <div className={['text-heading-sm font-bold tabular-nums', pctCls].join(' ')}>{data.pct}%</div>
          <div className="text-caption text-fg-muted">{windowLabel}</div>
        </div>
      </div>

      <div className="mt-2 h-1.5 w-full bg-bg-elevated rounded-full overflow-hidden">
        <div
          className="h-full bg-tom transition-[width]"
          style={{ width: `${data.pct}%` }}
        />
      </div>
      <div className="mt-1 text-body-sm text-fg-muted tabular-nums">
        {data.completed}/{data.dispatched} fechados
        {data.late_items > 0 && <span> · {data.late_items} com atraso</span>}
        {data.escalated_count > 0 && <span> · {data.escalated_count} escaladas</span>}
      </div>
    </div>
  )
}
