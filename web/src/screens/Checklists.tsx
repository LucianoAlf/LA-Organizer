// web/src/screens/Checklists.tsx
// Sprint 22 Phase A — refactor design system. Checklists aqui são OPERACIONAIS
// (op_checklist_completions enviados pelo TOM), não checkpoints de projeto. Por isso
// rationale (do Sprint 22.3) NÃO entra aqui — vive em ProjetoDetalhe.
import { useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ClipboardCheck } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { ChecklistCard } from '../components/ChecklistCard'
import { EmptyState } from '../components/EmptyState'
import { ErrorState } from '../components/ErrorState'
import { LoadingState } from '../components/LoadingState'
import type { OpChecklistCompletion } from '../types'

export function Checklists() {
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
          op_checklist_item_completions (*)
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

  if (isLoading) {
    return <LoadingState rows={2} />
  }

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
    <div className="space-y-md">
      <h2 className="text-section-title">Checklists de hoje</h2>
      <div className="space-y-sm">
        {completions.map(completion => (
          <ChecklistCard key={completion.id} completion={completion} />
        ))}
      </div>
    </div>
  )
}
