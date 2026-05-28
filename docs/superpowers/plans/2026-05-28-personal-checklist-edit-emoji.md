# Personal Checklist — Edit + Emoji Picker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Substituir window.prompt/confirm por componentes React, adicionar emoji picker e modo edição no PersonalChecklistSheet.

**Architecture:** Migration adiciona `icon_emoji TEXT` (nullable). Dois novos componentes (`EmojiPicker`, `ConfirmDialog`). `PersonalChecklistSheet` ganha prop `editList?` para modo edição. `PersonalChecklistCard` usa os novos componentes — sem nenhum `window.prompt/confirm`.

**Tech Stack:** React 18, TypeScript, Tailwind CSS, TanStack Query, Supabase (MCP), design system local (BottomSheet, Button, Field).

---

## Task 1: Migration — adicionar icon_emoji

**Files:**
- Create: `supabase/migrations/20260528_add_icon_emoji_personal_checklists.sql`

- [ ] **Criar o arquivo de migration**

Conteúdo exato:
```sql
-- Sprint 29.x — campo de emoji customizável para personal_checklists.
-- Nullable: se null, UI usa PERSONAL_LIST_TYPE_ICON[list_type] (retrocompatível).
ALTER TABLE personal_checklists ADD COLUMN IF NOT EXISTS icon_emoji TEXT;
```

- [ ] **Aplicar a migration no Supabase via MCP**

Usar `mcp__4c04bb52__execute_sql` com project_id `cesnbnrynvxvgdhfmaua` e o SQL acima.

- [ ] **Verificar que a coluna existe**

Executar via MCP:
```sql
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'personal_checklists' AND column_name = 'icon_emoji';
```
Resultado esperado: 1 linha, `data_type = text`, `is_nullable = YES`.

---

## Task 2: Atualizar tipos TypeScript

**Files:**
- Modify: `web/src/types.ts`

- [ ] **Adicionar `icon_emoji` à interface `PersonalChecklist`**

Localizar a interface (linha ~415) e adicionar o campo após `is_active`:
```ts
// Antes:
export interface PersonalChecklist {
  id: string
  owner_collab_id: string
  name: string
  list_type: PersonalListType
  context: PersonalListContext
  is_active: boolean
  created_at: string
  updated_at: string
  personal_checklist_items?: PersonalChecklistItem[]
}

// Depois:
export interface PersonalChecklist {
  id: string
  owner_collab_id: string
  name: string
  list_type: PersonalListType
  context: PersonalListContext
  is_active: boolean
  icon_emoji: string | null   // ← novo
  created_at: string
  updated_at: string
  personal_checklist_items?: PersonalChecklistItem[]
}
```

---

## Task 3: Atualizar lib — updateList + icon_emoji no create

**Files:**
- Modify: `web/src/lib/personalChecklists.ts`

- [ ] **Adicionar `icon_emoji?` ao input de `createPersonalChecklist`**

```ts
// Assinatura atualizada — adicionar icon_emoji ao input object:
export async function createPersonalChecklist(input: {
  ownerId: string
  name: string
  listType: PersonalListType
  context: PersonalListContext
  initialItems: string[]
  icon_emoji?: string | null      // ← novo
  recurrence_type?: 'once' | 'daily' | 'weekly' | 'monthly'
  days_of_week?: number[] | null
  day_of_month?: number | null
}): Promise<PersonalChecklist> {
  const { data: list, error: e1 } = await supabase
    .from('personal_checklists')
    .insert({
      owner_collab_id: input.ownerId,
      name: input.name,
      list_type: input.listType,
      context: input.context,
      icon_emoji: input.icon_emoji ?? null,   // ← novo
      recurrence_type: input.recurrence_type ?? 'once',
      days_of_week: input.days_of_week ?? null,
      day_of_month: input.day_of_month ?? null,
    })
    .select('*')
    .single()
  if (e1) throw e1
  // ... resto permanece igual
```

- [ ] **Adicionar função `updateList` ao final do arquivo (antes do último export)**

```ts
/**
 * Atualiza campos de uma lista pessoal. Aceita patch parcial.
 * Usa-se no EditSheet (substitui renameList + changeListType para o novo fluxo de UI).
 */
export async function updateList(
  listId: string,
  patch: { name?: string; list_type?: PersonalListType; icon_emoji?: string | null },
): Promise<void> {
  const { error } = await supabase
    .from('personal_checklists')
    .update(patch)
    .eq('id', listId)
  if (error) throw error
}
```

---

