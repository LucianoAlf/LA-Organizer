// web/src/components/PersonalChecklistSheet.tsx
// Sprint 22.38 — BottomSheet para criar uma lista pessoal nova.
// Edição inline já é coberta pelo card (renomear/mudar tipo via ⋮).
import { useState, useEffect } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { X } from 'lucide-react'
import { BottomSheet } from './BottomSheet'
import { useAuth } from '../contexts/AuthContext'
import { createPersonalChecklist } from '../lib/personalChecklists'
import {
  PERSONAL_LIST_TYPE_ICON,
  PERSONAL_LIST_TYPE_LABEL,
  type PersonalListType,
} from '../types'

interface Props {
  open: boolean
  onClose: () => void
}

const TYPES: PersonalListType[] = ['shopping', 'travel', 'meds', 'general']

export function PersonalChecklistSheet({ open, onClose }: Props) {
  const { collaborator } = useAuth()
  const queryClient = useQueryClient()

  const [name, setName] = useState('')
  const [listType, setListType] = useState<PersonalListType>('shopping')
  const [items, setItems] = useState<string[]>([])
  const [newItemText, setNewItemText] = useState('')

  useEffect(() => {
    if (!open) return
    setName('')
    setListType('shopping')
    setItems([])
    setNewItemText('')
  }, [open])

  const createMutation = useMutation({
    mutationFn: () => createPersonalChecklist({
      ownerId: collaborator!.id,
      name: name.trim(),
      listType,
      initialItems: items,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['personal-checklists'] })
      onClose()
    },
  })

  const isValid = name.trim().length > 0 && !!collaborator

  function addInitial() {
    const t = newItemText.trim()
    if (!t) return
    setItems(prev => [...prev, t])
    setNewItemText('')
  }

  function removeInitial(i: number) {
    setItems(prev => prev.filter((_, idx) => idx !== i))
  }

  return (
    <BottomSheet open={open} onClose={onClose} title="Nova lista pessoal">
      <div className="space-y-4 pb-4">
        <div>
          <label className="text-caption text-fg-muted block mb-1">Nome *</label>
          <input
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            maxLength={80}
            placeholder="ex: Mercado da semana"
            className="w-full bg-bg-surface border border-border rounded-lg px-3 py-2
                       text-body text-fg focus:outline-none focus:border-brand"
          />
        </div>

        <div>
          <label className="text-caption text-fg-muted block mb-2">Tipo *</label>
          <div className="grid grid-cols-2 gap-2">
            {TYPES.map(t => (
              <button
                key={t}
                type="button"
                onClick={() => setListType(t)}
                className={[
                  'px-3 py-2 rounded-lg text-body-sm font-medium transition-colors flex items-center gap-2',
                  listType === t
                    ? 'bg-brand text-white'
                    : 'bg-bg-surface border border-border text-fg-muted',
                ].join(' ')}
              >
                <span aria-hidden>{PERSONAL_LIST_TYPE_ICON[t]}</span>
                {PERSONAL_LIST_TYPE_LABEL[t]}
              </button>
            ))}
          </div>
        </div>

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
                    className="text-fg-muted hover:text-danger p-1"
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
              className="flex-1 bg-bg-surface border border-border rounded-lg px-3 py-1.5
                         text-body-sm text-fg focus:outline-none focus:border-brand"
            />
            <button
              type="button"
              onClick={addInitial}
              className="px-3 py-1.5 bg-brand text-white rounded-lg text-body-sm font-medium"
            >
              +
            </button>
          </div>
        </div>

        {createMutation.isError && (
          <p className="text-danger text-caption">
            Erro ao salvar. Verifique sua conexão e tente novamente.
          </p>
        )}

        <button
          type="button"
          onClick={() => createMutation.mutate()}
          disabled={!isValid || createMutation.isPending}
          className="w-full py-3 bg-brand text-white rounded-xl font-semibold
                     disabled:opacity-40 disabled:cursor-not-allowed transition-opacity"
        >
          {createMutation.isPending ? 'Salvando...' : 'Salvar lista'}
        </button>
      </div>
    </BottomSheet>
  )
}
