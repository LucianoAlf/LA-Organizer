// web/src/screens/AderenciaChecklistDetalhe.tsx
// Sprint 22.37 — drilldown /mais/aderencia-checklists/:colabId.
import { useNavigate, useParams } from 'react-router-dom'
import { ChevronLeft, ClipboardCheck } from 'lucide-react'
import { LoadingState } from '../components/LoadingState'
import { EmptyState } from '../components/EmptyState'
import { ErrorState } from '../components/ErrorState'
import { CollabHeaderCard } from '../components/CollabHeaderCard'
import { TemplateBreakdownCard } from '../components/TemplateBreakdownCard'
import { ObservationCard } from '../components/ObservationCard'
import {
  useAdherenceWindow,
  useUnitFilter,
  useAdherenceByCollab,
  useAdherenceByTemplate,
  useAdherenceObservations,
} from '../hooks/useAdherence'

const WINDOW_LABEL: Record<string, string> = {
  today: 'hoje',
  week: 'semana',
  month: 'mês',
}

export function AderenciaChecklistDetalhe() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [window] = useAdherenceWindow()
  const [unit] = useUnitFilter()

  const listQuery = useAdherenceByCollab(window, unit)
  const collab = (listQuery.data ?? []).find((c) => c.collab_id === id)

  const tplQuery = useAdherenceByTemplate(id, window)
  const obsQuery = useAdherenceObservations(id, window)

  return (
    <div className="space-y-md">
      <button
        type="button"
        onClick={() => navigate('/mais/aderencia-checklists')}
        className="inline-flex items-center gap-1 text-tom hover:text-tom-shade focus-ring rounded-sm"
      >
        <ChevronLeft size={16} />
        <span className="text-body-sm">Aderência</span>
      </button>

      {listQuery.isLoading && <LoadingState rows={1} />}

      {listQuery.error && (
        <ErrorState
          title="Não consegui carregar"
          description="Pode ser conexão ou permissão."
          onRetry={() => listQuery.refetch()}
        />
      )}

      {!listQuery.isLoading && !listQuery.error && !collab && (
        <EmptyState
          icon={<ClipboardCheck size={32} />}
          title="Colaborador não encontrado"
          description="Pode ser que ele não tenha checklist na janela selecionada, ou esteja fora da sua unidade."
        />
      )}

      {collab && (
        <>
          <CollabHeaderCard data={collab} windowLabel={WINDOW_LABEL[window] ?? window} />

          <div>
            <h3 className="text-label text-fg-muted uppercase tracking-wide mb-2">Por checklist</h3>
            {tplQuery.isLoading && <LoadingState rows={2} />}
            {tplQuery.error && (
              <ErrorState
                title="Não consegui carregar breakdown"
                description=""
                onRetry={() => tplQuery.refetch()}
              />
            )}
            {!tplQuery.isLoading && !tplQuery.error && (tplQuery.data ?? []).length === 0 && (
              <p className="text-body-sm text-fg-muted">Sem despachos no período.</p>
            )}
            <div className="space-y-sm">
              {(tplQuery.data ?? []).map((tpl) => (
                <TemplateBreakdownCard key={tpl.template_id} data={tpl} />
              ))}
            </div>
          </div>

          <div>
            <h3 className="text-label text-fg-muted uppercase tracking-wide mb-2">Observações capturadas</h3>
            {obsQuery.isLoading && <LoadingState rows={1} />}
            {!obsQuery.isLoading && (obsQuery.data ?? []).length === 0 && (
              <p className="text-body-sm text-fg-muted">Sem observações registradas.</p>
            )}
            <div className="space-y-sm">
              {(obsQuery.data ?? []).map((obs, idx) => (
                <ObservationCard key={idx} obs={obs} />
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
