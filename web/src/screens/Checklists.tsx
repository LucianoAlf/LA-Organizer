// web/src/screens/Checklists.tsx
import { useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { ChecklistCard } from '../components/ChecklistCard'
import type { OpChecklistCompletion } from '../types'

export function Checklists() {
  const { collaborator } = useAuth()
  const queryClient = useQueryClient()
  const today = new Date().toISOString().slice(0, 10)

  const { data: completions = [], isLoading } = useQuery<OpChecklistCompletion[]>({
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
    return (
      <div className="p-4 space-y-3">
        {[1, 2].map(i => (
          <div key={i} className="bg-bg-surface rounded-xl h-32 animate-pulse" />
        ))}
      </div>
    )
  }

  if (!completions.length) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh] gap-2 text-fg-muted p-4">
        <span className="text-3xl">✅</span>
        <p className="text-body-md font-medium">Nenhum checklist para hoje</p>
        <p className="text-body-sm text-center">Os checklists do dia aparecerão aqui quando forem enviados.</p>
      </div>
    )
  }

  return (
    <div className="p-4 space-y-4 max-w-content mx-auto pb-24">
      <h1 className="text-section-title">Checklists de Hoje</h1>
      {completions.map(completion => (
        <ChecklistCard key={completion.id} completion={completion} />
      ))}
    </div>
  )
}
