# Anotações do Grupo — Fatia C: Tipos de ficha customizados por grupo

**Data:** 2026-06-13
**Módulo:** Base de conhecimento do grupo (`group_notes` / fichas tipadas)
**Pré-requisitos:** Fatia A (reorder + cor/ícone) e Fatia B (editor rico + IA) entregues.

## Goal

Permitir que **qualquer membro do grupo crie tipos de ficha próprios** (além dos 5 base), com **modelo de campos** definido na criação, **cor/ícone**, persistidos por grupo, e com o **TOM escolhendo o tipo certo entre os existentes** ao criar/anotar pelo chat.

## Decisões aprovadas (brainstorming)

| Tema | Decisão |
|---|---|
| Escopo | **Por grupo**. Os 5 base (acesso/cnpj/conta/reuniao/livre) seguem **globais** (todo grupo tem). Cada grupo cria os seus extras. |
| Quem cria | **Qualquer membro** do grupo (RLS = membro). |
| Campos | O **criador define o modelo de campos** do tipo (vira template reutilizável). |
| TOM | **Escolhe entre os tipos existentes** do grupo (base + custom). NÃO inventa tipo novo. |
| Sementes | Semear o **Financeiro** (único grupo hoje) com casos reais: **Fornecedor, Cartão, Conta a pagar**. |

## Arquitetura

```
group_note_types (nova tabela, por grupo)         lib/groupNotes.ts
   key/label/color/icon/fields  ───────────────►  buildTypeIndex(base + custom) → TypeIndex
          ▲                                          │ resolveColor/resolveIcon/typeLabel/templateForType(key, idx)
          │ useGroupNoteTypes(groupId)               ▼
   NoteTypeForm (criar tipo)  ◄── footerAction ── CustomSelect "Tipo" (NoteEditor)
                                                      │
group_notes.type = key (texto livre, já sem CHECK) ◄─┘
          ▲
   TOM: groupNotesContext lista os tipos → escolhe key; createGroupNote valida key ∈ (base ∪ custom do grupo)
```

Sem mudança no marker `<<GROUP_NOTE>>` nem no trilho OAuth. `group_notes.type` já é texto livre (confirmado: sem CHECK constraint).

---

## Banco — `group_note_types` (migration via apply_migration MCP)

```sql
create table if not exists public.group_note_types (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.work_groups(id) on delete cascade,
  key text not null,
  label text not null,
  color text,
  icon text,
  fields jsonb not null default '[]'::jsonb,
  created_by uuid,
  created_at timestamptz not null default now(),
  unique (group_id, key)
);
create index if not exists group_note_types_group_idx on public.group_note_types(group_id);

alter table public.group_note_types enable row level security;

-- Membro do grupo: CRUD completo (qualquer membro cria).
create policy group_note_types_member_all on public.group_note_types
  for all using (
    group_id in (select group_id from public.work_group_members where collaborator_id = public.current_collab_id())
  ) with check (
    group_id in (select group_id from public.work_group_members where collaborator_id = public.current_collab_id())
  );

-- TOM (service_role) — caminho server-side.
create policy group_note_types_service_all on public.group_note_types
  for all to service_role using (true) with check (true);
```
> Mesmo padrão de RLS do `group_notes` (membership via `current_collab_id()` + policy service_role). Confirmar o nome exato da função/coluna de membership reproduzindo a policy existente de `group_notes` na hora de aplicar.

### Seed — Financeiro (`group_id = d95f63af-5032-4120-89f2-ca4c49684cbc`)
Inserir 3 tipos (idempotente via `on conflict (group_id,key) do nothing`):

| key | label | color | icon | fields (label·kind) |
|---|---|---|---|---|
| `fornecedor` | Fornecedor | `#1D9E75` | `BuildingStore` | Razão social·text · CNPJ·text · Contato·text · Chave PIX·text · Obs·text |
| `cartao` | Cartão | `#534AB7` | `CreditCard` | Bandeira·text · Final·text · Vencimento da fatura·text · Limite·text · Responsável·text |
| `conta_pagar` | Conta a pagar | `#BA7517` | `Receipt` | Descrição·text · Vencimento·text · Valor·text · Código de barras·text · Status·text |

`fields` jsonb = `[{ "label": "...", "kind": "text", "secret": false }, ...]`.

---

## PWA — `lib/groupNotes.ts`

- `GroupNote.type` muda de `NoteType` para **`string`** (passa a aceitar key custom). `NoteType` segue como união das 5 base (usada nos defaults).
- Nova interface:
  ```ts
  export interface GroupNoteType { id: string; group_id: string; key: string; label: string; color: string | null; icon: string | null; fields: NoteField[]; }
  export type TypeMeta = { label: string; color: string; icon: string; fields: NoteField[] };
  export type TypeIndex = Record<string, TypeMeta>;
  ```
