// web/src/components/TemplateCard.tsx
// Sprint 22.39 — Card de template operacional pra /checklists?tab=trabalho.
// Substitui o card inline de /mais/checklists-templates trazendo pro DS unificado.
// ⋮ menu: Editar / Arquivar (ou Reativar quando is_active=false).
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { RowMenu, type MenuItem } from './RowMenu'
import type { OpChecklistTemplate, OpChecklistItem, OpChecklistAudit } from '../types'

const FUNCTION_LABEL: Record<string, string> = {
  secretary_morning: 'Secretária (manhã)',
  secretary_evening: 'Secretária (noite)',
  pedagogical_assistant: 'Assistente pedagógica',
  cleaning: 'Limpeza',
}

const UNIT_LABEL: Record<string, string> = {
  all: 'todas',
  barra: 'Barra',
  recreio: 'Recreio',
  campo_grande: 'Campo Grande',
}

const SHIFT_LABEL: Record<string, string> = {
  morning: 'manhã',
  afternoon: 'tarde',
  evening: 'noite',
  full: 'integral',
}

export type TemplateCardData = OpChecklistTemplate & {
  op_checklist_items?: OpChecklistItem[]
  last_audit?: (Pick<OpChecklistAudit, 'changed_at'> & {
    collaborator?: { full_name: string } | null
  }) | null
}

interface Props {
  template: TemplateCardData
  onEdit: () => void
}

export function TemplateCard({ template, onEdit }: Props) {
  const { collaborator } = useAuth()
  const queryClient = useQueryClient()

  const activeItems = (template.op_checklist_items ?? []).filter(i => i.is_active !== false)
  const lastAudit = template.last_audit
  const editorName = lastAudit?.collaborator?.full_name
  const editedAt = lastAudit?.changed_at
    ? new Date(lastAudit.changed_at).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })
    : null

  const archiveMutation = useMutation({
    mutationFn: async ({ activate }: { activate: boolean }) => {
      const { error } = await supabase
        .from('op_checklists')
        .update({ is_active: activate, updated_by: collaborator!.id })
        .eq('id', template.id)
      if (error) throw error
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['checklists-templates'] }),
  })

  const menu: MenuItem[] = [
    { label: 'Editar', onClick: onEdit },
    template.is_active
      ? {
          label: 'Arquivar',
          onClick: () => archiveMutation.mutate({ activate: false }),
          danger: true,
          confirm: 'Arquivar este template? Some da lista de ativos.',
        }
      : {
          label: 'Reativar',
          onClick: () => archiveMutation.mutate({ activate: true }),
        },
  ]

  return (
    <div className={[
      'bg-bg-surface rounded-xl border border-border p-4',
      !template.is_active ? 'opacity-60' : '',
    ].join(' ')}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <p className="text-body-md font-semibold text-fg truncate">{template.name}</p>
          <p className="text-body-sm text-fg-muted mt-0.5">
            {FUNCTION_LABEL[template.function_role] ?? template.function_role}
            {' · '}
            {UNIT_LABEL[template.unit] ?? template.unit}
            {' · '}
            {SHIFT_LABEL[template.shift] ?? template.shift}
            {' · '}
            {template.dispatch_time?.slice(0, 5)}
          </p>
          <p className="text-body-sm text-fg-muted">
            {activeItems.length} itens · threshold {template.completion_threshold}%
          </p>
          {editedAt && (
            <p className="text-body-sm text-fg-muted mt-0.5">
              Editado por {editorName ?? '—'} em {editedAt}
            </p>
          )}
        </div>
        <div className="flex-shrink-0">
          <RowMenu items={menu} />
        </div>
      </div>
    </div>
  )
}
