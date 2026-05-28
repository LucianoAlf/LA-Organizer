// web/src/components/PersonalChecklistSheet.tsx
// Sprint 22.38 — BottomSheet para criar uma lista pessoal/trabalho nova.
// Sprint 22.38b — Refactor pra design system: usa <Button variant="primary"> (bg-tom).
// Sprint 29.x — Modo edição (prop editList) + EmojiPicker. Zero window.prompt.
// Sprint 29.x+1 — Unificar Tipo e Ícone: 7 chips de tipo + picker colapsável.
import { useState, useEffect } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { X } from 'lucide-react'
import { BottomSheet } from './BottomSheet'
import { Button } from './Button'
import { EmojiPicker } from './EmojiPicker'
import { useAuth } from '../contexts/AuthContext'
import { createPersonalChecklist, updateList } from '../lib/personalChecklists'
import { RecurrenceField, type RecurrenceValue } from '../screens/checklists/RecurrenceField'
import {
  PERSONAL_LIST_TYPE_ICON,
  PERSONAL_LIST_TYPE_LABEL,
  type PersonalChecklist,
  type PersonalListContext,
  type PersonalListType,
} from '../types'

interface Props {
  open: boolean
  onClose: () => void
  /** 'personal' (default) → tipos shopping/travel/meds/general. 'work' → tipo fixo general. */
  context?: PersonalListContext
  /** Se passado, abre em modo edição pré-preenchido. */
  editList?: PersonalChecklist | null
}

const TYPES: PersonalListType[] = ['shopping', 'home', 'meds', 'travel', 'work', 'finance', 'general']

