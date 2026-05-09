// web/src/screens/ChecklistsTemplates.tsx
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Archive, ArchiveRestore, Pencil } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { ChecklistTemplateSheet } from '../components/ChecklistTemplateSheet'
import { PageHeader } from '../components/PageHeader'
import type { OpChecklistTemplate, OpChecklistAudit, OpChecklistItem } from '../types'

type TemplateRow = OpChecklistTemplate & {
  op_checklist_items: OpChecklistItem[]
  last_audit?: Pick<OpChecklistAudit, 'changed_at'> & {
    collaborator?: { full_name: string }
  }
}

export function ChecklistsTemplates() {
  const { collaborator } = useAuth()
  const queryClient = useQueryClient()
  const [showArchived, setShowArchived] = useState(false)
  // undefined=sheet closed, null=create mode, TemplateRow=edit mode
  const [sheetTemplate, setSheetTemplate] = useState<TemplateRow | null | undefined>(undefined)

  const { data: templates, isLoading } = useQuery<TemplateRow[]>({
    queryKey: ['checklists-templates', showArchived],
    queryFn: async () => {
      // Step 1: fetch templates + items
      const tQuery = supabase
        .from('op_checklists')
        .select('*, op_checklist_items ( id, checklist_id, description, sort_order, is_active, updated_by )')
        .order('name')
      if (!showArchived) tQuery.eq('is_active', true)
      const { data: tData, error: tErr } = await tQuery
      if (tErr) throw tErr
      const rows = (tData ?? []) as TemplateRow[]

      // Step 2: fetch latest audit per template (Supabase doesn't support limit on nested relations)
      const ids = rows.map(r => r.id)
      if (ids.length === 0) return rows
      const { data: audits } = await supabase
        .from('op_checklists_audit')
        .select('template_id, changed_at, collaborator:collaborators(full_name)')
        .in('template_id', ids)
        .order('changed_at', { ascending: false })

      type AuditEntry = { template_id: string; changed_at: string; collaborator: { full_name: string } | null }
      const latestAudit = new Map<string, AuditEntry>()
      for (const a of (audits ?? [])) {
        if (!a.template_id || latestAudit.has(a.template_id)) continue
        const collab = Array.isArray(a.collaborator) ? a.collaborator[0] ?? null : a.collaborator as { full_name: string } | null
        latestAudit.set(a.template_id, {
          template_id: a.template_id,
          changed_at: a.changed_at as string,
          collaborator: collab,
        })
      }
      return rows.map(r => ({ ...r, last_audit: latestAudit.get(r.id) })) as TemplateRow[]
    },
  })

  const archiveMutation = useMutation({
    mutationFn: async ({ id, activate }: { id: string; activate: boolean }) => {
      const { error } = await supabase
        .from('op_checklists')
        .update({ is_active: activate, updated_by: collaborator!.id })
        .eq('id', id)
      if (error) throw error
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['checklists-templates'] }),
  })

  const templateList: TemplateRow[] = templates ?? []

  if (isLoading) {
    return (
      <div className="p-4 space-y-3">
        {[1,2,3].map(i => (
          <div key={i} className="bg-bg-surface rounded-xl h-20 animate-pulse" />
        ))}
      </div>
    )
  }

  return (
    <div className="p-4 space-y-4 max-w-content mx-auto pb-28">
      <PageHeader
        title="Templates de Checklist"
        backTo="/mais"
        right={
          <button type="button" onClick={() => setShowArchived(v => !v)}
            className="text-caption text-fg-muted underline">
            {showArchived ? 'Ocultar arquivados' : 'Mostrar arquivados'}
          </button>
        }
      />

      {templateList.length === 0 && (
        <div className="text-center text-fg-muted py-12">
          <p className="text-body">Nenhum template{showArchived ? '' : ' ativo'}.</p>
          <p className="text-body-sm mt-1">Use o + para criar o primeiro.</p>
        </div>
      )}

      {templateList.map(t => {
        const activeItems = (t.op_checklist_items ?? []).filter(i => i.is_active !== false)
        const lastAudit = Array.isArray(t.last_audit) ? (t.last_audit as unknown[])[0] as typeof t.last_audit : t.last_audit
        const editorName = lastAudit?.collaborator?.full_name
        const editedAt = lastAudit?.changed_at
          ? new Date(lastAudit.changed_at).toLocaleDateString('pt-BR', { day:'2-digit', month:'short' })
          : null

        return (
          <div key={t.id}
            className={['bg-bg-surface rounded-xl border border-border p-4',
              !t.is_active ? 'opacity-60' : ''].join(' ')}>
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1 min-w-0">
                <p className="text-body font-semibold text-fg truncate">{t.name}</p>
                <p className="text-caption text-fg-muted">
                  {t.function_role} · {t.unit} · {t.shift} · {t.dispatch_time?.slice(0,5)}
                </p>
                <p className="text-caption text-fg-muted">
                  {activeItems.length} itens · threshold {t.completion_threshold}%
                </p>
                {editedAt && (
                  <p className="text-caption text-fg-muted mt-0.5">
                    Editado por {editorName ?? '—'} em {editedAt}
                  </p>
                )}
              </div>

              <div className="flex gap-1 flex-shrink-0">
                {t.is_active && (
                  <button type="button" onClick={() => setSheetTemplate(t)}
                    className="p-2 rounded-lg text-fg-muted hover:text-brand transition-colors"
                    aria-label="Editar template">
                    <Pencil size={16} />
                  </button>
                )}
                <button type="button"
                  onClick={() => archiveMutation.mutate({ id: t.id, activate: !t.is_active })}
                  className="p-2 rounded-lg text-fg-muted hover:text-fg transition-colors"
                  aria-label={t.is_active ? 'Arquivar' : 'Reativar'}>
                  {t.is_active ? <Archive size={16} /> : <ArchiveRestore size={16} />}
                </button>
              </div>
            </div>
          </div>
        )
      })}

      {/* FAB */}
      <button type="button" onClick={() => setSheetTemplate(null)}
        className="fixed bottom-24 right-4 w-14 h-14 bg-brand rounded-full
                   flex items-center justify-center shadow-lg text-white
                   hover:opacity-90 transition-opacity z-20"
        aria-label="Criar template">
        <Plus size={24} />
      </button>

      {/* Sheet */}
      <ChecklistTemplateSheet
        open={sheetTemplate !== undefined}
        template={sheetTemplate ?? null}
        onClose={() => setSheetTemplate(undefined)}
      />
    </div>
  )
}
