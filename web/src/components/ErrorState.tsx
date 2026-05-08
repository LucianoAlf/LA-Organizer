// web/src/components/ErrorState.tsx
// Sprint 22.35 — Estado de erro reutilizável. Mesma estrutura visual do EmptyState
// mas com ícone/cor de aviso. Usado quando useQuery retorna error.
import { ReactNode } from 'react'
import { AlertTriangle } from 'lucide-react'

interface Props {
  icon?: ReactNode
  title?: string
  description?: string
  onRetry?: () => void
}

export function ErrorState({
  icon = <AlertTriangle size={32} />,
  title = 'Algo deu errado',
  description = 'Não consegui carregar agora. Tenta de novo em instantes.',
  onRetry,
}: Props) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-12 px-4">
      <div className="text-danger mb-3">{icon}</div>
      <h3 className="text-section-title text-fg mb-1">{title}</h3>
      <p className="text-body-sm text-fg-muted max-w-xs">{description}</p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="mt-4 px-4 py-2 rounded-lg bg-bg-surface border border-border text-body-sm text-fg hover:bg-bg-elevated transition-colors"
        >
          Tentar de novo
        </button>
      )}
    </div>
  )
}