## Task 4: Criar componente EmojiPicker

**Files:**
- Create: `web/src/components/EmojiPicker.tsx`

- [ ] **Criar o arquivo completo**

```tsx
// web/src/components/EmojiPicker.tsx
// Grid curado de ~40 emojis para personal checklists.
// Sem dependências externas — funciona em Simple Browser, PWA e desktop.

interface EmojiPickerProps {
  value: string | null
  onChange: (emoji: string | null) => void
}

const EMOJI_GROUPS: { label: string; emojis: string[] }[] = [
  { label: 'Listas & tarefas', emojis: ['📝', '📋', '✅', '☑️', '🗒️', '🗂️'] },
  { label: 'Mercado & casa',   emojis: ['🛒', '🧺', '🍕', '🥦', '🥛', '🧹'] },
  { label: 'Saúde',            emojis: ['💊', '🏃', '🧘', '💪', '🩺', '🩹'] },
  { label: 'Viagem',           emojis: ['✈️', '🧳', '🗺️', '🏖️', '🏔️', '🚂'] },
  { label: 'Trabalho',         emojis: ['💼', '💻', '📊', '🎯', '📈', '🗓️'] },
  { label: 'Finanças',         emojis: ['💰', '💳', '📦', '🧾', '💵'] },
  { label: 'Geral',            emojis: ['⭐', '❤️', '🔥', '🌟', '🎉', '🎵'] },
]

export function EmojiPicker({ value, onChange }: EmojiPickerProps) {
  return (
    <div>
      <label className="text-caption text-fg-muted block mb-2">Ícone</label>
      <div className="space-y-2">
        {EMOJI_GROUPS.map(group => (
          <div key={group.label}>
            <p className="text-caption text-fg-muted mb-1">{group.label}</p>
            <div className="flex flex-wrap gap-1">
              {group.emojis.map(emoji => {
                const active = value === emoji
                return (
                  <button
                    key={emoji}
                    type="button"
                    onClick={() => onChange(active ? null : emoji)}
                    aria-pressed={active}
                    className={[
                      'w-9 h-9 rounded-md text-xl flex items-center justify-center transition-colors focus-ring',
                      active
                        ? 'bg-bg-surface border-2 border-tom'
                        : 'bg-bg-app border border-border hover:border-tom',
                    ].join(' ')}
                  >
                    {emoji}
                  </button>
                )
              })}
            </div>
          </div>
        ))}
      </div>
      {value && (
        <button
          type="button"
          onClick={() => onChange(null)}
          className="mt-2 text-caption text-fg-muted hover:text-fg transition-colors focus-ring rounded-sm"
        >
          ✕ Nenhum ícone
        </button>
      )}
    </div>
  )
}
```

---

## Task 5: Criar componente ConfirmDialog

**Files:**
- Create: `web/src/components/ConfirmDialog.tsx`

- [ ] **Criar o arquivo completo**

```tsx
// web/src/components/ConfirmDialog.tsx
// Substitui window.confirm() em toda a app. Zero dialogs nativos.
import { BottomSheet } from './BottomSheet'
import { Button } from './Button'

interface ConfirmDialogProps {
  open: boolean
  onClose: () => void
  title: string
  description?: string
  confirmLabel?: string
  confirmVariant?: 'danger' | 'primary'
  onConfirm: () => void
  isPending?: boolean
}

export function ConfirmDialog({
  open,
  onClose,
  title,
  description,
  confirmLabel = 'Confirmar',
  confirmVariant = 'danger',
  onConfirm,
  isPending = false,
}: ConfirmDialogProps) {
  return (
    <BottomSheet open={open} onClose={onClose} title={title}>
      <div className="space-y-4 pb-2">
        {description && (
          <p className="text-body-md text-fg-muted">{description}</p>
        )}
        <div className="flex gap-3">
          <div className="flex-1">
            <Button
              variant="secondary"
              size="md"
              fullWidth
              type="button"
              onClick={onClose}
              disabled={isPending}
            >
              Cancelar
            </Button>
          </div>
          <div className="flex-1">
            <Button
              variant={confirmVariant}
              size="md"
              fullWidth
              type="button"
              onClick={onConfirm}
              loading={isPending}
            >
              {confirmLabel}
            </Button>
          </div>
        </div>
      </div>
    </BottomSheet>
  )
}
```

---

## Task 6: Atualizar PersonalChecklistSheet (modo criar + editar + emoji)

**Files:**
- Modify: `web/src/components/PersonalChecklistSheet.tsx`

