// web/src/screens/AderenciaChecklists.tsx
// Sprint 22.37 — Tela /mais/aderencia-checklists.
// Acesso: director (vê todas unidades) + manager unit-específica (vê só sua).
// Manager unit='all' (Yuri) vê empty state explicativo.
import { ClipboardCheck } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { LoadingState } from '../components/LoadingState'
import { EmptyState } from '../components/EmptyState'
import { ErrorState } from '../components/ErrorState'
import { TimeWindowChips } from '../components/TimeWindowChips'
import { UnitFilterChips } from '../components/UnitFilterChips'
import { TeamSummaryCard } from '../components/TeamSummaryCard'
import { AdherenceCard } from '../components/AdherenceCard'
import {
  useAdherenceWindow,
  useUnitFilter,
  useAdherenceByCollab,
} from '../hooks/useAdherence'

export function AderenciaChecklists() {
  const { collaborator } = useAuth()
  const [window, setWindow] = useAdherenceWindow()
  const [unit, setUnit] = useUnitFilter()

  const isDirector = collaborator?.role === 'director'
  const isUnitManager =
    collaborator?.role === 'manager' && collaborator?.unit !== 'all'

  // Yuri (manager unit='all', Marketing) — empty state explicativo.
  if (collaborator?.role === 'manager' && collaborator?.unit === 'all') {
    return (
      <EmptyState
        icon={<ClipboardCheck size={32} />}
        title="Sem unidade operacional"
        description="Você não tem uma unidade operacional atribuída. Fale com a direção se isso não tá certo."
      />
    )
  }

  if (!isDirector && !isUnitManager) {
    return (
      <EmptyState
        icon={<ClipboardCheck size={32} />}
        title="Acesso restrito"
        description="Esta tela é só pra liderança operacional (direção e gerência de unidade)."
      />
    )
  }

  const effectiveUnit = isDirector ? unit : (collaborator?.unit ?? null)
  const { data: rows = [], isLoading, error, refetch } = useAdherenceByCollab(window, effectiveUnit)

  return (
    <div className="space-y-md">
      <h2 className="text-section-title">Aderência operacional</h2>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <TimeWindowChips value={window} onChange={setWindow} />
        {isDirector && <UnitFilterChips value={unit} onChange={setUnit} />}
      </div>

      {isLoading && <LoadingState rows={3} />}

      {error && (
        <ErrorState
          title="Não consegui carregar a aderência"
          description="Pode ser conexão ou um problema no servidor."
          onRetry={() => refetch()}
        />
      )}

      {!isLoading && !error && rows.length === 0 && (
        <EmptyState
          icon={<ClipboardCheck size={32} />}
          title="Sem checklists despachados"
          description="Não tem checklist no período selecionado pra esses colaboradores."
        />
      )}

      {!isLoading && !error && rows.length > 0 && (
        <>
          <TeamSummaryCard rows={rows} />
          <div className="space-y-sm">
            {rows.map((row) => (
              <AdherenceCard key={row.collab_id} data={row} />
            ))}
          </div>
        </>
      )}
    </div>
  )
}
