// web/src/components/TeamChecklistRow.tsx
// Sprint 22.38b — Linha de leitura para tab Delegadas em /checklists.
// Mostra status hoje de UM op_checklist_completion da equipe (filtrado por scope).
// Ex: "✅ Abertura Escola Barra · Cláudia · 7:32" / "⏳ Fechamento Recreio · Krissya · vence 21:30"
import { isChecklistWindowClosed } from '../types'

export interface TeamChecklistRowData {
  id: string
  completed_at: string | null
  dispatched_at: string
  reference_date: string
  collaborator: { full_name: string; unit: string | null } | null
  op_checklists: {
    id: string
    name: string
    function_role: string
    unit: string
    dispatch_time: string
    completion_threshold: number
  } | null
  op_checklist_item_completions: { is_checked: boolean }[]
  op_checklist_completion_extra_items: { is_checked: boolean }[]
}

interface Props {
  data: TeamChecklistRowData
  done: number
  total: number
  pct: number
  isClosed: boolean
}

const UNIT_LABEL: Record<string, string> = {
  all: 'todas',
  barra: 'Barra',
  recreio: 'Recreio',
  campo_grande: 'Campo Grande',
}

function formatHHMM(t: string | null | undefined): string {
  if (!t) return '—'
  return t.slice(0, 5)
}

function formatCompletedAt(iso: string | null): string {
  if (!iso) return ''
  try {
    return new Intl.DateTimeFormat('pt-BR', {
      timeZone: 'America/Sao_Paulo',
      hour: '2-digit', minute: '2-digit', hour12: false,
    }).format(new Date(iso))
  } catch { return '' }
}

export function TeamChecklistRow({ data, done, total, pct, isClosed }: Props) {
  const tpl = data.op_checklists
  if (!tpl) return null

  const collabName = data.collaborator?.full_name?.split(' ')[0] ?? '—'
  const windowClosed = isChecklistWindowClosed(data.dispatched_at)

  // Status:
  //  ✅ done (completed_at)
  //  🟡 in progress (done > 0)
  //  🔴 late (window closed without completion)
  //  ⏳ pending
  let emoji = '⏳'
  let statusLabel = 'pendente'
  let statusTone = 'text-fg-muted'
  let borderTone = 'border-border'
  if (isClosed) {
    emoji = '✅'
    statusLabel = `fechou ${formatCompletedAt(data.completed_at)}`
    statusTone = 'text-tom'
    borderTone = 'border-tom/40'
  } else if (windowClosed) {
    emoji = '🔴'
    statusLabel = `atrasado · ${done}/${total}`
    statusTone = 'text-danger'
    borderTone = 'border-danger/40'
  } else if (done > 0) {
    emoji = '🟡'
    statusLabel = `em andamento · ${done}/${total} (${pct}%)`
    statusTone = 'text-fg'
    borderTone = 'border-tom/30'
  }

  return (
    <div className={[
      'bg-bg-surface rounded-md border-l-4 border-y border-r border-border',
      borderTone,
      'p-3',
    ].join(' ')}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <p className="text-body-md font-semibold text-fg truncate">
            {emoji} {tpl.name}
          </p>
          <p className="text-body-sm text-fg-muted mt-0.5">
            {collabName} · {UNIT_LABEL[tpl.unit] ?? tpl.unit} · {formatHHMM(tpl.dispatch_time)}
          </p>
          <p className={['text-caption mt-1', statusTone].join(' ')}>
            {statusLabel}
          </p>
        </div>
      </div>
    </div>
  )
}
