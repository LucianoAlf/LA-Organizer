// web/src/hooks/useAdherence.ts
// Sprint 22.37 — wrappers TanStack Query pras tela de aderência.
// Estado da janela e do filtro de unidade vivem em URLSearchParams pra
// preservar quando user faz drilldown e volta.

import { useQuery } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import {
  fetchAdherenceByCollab,
  fetchAdherenceByTemplate,
  fetchAdherenceObservations,
  getDateRange,
} from '../lib/adherence'
import type { AdherenceWindow } from '../types'

const VALID_WINDOWS: readonly AdherenceWindow[] = ['today', 'week', 'month']

export function useAdherenceWindow() {
  const [params, setParams] = useSearchParams()
  const raw = params.get('window') ?? 'week'
  const window = (VALID_WINDOWS.includes(raw as AdherenceWindow) ? raw : 'week') as AdherenceWindow
  function setWindow(next: AdherenceWindow) {
    const p = new URLSearchParams(params)
    p.set('window', next)
    setParams(p, { replace: true })
  }
  return [window, setWindow] as const
}

export function useUnitFilter() {
  const [params, setParams] = useSearchParams()
  const unit = params.get('unit') // null = "Todas"
  function setUnit(next: string | null) {
    const p = new URLSearchParams(params)
    if (next === null) p.delete('unit')
    else p.set('unit', next)
    setParams(p, { replace: true })
  }
  return [unit, setUnit] as const
}

export function useAdherenceByCollab(window: AdherenceWindow, unit: string | null) {
  const { collaborator } = useAuth()
  const { start, end } = getDateRange(window)
  const isLeadership =
    collaborator?.role === 'director' ||
    (collaborator?.role === 'manager' && collaborator?.unit !== 'all')
  return useQuery({
    queryKey: ['adherence-by-collab', start, end, unit],
    queryFn: () => fetchAdherenceByCollab(start, end, unit),
    enabled: !!collaborator && isLeadership,
    staleTime: 60_000,
  })
}

export function useAdherenceByTemplate(
  collabId: string | undefined,
  window: AdherenceWindow,
) {
  const { start, end } = getDateRange(window)
  return useQuery({
    queryKey: ['adherence-by-template', collabId, start, end],
    queryFn: () => fetchAdherenceByTemplate(collabId!, start, end),
    enabled: !!collabId,
    staleTime: 60_000,
  })
}

export function useAdherenceObservations(
  collabId: string | undefined,
  window: AdherenceWindow,
) {
  const { start, end } = getDateRange(window)
  return useQuery({
    queryKey: ['adherence-observations', collabId, start, end],
    queryFn: () => fetchAdherenceObservations(collabId!, start, end),
    enabled: !!collabId,
    staleTime: 60_000,
  })
}
