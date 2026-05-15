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
  responsible?: { id: string; full_name: string } | null
  leader?: { id: string; full_name: string } | null
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
        {/* Área clicável — abre edição direto */}
        <button
          type="button"
          onClick={onEdit}
          className="flex-1 min-w-0 text-left focus-ring rounded-lg"
        >
          <p className="text-body-md font-semibold text-fg truncate">{template.name}</p>
          <p className="text-body-sm text-fg-muted mt-0.5">
            {template.responsible?.full_name
              ? template.responsible.full_name
              : FUNCTION_LABEL[template.function_role] ?? template.function_role}
            {' · '}
            {template.dispatch_time?.slice(0, 5)}
          </p>
          {template.leader?.full_name && (
            <p className="text-body-sm text-fg-muted">
              Líder: {template.leader.full_name}
            </p>
          )}
          <p className="text-body-sm text-fg-muted">
            {activeItems.length} {activeItems.length === 1 ? 'item' : 'itens'}
            {' · '}threshold {template.completion_threshold}%
          </p>
          {editedAt && (
            <p className="text-body-sm text-fg-muted mt-0.5">
              Editado por {editorName ?? '—'} em {editedAt}
            </p>
          )}
        </button>
        <div className="flex-shrink-0 flex items-center gap-2">
          <button
            type="button"
            role="switch"
            aria-checked={template.is_active}
            onClick={() => archiveMutation.mutate({ activate: !template.is_active })}
            disabled={archiveMutation.isPending}
            className={[
              'relative h-6 w-11 rounded-full transition-colors focus-ring disabled:opacity-50',
              template.is_active ? 'bg-tom' : 'bg-fg-muted/30',
            ].join(' ')}
            title={template.is_active ? 'Pausar template' : 'Ativar template'}
          >
            <span className={[
              'absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform',
              template.is_active ? 'translate-x-5' : '',
            ].join(' ')} />
          </button>
          <RowMenu items={menu} />
        </div>
      </div>
    </div>
  )
}
