// web/src/screens/Checklists.tsx
// Sprint 22 Phase A — refactor design system. Checklists aqui são OPERACIONAIS
// (op_checklist_completions enviados pelo TOM), não checkpoints de projeto. Por isso
// rationale (do Sprint 22.3) NÃO entra aqui — vive em ProjetoDetalhe.
//
// Sprint 22.38 — Tabs Trabalho / Pessoal / Delegadas:
//  - Trabalho: lista de hoje (op_checklist_completions) — comportamento original.
//  - Pessoal: listas criadas pelo user (personal_checklists) com CRUD.
//  - Delegadas: leitura de tasks onde created_by = self != assigned_to.
import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ClipboardCheck, Plus, ListChecks, UserPlus } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { ChecklistCard } from '../components/ChecklistCard'
import { PersonalChecklistCard } from '../components/PersonalChecklistCard'
import { PersonalChecklistSheet } from '../components/PersonalChecklistSheet'
import { DelegatedTaskRow, type DelegatedTaskRowData } from '../components/DelegatedTaskRow'
import { EmptyState } from '../components/EmptyState'
import { ErrorState } from '../components/ErrorState'
import { LoadingState } from '../components/LoadingState'
import { Tabs } from '../components/Tabs'
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
// Tab Trabalho — comportamento original (op_checklist_completions de hoje)
// ─────────────────────────────────────────────────────────────────────────────