- [ ] **Reescrever o arquivo completo com suporte a editList + EmojiPicker**

```tsx
// web/src/components/PersonalChecklistSheet.tsx
// Sprint 22.38 — BottomSheet para criar uma lista pessoal/trabalho nova.
// Sprint 22.38b — Refactor pra design system.
// Sprint 29.x — Modo edição (prop editList) + EmojiPicker.
import { useState, useEffect } from 'react'
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

const TYPES: PersonalListType[] = ['shopping', 'travel', 'meds', 'general']

export function PersonalChecklistSheet({ open, onClose, context = 'personal', editList }: Props) {
  const { collaborator } = useAuth()
  const queryClient = useQueryClient()
  const isEditing = Boolean(editList)

  const [name, setName]           = useState('')
  const [listType, setListType]   = useState<PersonalListType>('shopping')
  const [emoji, setEmoji]         = useState<string | null>(null)
  const [items, setItems]         = useState<string[]>([])
  const [newItemText, setNewItemText] = useState('')
  const [recurrence, setRecurrence]  = useState<RecurrenceValue>({ recurrence_type: 'once' })

  // Inicializa form sempre que o sheet abre ou a lista de edição muda
  useEffect(() => {
    if (!open) return
    if (editList) {
      setName(editList.name)
      setListType(editList.list_type)
      setEmoji(editList.icon_emoji ?? null)
      setRecurrence({ recurrence_type: 'once' })
    } else {
      setName('')
      setListType(context === 'work' ? 'general' : 'shopping')
      setEmoji(null)
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

        {/* Emoji picker */}
        <EmojiPicker value={emoji} onChange={setEmoji} />

        {/* Recorrência */}
        <div>
          <label className="text-caption text-fg-muted block mb-2">Recorrência</label>
          <RecurrenceField value={recurrence} onChange={setRecurrence} />
        </div>

        {/* Tipo (pessoal ou edição de lista pessoal) */}
        {effectiveContext === 'personal' && (
          <div>
            <label className="text-caption text-fg-muted block mb-2">Tipo *</label>
            <div className="grid grid-cols-2 gap-2">
              {TYPES.map(t => {
                const isSel = listType === t
                return (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setListType(t)}
                    className={[
                      'h-9 px-3 rounded-md text-body-sm font-semibold transition-colors flex items-center gap-2 focus-ring',
                      isSel
                        ? 'bg-tom text-black shadow-card dark:shadow-none'
                        : 'bg-bg-subtle text-fg-muted border border-border hover:text-fg',
                    ].join(' ')}
                  >
                    <span aria-hidden>{PERSONAL_LIST_TYPE_ICON[t]}</span>
                    {PERSONAL_LIST_TYPE_LABEL[t]}
                  </button>
                )
              })}
            </div>
          </div>
        )}

        {/* Itens iniciais — só no modo criação */}
        {!isEditing && (
          <div>
            <label className="text-caption text-fg-muted block mb-2">
              Itens iniciais ({items.length})
            </label>
            {items.length > 0 && (
              <ul className="space-y-1 mb-2">
                {items.map((it, idx) => (
                  <li key={idx} className="flex items-center gap-2 bg-bg-app rounded-md px-2 py-1.5">
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
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addInitial() } }}
                placeholder="Adicionar item..."
                className="flex-1 bg-bg-surface border border-border rounded-md px-3 py-2
                           text-body-sm text-fg focus:outline-none focus:border-tom focus-ring"
              />
              <Button variant="secondary" size="sm" type="button" onClick={addInitial} disabled={!newItemText.trim()}>
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
          {isEditing ? 'Salvar alterações' : effectiveContext === 'work' ? 'Salvar checklist' : 'Salvar lista'}
        </Button>
      </div>
    </BottomSheet>
  )
}
```

---

## Task 7: Refatorar PersonalChecklistCard — remover window.prompt/confirm

**Files:**
- Modify: `web/src/components/PersonalChecklistCard.tsx`

- [ ] **Adicionar imports dos novos componentes e da função updateList**

No topo do arquivo, substituir o bloco de imports existente:
```tsx
// Remover renameList e changeListType do import de personalChecklists:
import {
  toggleItem, addItem, deleteItem, reorderItems,
  archiveList, deleteList, saveItemNote,      // ← renameList e changeListType removidos
} from '../lib/personalChecklists'

// Adicionar imports dos novos componentes:
import { PersonalChecklistSheet } from './PersonalChecklistSheet'
import { ConfirmDialog } from './ConfirmDialog'
```

