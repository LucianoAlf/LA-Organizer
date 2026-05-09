// web/src/screens/Checklists.tsx
// Sprint 22 Phase A — refactor design system. Checklists aqui são OPERACIONAIS
// (op_checklist_completions enviados pelo TOM), não checkpoints de projeto.
//
// Sprint 22.38 — Tabs Trabalho / Pessoal / Delegadas:
//  - Trabalho: hoje (TOM) + listas de trabalho criadas pelo user.
//  - Pessoal: listas pessoais (mercado/viagem/remédios/geral) com CRUD.
//  - Delegadas: hoje da equipe (op_checklist_completions filtrado por scope).
//
// Sprint 22.38b — Refactor cores: tudo no bg-tom (DS unificado), sem bg-brand
// vermelho-rosado. Buttons via componente Button. Trabalho ganha + Criar.
import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ClipboardCheck, ListChecks, Building2 } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { Button } from '../components/Button'
import { Tabs } from '../components/Tabs'
import { ChecklistCard } from '../components/ChecklistCard'
import { PersonalChecklistCard } from '../components/PersonalChecklistCard'
import { PersonalChecklistSheet } from '../components/PersonalChecklistSheet'
import { TeamChecklistRow, type TeamChecklistRowData } from '../components/TeamChecklistRow'
import { EmptyState } from '../components/EmptyState'
import { ErrorState } from '../components/ErrorState'
import { LoadingState } from '../components/LoadingState'
import { fetchPersonalChecklists } from '../lib/personalChecklists'
import type { OpChecklistCompletion } from '../types'

type Tab = 'trabalho' | 'pessoal' | 'delegadas'

const TABS: { id: Tab; label: string }[] = [
  { id: 'trabalho', label: 'Trabalho' },
  { id: 'pessoal', label: 'Pessoal' },
  { id: 'delegadas', label: 'Delegadas' },
]