function TrabalhoTab() {
  const { collaborator } = useAuth()
  const queryClient = useQueryClient()
  const today = new Date().toISOString().slice(0, 10)

  const { data: completions = [], isLoading, error, refetch } = useQuery<OpChecklistCompletion[]>({
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

  // Realtime subscription
  useEffect(() => {
    if (!completions.length || !collaborator) return
    const ids = completions.map(c => c.id)

    const channel = supabase
      .channel('checklist-item-realtime')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'op_checklist_item_completions',
          filter: `completion_id=in.(${ids.join(',')})`,
        },
        () => queryClient.invalidateQueries({ queryKey: ['checklists'] })
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'op_checklist_completion_extra_items',
          filter: `completion_id=in.(${ids.join(',')})`,
        },
        () => queryClient.invalidateQueries({ queryKey: ['checklists'] })
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'op_checklist_completions',
          filter: `collaborator_id=eq.${collaborator.id}`,
        },
        () => queryClient.invalidateQueries({ queryKey: ['checklists'] })
      )
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [completions.length, collaborator?.id])

  if (isLoading) return <LoadingState rows={2} />

  if (error) {
    return (
      <ErrorState
        title="Não consegui carregar os checklists"
        description="Pode ser conexão ou um problema no servidor. Tenta de novo."
        onRetry={() => refetch()}
      />
    )
  }

  if (!completions.length) {
    return (
      <EmptyState
        icon={<ClipboardCheck size={32} />}
        title="Nenhum checklist para hoje"
        description="Os checklists do dia aparecerão aqui quando o TOM enviar."
      />
    )
  }

  return (
    <div className="space-y-sm">
      <h2 className="text-section-title">Checklists de hoje</h2>
      {completions.map(c => (
        <ChecklistCard key={c.id} completion={c} />
      ))}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Tab Pessoal — listas criadas pelo user (personal_checklists)
// ─────────────────────────────────────────────────────────────────────────────

function PessoalTab() {
  const { collaborator } = useAuth()
  const [sheetOpen, setSheetOpen] = useState(false)

  const { data: lists = [], isLoading, error, refetch } = useQuery({
    queryKey: ['personal-checklists', collaborator?.id],
    queryFn: () => fetchPersonalChecklists(collaborator!.id),
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
    <div className="space-y-sm">
      <div className="flex items-center justify-between">
        <h2 className="text-section-title">Listas pessoais</h2>
        <button
          type="button"
          onClick={() => setSheetOpen(true)}
          className="h-9 px-3 rounded-md bg-brand text-white text-body-sm font-medium
                     inline-flex items-center gap-1 focus-ring"
        >
          <Plus size={14} /> Criar lista
        </button>
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

      <PersonalChecklistSheet open={sheetOpen} onClose={() => setSheetOpen(false)} />
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Tab Delegadas — tasks que ESTE user atribuiu a outros (leitura)
// ─────────────────────────────────────────────────────────────────────────────

function DelegadasTab() {
  const { collaborator } = useAuth()
  const [view, setView] = useState<'ativas' | 'concluidas'>('ativas')

  const { data: tasks = [], isLoading, error, refetch } = useQuery<DelegatedTaskRowData[]>({
    queryKey: ['delegated-tasks', collaborator?.id, view],
    queryFn: async () => {
      let q = supabase
        .from('tasks')
        .select(`
          id, title, status, due_date, project_id, assigned_to,
          projects ( name ),
          collaborators!tasks_assigned_to_fkey ( full_name )
        `)
        .eq('created_by', collaborator!.id)
        .neq('assigned_to', collaborator!.id)

      if (view === 'ativas') {
        q = q.not('status', 'in', '(done,cancelled)')
      } else {
        const since = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString()
        q = q.in('status', ['done', 'cancelled']).gte('completed_at', since)
      }

      const { data, error } = await q.order('due_date', { ascending: true, nullsFirst: false })
      if (error) throw error
      return (data ?? []) as unknown as DelegatedTaskRowData[]
    },
    enabled: !!collaborator,
    staleTime: 60_000,
  })

  if (isLoading) return <LoadingState rows={2} />

  if (error) {
    return (
      <ErrorState
        title="Não consegui carregar as delegadas"
        description="Pode ser conexão ou um problema no servidor."
        onRetry={() => refetch()}
      />
    )
  }

  // Sort: atrasadas primeiro
  const today = new Date().toISOString().slice(0, 10)
  const sorted = [...tasks].sort((a, b) => {
    const aLate = a.due_date && a.due_date < today && a.status !== 'done' ? 0 : 1
    const bLate = b.due_date && b.due_date < today && b.status !== 'done' ? 0 : 1
    if (aLate !== bLate) return aLate - bLate
    if (!a.due_date && !b.due_date) return 0
    if (!a.due_date) return 1
    if (!b.due_date) return -1
    return a.due_date.localeCompare(b.due_date)
  })

  return (
    <div className="space-y-sm">
      <div className="flex items-center justify-between">
        <h2 className="text-section-title">Delegadas</h2>
        <div className="flex gap-1.5">
          <button
            type="button"
            onClick={() => setView('ativas')}
            className={[
              'h-8 px-3 rounded-md text-body-sm font-medium focus-ring',
              view === 'ativas'
                ? 'bg-tom text-white'
                : 'bg-bg-subtle text-fg-muted border border-border',
            ].join(' ')}
          >
            Ativas
          </button>
          <button
            type="button"
            onClick={() => setView('concluidas')}
            className={[
              'h-8 px-3 rounded-md text-body-sm font-medium focus-ring',
              view === 'concluidas'
                ? 'bg-tom text-white'
                : 'bg-bg-subtle text-fg-muted border border-border',
            ].join(' ')}
          >
            Concluídas
          </button>
        </div>
      </div>

      {sorted.length === 0 ? (
        <EmptyState
          icon={<UserPlus size={32} />}
          title={view === 'ativas' ? 'Nada delegado por você' : 'Nenhuma delegada concluída nos últimos 30 dias'}
          description={view === 'ativas'
            ? 'Quando você atribuir uma tarefa pra outra pessoa, ela aparece aqui.'
            : 'Tarefas que você delegou e foram concluídas vão aparecer aqui.'}
        />
      ) : (
        <div className="space-y-sm">
          {sorted.map(t => <DelegatedTaskRow key={t.id} task={t} />)}
        </div>
      )}
    </div>
  )
}