- [ ] **Adicionar estados locais para editSheet e confirmAction**

Logo após `const sensors = useSortableSensors()`:
```tsx
const [editSheetOpen, setEditSheetOpen]       = useState(false)
const [confirmAction, setConfirmAction]       = useState<'archive' | 'delete' | null>(null)
```

- [ ] **Remover mutations renameMutation e typeMutation**

Apagar completamente os dois blocos (linhas 99–106 do arquivo original):
```tsx
// REMOVER:
const renameMutation = useMutation({
  mutationFn: (name: string) => renameList(list.id, name),
  onSuccess: invalidate,
})
const typeMutation = useMutation({
  mutationFn: (t: PersonalListType) => changeListType(list.id, t),
  onSuccess: invalidate,
})
```

- [ ] **Atualizar o menu cardMenu — remover Renomear/Mudar tipo, adicionar Editar**

Substituir o bloco `const cardMenu`:
```tsx
const cardMenu: MenuItem[] = [
  {
    label: 'Editar',
    onClick: () => setEditSheetOpen(true),
  },
  {
    label: 'Arquivar',
    onClick: () => setConfirmAction('archive'),
  },
  {
    label: 'Apagar lista',
    danger: true,
    onClick: () => setConfirmAction('delete'),
  },
]
```

- [ ] **Atualizar o ícone no header do card para usar icon_emoji quando presente**

Linha 180, substituir:
```tsx
// Antes:
{PERSONAL_LIST_TYPE_ICON[list.list_type]}

// Depois:
{list.icon_emoji ?? PERSONAL_LIST_TYPE_ICON[list.list_type]}
```

- [ ] **Adicionar PersonalChecklistSheet (edit) e os dois ConfirmDialogs ao JSX**

No final do `return`, logo antes do `</div>` que fecha o card, adicionar:
```tsx
      {/* Edit sheet */}
      <PersonalChecklistSheet
        open={editSheetOpen}
        onClose={() => setEditSheetOpen(false)}
        context={list.context}
        editList={list}
      />

      {/* Confirm: arquivar */}
      <ConfirmDialog
        open={confirmAction === 'archive'}
        onClose={() => setConfirmAction(null)}
        title={`Arquivar "${list.name}"?`}
        description="A lista some da visualização mas pode ser recuperada depois."
        confirmLabel="Arquivar"
        confirmVariant="primary"
        onConfirm={() => { archiveMutation.mutate(); setConfirmAction(null) }}
        isPending={archiveMutation.isPending}
      />

      {/* Confirm: apagar */}
      <ConfirmDialog
        open={confirmAction === 'delete'}
        onClose={() => setConfirmAction(null)}
        title={`Apagar "${list.name}"?`}
        description="Essa ação não pode ser desfeita. Todos os itens serão removidos."
        confirmLabel="Apagar lista"
        confirmVariant="danger"
        onConfirm={() => { deleteListMutation.mutate(); setConfirmAction(null) }}
        isPending={deleteListMutation.isPending}
      />
```

- [ ] **Remover import não-usado `PersonalListType` (se não sobrar uso)**

Verificar se `PersonalListType` ainda é referenciado em algum lugar do arquivo após remover `typeMutation`. Se não, remover do import de `'../types'`.

---

## Task 8: Verificar TypeScript + Build + Validar no Simple Browser

- [ ] **Rodar TypeScript check**

```bash
cd D:/la-organizer/_remote/web && npx tsc --noEmit
```
Esperado: zero erros.

- [ ] **Fazer build**

```bash
cd D:/la-organizer/_remote/web && npx vite build
```
Esperado: `✓ built in X.XXs`.

- [ ] **Limpar SW cache e recarregar /checklists no Simple Browser**

No Simple Browser (localhost:4173), executar via preview_eval:
```js
(async () => {
  const regs = await navigator.serviceWorker.getRegistrations()
  for (const r of regs) await r.unregister()
  const keys = await caches.keys()
  for (const k of keys) await caches.delete(k)
  window.location.href = '/checklists?tab=pessoal'
})()
```

- [ ] **Tomar screenshot e validar:**
  - Aba Pessoal mostra listas
  - Menu ⋮ exibe: Editar / Arquivar / Apagar lista (sem Renomear / Mudar tipo)
  - Clicar "Editar" → abre sheet pré-preenchido com EmojiPicker visível
  - Clicar "Arquivar" → abre ConfirmDialog React (não window.confirm)
  - Clicar "+ Criar lista" → abre sheet de criação com EmojiPicker