export function Checklists() {
  const [searchParams, setSearchParams] = useSearchParams()
  const tab = (searchParams.get('tab') as Tab) || 'trabalho'
  const setTab = (t: Tab) => setSearchParams({ tab: t })

  return (
    <div className="space-y-md">
      <Tabs<Tab>
        tabs={TABS}
        active={tab}
        onChange={setTab}
      />
      {tab === 'trabalho' && <TrabalhoTab />}
      {tab === 'pessoal' && <PessoalTab />}
      {tab === 'delegadas' && <DelegadasTab />}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Tab Trabalho — TOM hoje + minhas listas de trabalho
// ─────────────────────────────────────────────────────────────────────────────

function TrabalhoTab() {
  const { collaborator } = useAuth()
  const queryClient = useQueryClient()
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date())
  const [sheetOpen, setSheetOpen] = useState(false)

  const { data: completions = [], isLoading: loadingTom, error: errorTom, refetch: refetchTom } =
    useQuery<OpChecklistCompletion[]>({
      queryKey: ['checklists', today],
      queryFn: async () => {
        const { data, error } = await supabase
          .from('op_checklist_completions')
          .select(`
            *,
            op_checklists (
              *,
              op_checklist_items ( id, description, sort_order )
            ),
            op_checklist_item_completions (*),
            op_checklist_completion_extra_items (*)
          `)
          .eq('collaborator_id', collaborator!.id)
          .eq('reference_date', today)
          .order('dispatched_at', { ascending: true })
        if (error) throw error
        return (data ?? []) as OpChecklistCompletion[]
      },
      enabled: !!collaborator,
      staleTime: 30_000,
      refetchInterval: 30_000,
    })

  const { data: workLists = [], isLoading: loadingWork, error: errorWork } = useQuery({
    queryKey: ['personal-checklists', collaborator?.id, 'work'],
    queryFn: () => fetchPersonalChecklists(collaborator!.id, 'work'),
    enabled: !!collaborator,
    staleTime: 30_000,
  })

  // Realtime subscription pra TOM completions
  useEffect(() => {
    if (!completions.length || !collaborator) return
    const ids = completions.map(c => c.id)
    const channel = supabase
      .channel('checklist-item-realtime')
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'op_checklist_item_completions',
        filter: `completion_id=in.(${ids.join(',')})`,
      }, () => queryClient.invalidateQueries({ queryKey: ['checklists'] }))
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'op_checklist_completion_extra_items',
        filter: `completion_id=in.(${ids.join(',')})`,
      }, () => queryClient.invalidateQueries({ queryKey: ['checklists'] }))
      .on('postgres_changes', {
        event: 'UPDATE', schema: 'public', table: 'op_checklist_completions',
        filter: `collaborator_id=eq.${collaborator.id}`,
      }, () => queryClient.invalidateQueries({ queryKey: ['checklists'] }))
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [completions.length, collaborator?.id])

  const isLoading = loadingTom || loadingWork
  const error = errorTom || errorWork

  if (isLoading) return <LoadingState rows={2} />

  if (error) {
    return (
      <ErrorState
        title="Não consegui carregar"
        description="Pode ser conexão ou um problema no servidor."
        onRetry={() => refetchTom()}
      />
    )
  }

  const hasContent = completions.length > 0 || workLists.length > 0

  return (
    <div className="space-y-md">
      <div className="flex items-center justify-between">
        <h2 className="text-section-title">Trabalho</h2>
        <Button
          variant="primary"
          size="sm"
          type="button"
          onClick={() => setSheetOpen(true)}
        >
          + Criar checklist
        </Button>
      </div>

      {!hasContent ? (
        <EmptyState
          icon={<ClipboardCheck size={32} />}
          title="Nada de trabalho ainda hoje"
          description="Os checklists do dia (do TOM) e suas listas de trabalho aparecem aqui. Use + Criar checklist pra começar."
        />
      ) : (
        <>
          {completions.length > 0 && (
            <div className="space-y-sm">
              <p className="text-caption text-fg-muted uppercase tracking-wide">Hoje (do TOM)</p>
              {completions.map(c => (
                <ChecklistCard key={c.id} completion={c} />
              ))}
            </div>
          )}
          {workLists.length > 0 && (
            <div className="space-y-sm">
              <p className="text-caption text-fg-muted uppercase tracking-wide">Minhas listas de trabalho</p>
              {workLists.map(l => (
                <PersonalChecklistCard key={l.id} list={l} />
              ))}
            </div>
          )}
        </>
      )}

      <PersonalChecklistSheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        context="work"
      />
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Tab Pessoal — listas pessoais (context='personal')
// ─────────────────────────────────────────────────────────────────────────────

function PessoalTab() {
  const { collaborator } = useAuth()
  const [sheetOpen, setSheetOpen] = useState(false)

  const { data: lists = [], isLoading, error, refetch } = useQuery({
    queryKey: ['personal-checklists', collaborator?.id, 'personal'],
    queryFn: () => fetchPersonalChecklists(collaborator!.id, 'personal'),
    enabled: !!collaborator,
    staleTime: 30_000,
  })

  if (isLoading) return <LoadingState rows={2} />

  if (error) {
    return (
      <ErrorState
        title="Não consegui carregar suas listas"
        description="Pode ser conexão ou um problema no servidor."
        onRetry={() => refetch()}
      />
    )
  }

  return (
    <div className="space-y-md">
      <div className="flex items-center justify-between">
        <h2 className="text-section-title">Listas pessoais</h2>
        <Button
          variant="primary"
          size="sm"
          type="button"
          onClick={() => setSheetOpen(true)}
        >
          + Criar lista
        </Button>
      </div>

      {lists.length === 0 ? (
        <EmptyState
          icon={<ListChecks size={32} />}
          title="Nenhuma lista pessoal ainda"
          description="Crie sua primeira lista — mercado, viagem, remédios… O TOM vai te ajudar a lembrar."
        />
      ) : (
        <div className="space-y-sm">
          {lists.map(l => (
            <PersonalChecklistCard key={l.id} list={l} />
          ))}
        </div>
      )}

      <PersonalChecklistSheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        context="personal"
      />
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Tab Delegadas — hoje operacional do time, filtrado por scope do user
// ─────────────────────────────────────────────────────────────────────────────

function DelegadasTab() {
  const { collaborator } = useAuth()
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date())

  // Scope determina filtro:
  // - director: vê tudo
  // - manager (unit !== 'all'): só sua unidade
  // - coordinator: só pedagogical_assistant function
  // - outros: empty state ("você não delega checklists operacionais")
  const role = collaborator?.role
  const unit = collaborator?.unit
  const canSeeTeam =
    role === 'director' ||
    (role === 'manager' && unit && unit !== 'all') ||
    role === 'coordinator'

  const { data: rows = [], isLoading, error, refetch } = useQuery<TeamChecklistRowData[]>({
    queryKey: ['team-checklists-today', collaborator?.id, today],
    queryFn: async () => {
      const tplFilter = role === 'coordinator' ? 'pedagogical_assistant' : null

      let q = supabase
        .from('op_checklist_completions')
        .select(`
          id, completed_at, dispatched_at, reference_date,
          collaborator:collaborators!op_checklist_completions_collaborator_id_fkey(full_name, unit),
          op_checklists!inner(id, name, function_role, unit, dispatch_time, completion_threshold),
          op_checklist_item_completions(is_checked),
          op_checklist_completion_extra_items(is_checked)
        `)
        .eq('reference_date', today)
        .order('dispatched_at', { ascending: true })

      if (role === 'manager' && unit && unit !== 'all') {
        // Filtro por unit: tanto template unit='all' quanto unit=user.unit
        q = q.in('op_checklists.unit', ['all', unit])
      }
      if (tplFilter) {
        q = q.eq('op_checklists.function_role', tplFilter)
      }

      const { data, error } = await q
      if (error) throw error
      // Supabase retorna join 1:1 como array. Normalizo pra single object.
      const rows = (data ?? []).map((r: any) => ({
        ...r,
        collaborator: Array.isArray(r.collaborator) ? r.collaborator[0] ?? null : r.collaborator ?? null,
        op_checklists: Array.isArray(r.op_checklists) ? r.op_checklists[0] ?? null : r.op_checklists ?? null,
      }))
      return rows.filter((r: any) => r.op_checklists) as unknown as TeamChecklistRowData[]
    },
    enabled: !!collaborator && canSeeTeam,
    staleTime: 60_000,
    refetchInterval: 60_000,
  })

  if (!canSeeTeam) {
    return (
      <EmptyState
        icon={<Building2 size={32} />}
        title="Você não delega checklists operacionais"
        description="Esta tab mostra abertura/fechamento e outras rotinas que a equipe executa diariamente. Disponível para director, manager (por unidade) e coordinator (pedagógico)."
      />
    )
  }

  if (isLoading) return <LoadingState rows={3} />

  if (error) {
    return (
      <ErrorState
        title="Não consegui carregar os checklists do time"
        description="Pode ser conexão ou um problema no servidor."
        onRetry={() => refetch()}
      />
    )
  }

  // Sort: pendentes/atrasados primeiro, depois por unit + dispatch_time
  const enriched = rows.map(r => {
    const items = [...(r.op_checklist_item_completions ?? []), ...(r.op_checklist_completion_extra_items ?? [])]
    const total = items.length
    const done = items.filter(i => i.is_checked).length
    const pct = total > 0 ? Math.round((done / total) * 100) : 0
    const isClosed = !!r.completed_at
    return { row: r, total, done, pct, isClosed }
  })

  enriched.sort((a, b) => {
    if (a.isClosed !== b.isClosed) return a.isClosed ? 1 : -1
    const aUnit = a.row.op_checklists?.unit ?? ''
    const bUnit = b.row.op_checklists?.unit ?? ''
    if (aUnit !== bUnit) return aUnit.localeCompare(bUnit)
    const aTime = a.row.op_checklists?.dispatch_time ?? ''
    const bTime = b.row.op_checklists?.dispatch_time ?? ''
    return aTime.localeCompare(bTime)
  })

  return (
    <div className="space-y-md">
      <h2 className="text-section-title">Operacional hoje</h2>

      {enriched.length === 0 ? (
        <EmptyState
          icon={<Building2 size={32} />}
          title="Nenhum checklist operacional hoje"
          description="Quando o TOM despachar checklists pra equipe, eles aparecem aqui."
        />
      ) : (
        <div className="space-y-sm">
          {enriched.map(({ row, done, total, pct, isClosed }) => (
            <TeamChecklistRow
              key={row.id}
              data={row}
              done={done}
              total={total}
              pct={pct}
              isClosed={isClosed}
            />
          ))}
        </div>
      )}
    </div>
  )
}
