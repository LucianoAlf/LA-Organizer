// web/src/components/AdherenceCard.tsx
// Sprint 22.37 — card de aderência por colab. Border-left 🟢🟡🔴, barra bg-tom.
// Click navega pro drilldown.
import { Link } from 'react-router-dom'
import { adherenceBorder, adherenceTone } from '../lib/adherence'
import type { AdherenceByCollab } from '../types'

interface Props {
  data: AdherenceByCollab
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

export function AdherenceCard({ data }: Props) {
  const tone = adherenceTone(data.pct)
  const borderCls = adherenceBorder(data.pct)
  const pctTextCls =
    tone === 'success' ? 'text-success' : tone === 'warning' ? 'text-warning' : 'text-danger'

  const subline = [
    UNIT_LABEL[data.unit ?? ''] ?? data.unit,
    ROLE_LABEL[data.role] ?? data.role,
  ].filter(Boolean).join(' · ')

  const annotations: string[] = []
  if (data.late_items > 0) annotations.push(`${data.late_items} com atraso`)
  if (data.escalated_count > 0) annotations.push(`${data.escalated_count} escaladas`)

  return (
    <Link
      to={`/mais/aderencia-checklists/${data.collab_id}`}
      className={[
        'block bg-bg-surface rounded-xl shadow-sm border border-border border-l-4 p-4',
        'hover:bg-bg-elevated transition-colors focus-ring',
        borderCls,
      ].join(' ')}
    >
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-full bg-tom text-black flex items-center justify-center font-semibold text-body-sm flex-shrink-0">
          {initials(data.full_name)}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-section-title text-fg truncate">{data.full_name}</div>
          {subline && <div className="text-caption text-fg-muted truncate">{subline}</div>}
        </div>
        <div className={['text-heading-sm font-bold tabular-nums', pctTextCls].join(' ')}>
          {data.pct}%
        </div>
      </div>

      <div className="mt-2 h-1.5 w-full bg-bg-elevated rounded-full overflow-hidden">
        <div
          className="h-full bg-tom transition-[width]"
          style={{ width: `${data.pct}%` }}
          role="progressbar"
          aria-valuenow={data.pct}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`Aderência ${data.pct}%`}
        />
      </div>

      <div className="mt-1 text-body-sm text-fg-muted tabular-nums">
        {data.completed}/{data.dispatched} fechados
        {annotations.length > 0 && (
          <span className="text-fg-muted"> · {annotations.join(' · ')}</span>
        )}
      </div>
    </Link>
  )
}
