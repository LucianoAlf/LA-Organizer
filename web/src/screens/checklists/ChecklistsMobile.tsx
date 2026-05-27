// web/src/screens/Checklists.tsx
// Sprint 22 Phase A — refactor design system. Checklists aqui são OPERACIONAIS
// (op_checklist_completions enviados pelo TOM), não checkpoints de projeto.
//
// Sprint 22.38 — Tabs Trabalho / Pessoal:
//  - Trabalho: hoje (TOM) + listas de trabalho criadas pelo user.
//  - Pessoal: listas pessoais (mercado/viagem/remédios/geral) com CRUD.
//
// Sprint 22.38c — Removida tab "Delegadas". Pra executor já aparece em Trabalho;
// pra liderança ver o time tem /mais/aderencia-checklists (semana toda + drilldown).
//
// Sprint 22.38b — Refactor cores: tudo no bg-tom (DS unificado), sem bg-brand
// vermelho-rosado. Buttons via componente Button. Trabalho ganha + Criar.
import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ClipboardCheck, ListChecks, Settings } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import { Button } from '../../components/Button'
import { Tabs } from '../../components/Tabs'
import { ChecklistCard } from '../../components/ChecklistCard'
import { PersonalChecklistCard } from '../../components/PersonalChecklistCard'
import { PersonalChecklistSheet } from '../../components/PersonalChecklistSheet'
// Sprint 23 — TemplateCard e ChecklistTemplateSheet movidos pra rota /checklists/templates
import { EmptyState } from '../../components/EmptyState'
import { ErrorState } from '../../components/ErrorState'
import { LoadingState } from '../../components/LoadingState'
import { fetchPersonalChecklists } from '../../lib/personalChecklists'
import type { OpChecklistCompletion, OpChecklistAudit } from '../../types'

type Tab = 'trabalho' | 'pessoal'

const TABS: { id: Tab; label: string }[] = [
  { id: 'trabalho', label: 'Trabalho' },
  { id: 'pessoal', label: 'Pessoal' },
]

export function ChecklistsMobile() {
  const [searchParams, setSearchParams] = useSearchParams()
  const tab = (searchParams.get('tab') as Tab) || 'trabalho'
  const setTab = (t: Tab) => setSearchParams({ tab: t })

  return (
    <div className="space-y-md">
      <div className="flex items-center gap-2">
        <div className="flex-1 min-w-0">
          <Tabs<Tab>
            tabs={TABS}
            active={tab}
            onChange={setTab}
          />
        </div>
        <a
          href="/checklists/templates"
          aria-label="Gerenciar templates"
          title="Gerenciar templates"
          className="p-2 rounded-md text-fg-muted hover:text-tom hover:bg-bg-surface transition-colors flex-shrink-0"
        >
          <Settings size={20} />
        </a>
      </div>
      {tab === 'trabalho' && <TrabalhoTab />}
      {tab === 'pessoal' && <PessoalTab />}
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
  // Sprint 23 — gestão de templates movida pra /checklists/templates (acesso via engrenagem no header)

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

  // Sprint 23 — query de templates removida (movida pra TemplatesPage em /checklists/templates)

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
        <h2 className="text-card-title">Trabalho</h2>
        <Button
          variant="primary"
          size="sm"
          type="button"
          onClick={() => setSheetOpen(true)}
        >
          + Criar lista
        </Button>
      </div>

      {!hasContent ? (
        <EmptyState
          icon={<ClipboardCheck size={32} />}
          title="Nada de trabalho ainda hoje"
          description="Os checklists do dia (do TOM) e suas listas de trabalho aparecem aqui. Use + Criar lista pra começar."
        />
      ) : (
        <>
          {completions.length > 0 && (
            <div className="space-y-sm">
              {completions.map(c => (
                <ChecklistCard key={c.id} completion={c} />
              ))}
            </div>
          )}
          {workLists.length > 0 && (
            <div className="space-y-sm">
              {completions.length > 0 && (
                <p className="text-body-sm text-fg-muted pt-sm">Minhas listas</p>
              )}
              {workLists.map(l => (
                <PersonalChecklistCard key={l.id} list={l} />
              ))}
            </div>
          )}
        </>
      )}

      {/* Sprint 23 — templates agora vivem em rota separada /checklists/templates
          (acessível pela engrenagem no header). Mantemos a tela aqui só com execução. */}

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
        <h2 className="text-card-title">Listas pessoais</h2>
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
