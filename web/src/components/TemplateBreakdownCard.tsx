// web/src/components/TemplateBreakdownCard.tsx
// Sprint 22.37 — card por template no drilldown.
import { adherenceBorder, adherenceTone } from '../lib/adherence'
import type { AdherenceByTemplate } from '../types'

interface Props {
  data: AdherenceByTemplate
}

export function TemplateBreakdownCard({ data }: Props) {
  const tone = adherenceTone(data.pct)
  const borderCls = adherenceBorder(data.pct)
  const pctCls =
    tone === 'success' ? 'text-success' : tone === 'warning' ? 'text-warning' : 'text-danger'

  const annotations: string[] = []
  if (data.late_items > 0) annotations.push(`${data.late_items} com atraso`)
  if (data.escalated_count > 0) annotations.push(`${data.escalated_count} escaladas`)

  return (
    <div
      className={[
        'bg-bg-surface rounded-xl border border-border border-l-4 p-3',
        borderCls,
      ].join(' ')}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="text-fg font-medium truncate">{data.template_name}</div>
        <div className={['text-body-md font-bold tabular-nums', pctCls].join(' ')}>{data.pct}%</div>
      </div>

      <div className="mt-2 h-1 w-full bg-bg-elevated rounded-full overflow-hidden">
        <div className="h-full bg-tom" style={{ width: `${data.pct}%` }} />
      </div>

      <div className="mt-1 text-caption text-fg-muted tabular-nums">
        {data.completed}/{data.dispatched} fechados
        {annotations.length > 0 && <span> · {annotations.join(' · ')}</span>}
      </div>
    </div>
  )
}