- `buildTypeIndex(custom: GroupNoteType[]): TypeIndex` — semeia as 5 base (de `NOTE_TYPE_META`/`TYPE_DEFAULTS`/`TEMPLATES`) e sobrepõe/acrescenta as custom (cor/ícone com fallback cinza/`FileText`).
- Resolvers passam a aceitar o índice (opcional, retrocompatível):
  ```ts
  resolveColor(n: Pick<GroupNote,'type'|'color'>, idx?: TypeIndex): string  // override da ficha → idx[type].color → TYPE_DEFAULTS → '#5F5E5A'
  resolveIcon(n: Pick<GroupNote,'type'|'icon'>, idx?: TypeIndex): string     // idem → 'FileText'
  typeLabel(type: string, idx?: TypeIndex): string                          // idx[type].label → NOTE_TYPE_META → type
  templateForType(type: string, idx?: TypeIndex): NoteField[]               // idx[type].fields (clonado) → []
  ```
- `typesWithCount`/`NotesTypeFilter` passam a derivar a lista de tipos presentes nas notas + custom do grupo (usar `typeLabel`/índice no chip).
- `loadGroupNoteTypes(groupId)` / `upsertGroupNoteType(...)` / `deleteGroupNoteType(id)` (I/O Supabase).

## PWA — hook `useGroupNoteTypes(groupId)`
React Query: `types` (lista), `saveType` (mutation upsert), `removeType`. A página monta `typeIndex = useMemo(() => buildTypeIndex(types), [types])` e passa o índice pros componentes que renderizam nota.

## PWA — componentes
- **`NoteTypeForm.tsx` (novo)** — mini-form (modal `BottomSheet` no mobile / painel no desktop, seguindo DS): **Nome** (input) · **Cor** (swatches `NOTE_COLORS`) · **Ícone** (grade `NOTE_ICONS` + `NoteGlyph`) · **Campos do modelo** (lista add/remove: rótulo + seletor de tipo texto·senha·url). Salva via `saveType` (gera `key` = slug do nome) e retorna a key criada.
- **`NoteEditor.tsx`** — `CustomSelect` de Tipo: `options` = base + custom (`typeLabel`); `footerAction={{ label: '➕ Novo tipo…', onClick: () => setShowTypeForm(true) }}`. Ao criar, seleciona a nova key. `changeType(key)` usa `templateForType(key, idx)` pra pré-semear campos. Recebe `typeIndex` via prop.
- **`NoteCard.tsx` / `NoteDetail.tsx`** — `resolveColor/resolveIcon` passam a receber `typeIndex`; `NoteDetail` mostra `typeLabel(note.type, idx)` no chip de tipo.
- **`GrupoAnotacoes.tsx`** — usa `useGroupNoteTypes`, monta `typeIndex`, passa pros filhos; controla `showTypeForm`.

## Backend (TOM) — `src/services/group-notes.js`
- `groupNotesContext({supabase, groupId})`: carregar `group_note_types` do grupo e **listar os tipos disponíveis** (base + custom, `key — label`) num bloco do prompt, com a diretiva "use o tipo existente mais adequado; não invente tipo novo".
- `createGroupNote`: aceitar `note.type` quando for **base** OU existir em `group_note_types(group_id)`; senão `'livre'` (hoje coage qualquer coisa fora das 5 base). Carrega as keys válidas do grupo pra validar.
- `<<GROUP_NOTE>>` e engine **inalterados**.

## Segurança / dados
- RLS membro cobre o CRUD de tipos; service_role pro TOM. Sem dado sensível novo (tipos são metadados).
- `key` derivada do nome (slug `a-z0-9_`), única por grupo (`unique(group_id,key)`); colisão → sufixo numérico.

## Testes
- **vitest (`groupNotes.test.ts`):** `buildTypeIndex` (5 base + custom; custom sobrepõe; fallback cor/ícone); `resolveColor/resolveIcon` com índice (tipo custom → cor do tipo; override da ficha vence); `typeLabel`/`templateForType` (custom e base); slug de `key`.
- **node --test (`group-notes.test.js`):** `createGroupNote` aceita key custom presente no grupo, coage key inexistente → 'livre'; `groupNotesContext` inclui a lista de tipos.
- **e2e preview:** "➕ Novo tipo…" → cria "Fornecedor" com 4 campos → seleciona → cria ficha desse tipo (cor/ícone certos no card e detalhe) → reload persiste. Conferir as 3 sementes do Financeiro aparecendo no select. (Usar ficha **descartável** — preview mexe em dado real, ver [[feedback_preview_autosave_mutates_real_data]].)
- Dry-run TOM: com tipos listados no prompt, classificar uma anotação no tipo custom certo (ex.: "guarda o fornecedor X" → tipo `fornecedor`).

## Fora de escopo
- Editar/excluir tipo já em uso com migração de fichas (v1: pode editar label/cor/ícone; excluir só se sem uso, senão bloquear). 
- Tipos por departamento/global geridos por tela de admin (fica como evolução).
- Reordenar tipos no select.

## Arquivos
**Novos:** migration `group_note_types` + seed; `web/src/hooks/useGroupNoteTypes.ts`; `web/src/screens/grupos/notes/NoteTypeForm.tsx`.
**Modificados:** `web/src/lib/groupNotes.ts` (+tipos/index/resolvers I/O) e `groupNotes.test.ts`; `NoteEditor.tsx` (select + footerAction + form); `NoteCard.tsx`/`NoteDetail.tsx`/`NotesTypeFilter.tsx`/`GrupoAnotacoes.tsx` (índice); `src/services/group-notes.js` (prompt + validação) e `group-notes.test.js`.
