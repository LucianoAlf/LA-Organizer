# Anotações do Grupo — Fatia A (Reorder + Cor/Ícone) — Design

**Data:** 2026-06-13
**Status:** Aprovado (design + mockup validados pelo Alf)
**Relacionado:** [[project_groupchat_anotacoes_grupo]] (v2 fichas tipadas, no ar) ·
[[project_sort_reload_reshuffle]] (cuidado reorder) · Fatia B (futura) = editor rico + IA formatar.

## 1. Objetivo
Deixar a base de conhecimento do grupo **organizável**: reordenar fichas arrastando
(drag-and-drop) e dar **cor + ícone por ficha**. CRUD já tem apagar/editar; faltava reordenar.

## 2. Decisões (confirmadas)
1. **Reorder:** fixadas (📌) continuam no topo e são arrastáveis entre si; abaixo, as "Demais"
   na ordem manual. Arrastar só vale na visão **"Todas"** (sem filtro de tipo nem busca) — com
   filtro ativo o grip some (ordem travada).
2. **Cor + ícone:** cada tipo dá um **padrão**; no editor a pessoa pode trocar a **cor** (paleta
   curada) e o **ícone** (conjunto curado) daquela ficha. Override salvo por ficha.
3. **DnD:** reaproveita `@dnd-kit` + `useSortableSensors()` + padrão handle (grip ⋮⋮) já usado
   em Checklists/Kanban. Sem lib nova.

## 3. Dados — migration aditiva em `group_notes`
- `sort_order int not null default 0` — ordem manual (menor = mais acima).
- `color text` (nullable) — hex da cor escolhida; `null` = usa a cor padrão do tipo.
- `icon text` (nullable) — nome do ícone escolhido; `null` = usa o ícone padrão do tipo.

**Ordenação da query** (`loadGroupNotes`): `pinned DESC, sort_order ASC, created_at DESC`.
- Fichas novas (UI **e** TOM) nascem com `sort_order = 0` → caem no **topo** das Demais
  (0 < qualquer posição manual), desempate por `created_at DESC` (mais nova em cima).
- Ao reordenar, grava `sort_order = posição (1..N)` nas fichas da seção mexida.
- **Anti-reshuffle** [[project_sort_reload_reshuffle]]: ordenar SEMPRE por `sort_order` no banco;
  persistir inteiros; update otimista no React Query; nunca reordenar array só em memória.

## 4. Backend / TOM
Nenhuma mudança no marker `<<GROUP_NOTE>>`: o TOM **não** define aparência nem posição.
`createGroupNote` segue igual (sort_order default 0, color/icon null) → ficha do TOM nasce com
o padrão do tipo, no topo. Aparência é resolvida no render (PWA), não no banco.

## 5. PWA

### 5.1 `lib/groupNotes.ts`
- `GroupNote` ganha `sort_order: number; color: string | null; icon: string | null`.
- `TYPE_DEFAULTS: Record<NoteType, { color: string; icon: string }>` (ex.: acesso →
  `#185FA5`/`KeyRound`, cnpj → `#3B6D11`/`Building2`, conta → `#854F0B`/`Banknote`,
  reuniao → `#993556`/`NotebookPen`, livre → `#5F5E5A`/`FileText`).
- `NOTE_COLORS: string[]` (8 hex do DS: azul/teal/âmbar/rosa/roxo/coral/cinza/verde).
- `NOTE_ICONS: string[]` (~16 nomes Lucide curados).
- Puras: `resolveColor(n)` = `n.color ?? TYPE_DEFAULTS[n.type].color`; `resolveIcon(n)` idem.
- I/O: `reorderGroupNotes(updates: {id, sort_order}[])` — batch update. `upsertGroupNote` passa
  color/icon/sort_order.
- `loadGroupNotes` ordena por sort_order (ver §3).

### 5.2 `notes/IconRegistry.tsx` (novo)
Mapa `nome→componente Lucide` (só os ícones curados) + `<NoteGlyph name color size/>` que resolve
o nome. `TypeIcon` passa a usar esse registry (recebe nome resolvido). Fallback FileText.

### 5.3 Reorder no `GrupoAnotacoes.tsx`
- `DndContext` (sensors do `useSortableSensors`) só quando `dragEnabled = !typeFilter && !query`.
- Duas `SortableContext`: lista de Fixadas e lista de Demais (cada `NoteCard` = sortable item via
  id). `onDragEnd`: `arrayMove` na seção → renumera `sort_order=1..N` → `reorder.mutate(updates)`
  (otimista). Drag não cruza entre seções (fixada continua fixada).
- Quando `dragEnabled` é falso, renderiza os cards sem grip (sem SortableContext).

### 5.4 `NoteCard.tsx`
- Faixa de accent à esquerda (`border-left` 3px) na `resolveColor(note)`; ícone = `resolveIcon`
  tingido na cor. Grip ⋮⋮ (handle-only, listeners no grip) à esquerda **quando `dragEnabled`**.

### 5.5 `NoteEditor.tsx`
- Nova seção **"Aparência"**: swatches de `NOTE_COLORS` (selecionado = ring) + grade de
  `NOTE_ICONS` (selecionado = borda tom). Default destacado = o do tipo. Edita `color`/`icon` no
  draft (auto-save existente). Prévia: o cabeçalho do editor já mostra ícone+cor escolhidos.

### 5.6 `NoteDetail.tsx`
- Ícone do cabeçalho usa `resolveIcon`/`resolveColor` (em vez do TypeIcon puro por tipo).

## 6. Testes
- **Vitest puras:** `resolveColor`/`resolveIcon` (override vs default por tipo); ordenação
  (`loadGroupNotes` sort estável: pinned→sort_order→created_at); renumeração no reorder
  (helper puro `renumber(list)` → 1..N).
- **Preview e2e:** arrastar uma ficha em "Todas" → ordem persiste após reload (anti-reshuffle);
  trocar cor+ícone → reflete no card e no detalhe; grip some ao filtrar por tipo.

## 7. Fora de escopo (Fatia B / futuro)
Editor rico (TipTap) + IA "Formatar com o TOM" (auto-format/resumir/corrigir) = **Fatia B**.
Unificar visual com `/anotacoes` pessoal = futuro. Reorder dentro de filtro = descartado.
