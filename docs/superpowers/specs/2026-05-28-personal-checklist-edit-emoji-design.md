# Personal Checklist — Edit + Emoji Picker

**Data:** 2026-05-28  
**Contexto:** `web/src/components/PersonalChecklistCard.tsx`, `PersonalChecklistSheet.tsx`, `lib/personalChecklists.ts`

## Problema

Os menus "Renomear", "Mudar tipo" e "Arquivar"/"Apagar" no `PersonalChecklistCard` usam `window.prompt()` / `window.confirm()`. Esses dialogs nativos do browser:
- Não funcionam no Simple Browser (embedded browser do VS Code)
- São visualmente inconsistentes com o design system
- Não há opção de editar o emoji/ícone da lista

## Objetivo

1. Substituir todos os `window.prompt()` / `window.confirm()` por componentes React do DS
2. Adicionar emoji picker (criar + editar) com campo `icon_emoji` no banco
3. Adicionar opção "Editar" no menu do card

---

## Seção 1 — Dados

### Migration

```sql
ALTER TABLE personal_checklists ADD COLUMN icon_emoji TEXT;
```

- Nullable — retrocompatível. Se `null`, usa o ícone derivado de `list_type` (comportamento atual)
- Sem DEFAULT para não sobrescrever registros existentes

### Tipo `PersonalChecklist` (atualizar em `types.ts`)

```ts
icon_emoji: string | null   // novo campo
```

### Lib `personalChecklists.ts`

Adicionar função:

```ts
updateList(listId: string, patch: { name?: string; list_type?: PersonalListType; icon_emoji?: string | null }): Promise<void>
```

Chama `supabase.from('personal_checklists').update(patch).eq('id', listId)`.  
As funções `renameList` e `changeListType` existentes **ficam** (não quebrar callers externos), mas o EditSheet usa `updateList`.

---

## Seção 2 — Componente `EmojiPicker`

**Arquivo:** `web/src/components/EmojiPicker.tsx`

Grid ~40 emojis curados, zero dependências externas, grupos:

| Grupo | Emojis |
|---|---|
| Listas & tarefas | 📝 📋 ✅ ☑️ 🗒️ 🗂️ |
| Mercado & casa | 🛒 🧺 🍕 🥦 🥛 🧹 |
| Saúde | 💊 🏃 🧘 💪 🩺 🩹 |
| Viagem | ✈️ 🧳 🗺️ 🏖️ 🏔️ 🚂 |
| Trabalho | 💼 💻 📊 🎯 📈 🗓️ |
| Finanças | 💰 💳 📦 🧾 💵 |
| Geral | ⭐ ❤️ 🔥 🌟 🎉 🎵 |

**Props:**
```ts
interface EmojiPickerProps {
  value: string | null
  onChange: (emoji: string | null) => void
}
```

**Comportamento:**
- Emoji selecionado: borda `border-tom` + fundo `bg-bg-surface`
- Botão "✕ Nenhum" (estilo ghost) para limpar → value = null
- Layout: grid 8 colunas, botões `w-9 h-9 rounded-md text-xl`
- Envolvido em `<Field label="Ícone">` do DS

**Exibição no card:** quando `icon_emoji !== null`, substitui o ícone do `list_type` no header do card.

---

## Seção 3 — `PersonalChecklistSheet` (modo criar + editar)

**Arquivo existente:** `web/src/components/PersonalChecklistSheet.tsx`

### Nova prop

```ts
editList?: PersonalChecklist   // se presente → modo edição
```

### Lógica de modo

| | Criar | Editar |
|---|---|---|
| Título | "Nova lista pessoal" / "Nova lista de trabalho" | "Editar lista" |
| Botão submit | "Salvar lista" | "Salvar alterações" |
| Campos | Nome, Emoji, Tipo, Recorrência, Itens iniciais | Nome, Emoji, Tipo, Recorrência (sem Itens iniciais) |
| Ação submit | `createPersonalChecklist()` | `updateList()` |
| State inicial | vazio | pré-preenchido com `editList` |

### Campo Emoji

Inserido logo abaixo do campo Nome, usando o componente `EmojiPicker`.  
No modo edição, inicializado com `editList.icon_emoji`.

---

## Seção 4 — `ConfirmDialog`

**Arquivo:** `web/src/components/ConfirmDialog.tsx`

Componente React puro. Usa `BottomSheet` (já existe no DS) internamente.

**Props:**
```ts
interface ConfirmDialogProps {
  open: boolean
  title: string
  description?: string
  confirmLabel?: string       // default "Confirmar"
  confirmVariant?: 'danger' | 'primary'  // default 'danger'
  onConfirm: () => void
  onClose: () => void
}
```

Layout:
```
┌──────────────────────────────┐
│  {title}                     │
│  {description}               │
│                              │
│  [Cancelar]  [confirmLabel]  │
└──────────────────────────────┘
```

---

## Seção 5 — Menu do `PersonalChecklistCard`

**Arquivo:** `web/src/components/PersonalChecklistCard.tsx`

### Novos estados locais

```ts
const [editSheetOpen, setEditSheetOpen] = useState(false)
const [confirmAction, setConfirmAction] = useState<'archive' | 'delete' | null>(null)
```

### Menu atualizado

| Item | Ação atual | Nova ação |
|---|---|---|
| **Editar** | _(não existia)_ | Abre `PersonalChecklistSheet` com `editList=list` |
| Renomear | `window.prompt()` | **Removido** — coberto por "Editar" |
| Mudar tipo | `window.prompt()` | **Removido** — coberto por "Editar" |
| Arquivar | `window.confirm()` | `setConfirmAction('archive')` → `ConfirmDialog` |
| Apagar lista | `window.confirm()` | `setConfirmAction('delete')` → `ConfirmDialog` |

### ConfirmDialog instances no card

```tsx
<ConfirmDialog
  open={confirmAction === 'archive'}
  title={`Arquivar "${list.name}"?`}
  description="A lista some da view mas pode ser recuperada depois."
  confirmLabel="Arquivar"
  confirmVariant="primary"
  onConfirm={() => { archiveMutation.mutate(); setConfirmAction(null) }}
  onClose={() => setConfirmAction(null)}
/>
<ConfirmDialog
  open={confirmAction === 'delete'}
  title={`Apagar "${list.name}"?`}
  description="Esta ação não pode ser desfeita. Todos os itens serão removidos."
  confirmLabel="Apagar lista"
  confirmVariant="danger"
  onConfirm={() => { deleteListMutation.mutate(); setConfirmAction(null) }}
  onClose={() => setConfirmAction(null)}
/>
```

---

## Arquivos afetados

| Arquivo | Mudança |
|---|---|
| `supabase/migrations/20260528_add_icon_emoji.sql` | Novo — migration |
| `web/src/types.ts` | Adicionar `icon_emoji` ao tipo `PersonalChecklist` |
| `web/src/lib/personalChecklists.ts` | Adicionar `updateList()` |
| `web/src/components/EmojiPicker.tsx` | Novo componente |
| `web/src/components/ConfirmDialog.tsx` | Novo componente |
| `web/src/components/PersonalChecklistSheet.tsx` | Adicionar prop `editList` + campo Emoji |
| `web/src/components/PersonalChecklistCard.tsx` | Menu refatorado, sem window.prompt/confirm |

---

## Out of scope

- Emoji picker no TOM (WhatsApp) — futuro
- Upload de ícone customizado — futuro
- Busca/filtro de emojis — desnecessário dado o grid curado