export function PersonalChecklistSheet({ open, onClose, context = 'personal', editList }: Props) {
  const { collaborator } = useAuth()
  const queryClient = useQueryClient()
  const isEditing = Boolean(editList)

  const [name, setName]             = useState('')
  const [listType, setListType]     = useState<PersonalListType>('shopping')
  const [emoji, setEmoji]           = useState<string | null>(null)
  const [emojiOpen, setEmojiOpen]   = useState(false)
  const [items, setItems]           = useState<string[]>([])
  const [newItemText, setNewItemText] = useState('')
  const [recurrence, setRecurrence]   = useState<RecurrenceValue>({ recurrence_type: 'once' })

  // Inicializa form sempre que o sheet abre ou a lista de edição muda
  useEffect(() => {
    if (!open) return
    if (editList) {
      setName(editList.name)
      setListType(editList.list_type)
      setEmoji(editList.icon_emoji ?? null)
      setEmojiOpen(Boolean(editList.icon_emoji))
      setRecurrence({ recurrence_type: 'once' })
    } else {
      setName('')
      setListType(context === 'work' ? 'general' : 'shopping')
      setEmoji(null)
      setEmojiOpen(false)
      setItems([])
      setNewItemText('')
      setRecurrence({ recurrence_type: 'once' })
    }
  }, [open, editList, context])

  const createMutation = useMutation({
    mutationFn: () => createPersonalChecklist({
      ownerId: collaborator!.id,
      name: name.trim(),
      listType,
      context,
      icon_emoji: emoji,
      initialItems: items,
      recurrence_type: recurrence.recurrence_type,
      days_of_week: recurrence.days_of_week ?? null,
      day_of_month: recurrence.day_of_month ?? null,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['personal-checklists'] })
      onClose()
    },
  })

  const editMutation = useMutation({
    mutationFn: () => updateList(editList!.id, {
      name: name.trim(),
      list_type: listType,
      icon_emoji: emoji,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['personal-checklists'] })
      onClose()
    },
  })

  const mutation = isEditing ? editMutation : createMutation
  const isValid  = name.trim().length > 0 && !!collaborator

  // Contexto efetivo: ao editar usa o contexto da lista, ao criar usa a prop
  const effectiveContext = editList?.context ?? context

  function addInitial() {
    const t = newItemText.trim()
    if (!t) return
    setItems(prev => [...prev, t])
    setNewItemText('')
  }

  function removeInitial(i: number) {
    setItems(prev => prev.filter((_, idx) => idx !== i))
  }

  const title = isEditing
    ? 'Editar lista'
    : context === 'work' ? 'Nova checklist de trabalho' : 'Nova lista pessoal'

  return (
    <BottomSheet open={open} onClose={onClose} title={title}>
      <div className="space-y-4 pb-4">

        {/* Nome */}
        <div>
          <label className="text-caption text-fg-muted block mb-1">Nome *</label>
          <input
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            maxLength={80}
            placeholder={effectiveContext === 'work' ? 'ex: Rotina de fechamento' : 'ex: Mercado da semana'}
            className="w-full bg-bg-surface border border-border rounded-md px-3 py-2
                       text-body text-fg focus:outline-none focus:border-tom focus-ring"
          />
        </div>

        {/* Tipo — pessoal (criação ou edição de lista pessoal) */}
        {effectiveContext === 'personal' && (
          <div>
            <label className="text-caption text-fg-muted block mb-2">Tipo *</label>
            <div className="grid grid-cols-3 gap-2">
              {TYPES.map(t => {
                const isSel = listType === t
                return (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setListType(t)}
                    className={[
                      'h-10 px-2 rounded-md text-body-sm font-semibold transition-colors flex items-center gap-1.5 focus-ring',
                      isSel
                        ? 'bg-tom text-black shadow-card dark:shadow-none'
                        : 'bg-bg-subtle text-fg-muted border border-border hover:text-fg',
                    ].join(' ')}
                  >
                    <span aria-hidden className="text-base">{PERSONAL_LIST_TYPE_ICON[t]}</span>
                    <span className="truncate">{PERSONAL_LIST_TYPE_LABEL[t]}</span>
                  </button>
                )
              })}
            </div>
          </div>
        )}

        {/* Personalizar ícone — colapsável */}
        <div>
          <button
            type="button"
            onClick={() => setEmojiOpen(v => !v)}
            className="flex items-center gap-2 text-caption text-fg-muted hover:text-fg transition-colors focus-ring rounded-sm w-full text-left"
          >
            <span>
              {emoji
                ? <>{emoji} Personalizar ícone</>
                : 'Personalizar ícone'
              }
            </span>
            {emojiOpen ? <ChevronUp size={14} className="ml-auto" /> : <ChevronDown size={14} className="ml-auto" />}
          </button>

          {emojiOpen && (
            <div className="mt-2">
              <EmojiPicker value={emoji} onChange={setEmoji} />
            </div>
          )}
        </div>

        {/* Recorrência */}
        <div>
          <label className="text-caption text-fg-muted block mb-2">Recorrência</label>
          <RecurrenceField value={recurrence} onChange={setRecurrence} />
        </div>

        {/* Itens iniciais — só no modo criação */}
        {!isEditing && (
          <div>
            <label className="text-caption text-fg-muted block mb-2">
              Itens iniciais ({items.length})
            </label>
            {items.length > 0 && (
              <ul className="space-y-1 mb-2">
                {items.map((it, idx) => (
                  <li
                    key={idx}
                    className="flex items-center gap-2 bg-bg-app rounded-md px-2 py-1.5"
                  >
                    <span className="flex-1 text-body-sm text-fg truncate">{it}</span>
                    <button
                      type="button"
                      onClick={() => removeInitial(idx)}
                      className="text-fg-muted hover:text-danger p-1 focus-ring rounded-sm"
                      aria-label={`Remover ${it}`}
                    >
                      <X size={14} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <div className="flex gap-2">
              <input
                type="text"
                value={newItemText}
                onChange={e => setNewItemText(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    addInitial()
                  }
                }}
                placeholder="Adicionar item..."
                className="flex-1 bg-bg-surface border border-border rounded-md px-3 py-2
                           text-body-sm text-fg focus:outline-none focus:border-tom focus-ring"
              />
              <Button
                variant="secondary"
                size="sm"
                type="button"
                onClick={addInitial}
                disabled={!newItemText.trim()}
              >
                Adicionar
              </Button>
            </div>
          </div>
        )}

        {mutation.isError && (
          <p className="text-danger text-caption">
            Erro ao salvar. Verifique sua conexão e tente novamente.
          </p>
        )}

        <Button
          variant="primary"
          size="md"
          fullWidth
          type="button"
          loading={mutation.isPending}
          disabled={!isValid}
          onClick={() => mutation.mutate()}
        >
          {isEditing
            ? 'Salvar alterações'
            : effectiveContext === 'work' ? 'Salvar checklist' : 'Salvar lista'}
        </Button>
      </div>
    </BottomSheet>
  )
}
