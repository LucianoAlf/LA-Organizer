// web/src/components/DelegatedTaskRow.tsx
// Sprint 22.38 — Linha de leitura para tab Delegadas em /checklists.
// Mostra tasks que ESTE user criou e delegou para outro (created_by = self != assigned_to).
import { Link } from 'react-router-dom'

export interface DelegatedTaskRowData {
  id: string
  title: string
  status: string
  due_date: string | null
  project_id: string | null
  assigned_to: string
  projects?: { name: string } | null
  collaborators?: { full_name: string } | null
}

interface Props {
  task: DelegatedTaskRowData
}

function todayBRT(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date())
}

function statusEmoji(status: string, dueDate: string | null): string {
  const today = todayBRT()
  if (dueDate && dueDate < today && status !== 'done' && status !== 'cancelled') return '🔴'
  switch (status) {
    case 'pending': return '🟡'
    case 'in_progress': return '🟢'
    case 'awaiting_confirmation': return '🟣'
    case 'done': return '✅'
    case 'cancelled': return '⚪'
    default: return '⚪'
  }
}

function statusLabel(status: string): string {
  const map: Record<string, string> = {
    pending: 'pendente',
    in_progress: 'em andamento',
    awaiting_confirmation: 'aguardando',
    done: 'concluída',
    cancelled: 'cancelada',
  }
  return map[status] ?? status
}

function formatDue(d: string | null): string {
  if (!d) return 'sem prazo'
  const today = todayBRT()
  if (d === today) return 'hoje'
  // Yesterday/tomorrow simples (compara strings YMD)
  const [y, m, day] = d.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, day))
  const todayDt = new Date(today + 'T00:00:00Z')
  const diffDays = Math.round((dt.getTime() - todayDt.getTime()) / (24 * 3600 * 1000))
  if (diffDays === -1) return 'ontem'
  if (diffDays === 1) return 'amanhã'
  return dt.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', timeZone: 'UTC' })
}

export function DelegatedTaskRow({ task }: Props) {
  const assigneeName = task.collaborators?.full_name ?? 'colaborador'
  const target = task.project_id ? `/projetos/${task.project_id}` : '/agenda'

  return (
    <Link
      to={target}
      className="block bg-bg-surface rounded-xl border border-border p-3 hover:bg-bg-elevated transition-colors focus-ring"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <p className="text-body-sm text-fg-muted">👤 {assigneeName}</p>
          <p className="text-body text-fg font-medium truncate mt-0.5">{task.title}</p>
          <p className="text-caption text-fg-muted mt-1">
            📅 {formatDue(task.due_date)} · {statusEmoji(task.status, task.due_date)} {statusLabel(task.status)}
            {task.projects?.name && <> · {task.projects.name}</>}
          </p>
        </div>
      </div>
    </Link>
  )
}
