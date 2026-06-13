# Anotações do Grupo — Fatia A (Reorder + Cor/Ícone) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans (execução inline). Steps com checkbox.

**Goal:** Reordenar fichas do grupo arrastando (drag-and-drop) + cor/ícone por ficha (padrão por tipo + override).

**Architecture:** Migration aditiva (`sort_order`/`color`/`icon`) em `group_notes`. PWA: `@dnd-kit` (reuso `useSortableSensors`) na `GrupoAnotacoes` com 2 SortableContext (Fixadas/Demais) só na visão "Todas"; cor/ícone resolvidos no render (default por tipo + override por ficha) via `IconRegistry`. TOM/backend inalterados.

**Tech Stack:** Supabase Postgres, React+TS, @dnd-kit/core+sortable, lucide-react, vitest.

---

## Convenções
- PWA só em `web/`; `npx tsc --noEmit && npx vite build` antes de entregar; auto-deploy commita/pusha (web/src usa robocopy /MIR — deleções espelham).
- DS: cor `tom`, tokens `bg-bg-surface/text-fg/border-border`; guardrail 375/1440.
- Anti-reshuffle [[project_sort_reload_reshuffle]]: ordenar no banco por `sort_order`; persistir inteiros; update otimista.
- Não regredir: `NoteEditor` tem `key` de remount + indicador Salvando/Salvo; `blankNote(groupId)` cria ficha em branco.

## File Structure
| Arquivo | Responsabilidade | Ação |
|---|---|---|
| migration `group_notes_fatiaA` | +sort_order/color/icon | Criar (MCP) |
| `web/src/lib/groupNotes.ts` | tipos+TYPE_DEFAULTS+NOTE_COLORS/ICONS+resolve*+renumber+reorder I/O | Modificar |
| `web/src/lib/groupNotes.test.ts` | puras | Modificar |
| `web/src/screens/grupos/notes/IconRegistry.tsx` | nome→Lucide + NoteGlyph | Criar |
| `web/src/screens/grupos/notes/TypeIcon.tsx` | delega ao registry | Modificar |
| `web/src/hooks/useGroupNotes.ts` | mutation reorder | Modificar |
| `web/src/screens/grupos/notes/NoteCard.tsx` | accent+ícone+grip | Modificar |
| `web/src/screens/grupos/notes/NoteDetail.tsx` | header resolve cor/ícone | Modificar |
| `web/src/screens/grupos/notes/NoteEditor.tsx` | seção Aparência | Modificar |
| `web/src/screens/grupos/GrupoAnotacoes.tsx` | DnD + dragEnabled | Modificar |

---

## Task 1 — Migration
- [ ] **Step 1:** `apply_migration` (cesnbnrynvxvgdhfmaua, `group_notes_fatiaA`):
```sql
alter table public.group_notes add column if not exists sort_order int not null default 0;
alter table public.group_notes add column if not exists color text;
alter table public.group_notes add column if not exists icon text;
```
- [ ] **Step 2:** verificar via execute_sql: `select column_name from information_schema.columns where table_name='group_notes' and column_name in ('sort_order','color','icon');` → 3 linhas.

## Task 2 — lib puras (TDD)
**Files:** `web/src/lib/groupNotes.ts`, `web/src/lib/groupNotes.test.ts`
- [ ] **Step 1 (teste que falha):** adicionar em groupNotes.test.ts:
```ts
import { resolveColor, resolveIcon, renumber, TYPE_DEFAULTS } from './groupNotes';
describe('aparência + reorder', () => {
  it('resolveColor usa override, senão default do tipo', () => {
    expect(resolveColor(N({ type:'acesso', color:null }))).toBe(TYPE_DEFAULTS.acesso.color);
    expect(resolveColor(N({ type:'acesso', color:'#123456' }))).toBe('#123456');
  });
  it('resolveIcon usa override, senão default do tipo', () => {
    expect(resolveIcon(N({ type:'conta', icon:null }))).toBe(TYPE_DEFAULTS.conta.icon);
    expect(resolveIcon(N({ type:'conta', icon:'Star' }))).toBe('Star');
  });
  it('renumber devolve {id,sort_order} 1..N na ordem da lista', () => {
    expect(renumber([N({id:'a'}),N({id:'b'}),N({id:'c'})])).toEqual([
      {id:'a',sort_order:1},{id:'b',sort_order:2},{id:'c',sort_order:3}]);
  });
});
```
> `N()` helper já existe no arquivo; estender o default p/ incluir `sort_order:0, color:null, icon:null`.
- [ ] **Step 2:** rodar `cd web && npx vitest run src/lib/groupNotes.test.ts` → FAIL (resolveColor/renumber inexistentes).
- [ ] **Step 3 (implementar):** em groupNotes.ts:
  - `GroupNote` += `sort_order: number; color: string | null; icon: string | null`.
  - `export const TYPE_DEFAULTS: Record<NoteType,{color:string;icon:string}> = { acesso:{color:'#185FA5',icon:'KeyRound'}, cnpj:{color:'#3B6D11',icon:'Building2'}, conta:{color:'#854F0B',icon:'Banknote'}, reuniao:{color:'#993556',icon:'NotebookPen'}, livre:{color:'#5F5E5A',icon:'FileText'} };`
  - `export const NOTE_COLORS = ['#185FA5','#0F6E56','#854F0B','#993556','#534AB7','#993C1D','#3B6D11','#5F5E5A'];`
  - `export const NOTE_ICONS = ['KeyRound','Building2','BuildingStore','Banknote','CreditCard','NotebookPen','FileText','IdCard','CalendarDays','Landmark','Receipt','Lock','Mail','Phone','MapPin','Star'];`
  - `export const resolveColor = (n:Pick<GroupNote,'type'|'color'>) => n.color ?? TYPE_DEFAULTS[n.type].color;`
  - `export const resolveIcon = (n:Pick<GroupNote,'type'|'icon'>) => n.icon ?? TYPE_DEFAULTS[n.type].icon;`
  - `export const renumber = (list:{id:string}[]) => list.map((n,i)=>({id:n.id, sort_order:i+1}));`
  - `loadGroupNotes`: `.order('pinned',{ascending:false}).order('sort_order',{ascending:true}).order('created_at',{ascending:false})`; map garante `fields`/defaults (sort_order ?? 0, color ?? null, icon ?? null).
  - `upsertGroupNote`: incluir `color: note.color ?? null, icon: note.icon ?? null` no payload (NÃO setar sort_order aqui → fica default 0 = topo).
  - `export async function reorderGroupNotes(updates:{id:string;sort_order:number}[]){ for chunk → supabase.from('group_notes').upsert(...)`? **Não** — usar updates individuais: `await Promise.all(updates.map(u=>supabase.from('group_notes').update({sort_order:u.sort_order}).eq('id',u.id)))`.
- [ ] **Step 4:** `npx vitest run src/lib/groupNotes.test.ts` → PASS.

## Task 3 — IconRegistry
**Files:** Create `web/src/screens/grupos/notes/IconRegistry.tsx`; Modify `TypeIcon.tsx`.
- [ ] **Step 1 (criar):**
```tsx
import { KeyRound, Building2, Store, Banknote, CreditCard, NotebookPen, FileText, IdCard, CalendarDays, Landmark, Receipt, Lock, Mail, Phone, MapPin, Star, type LucideIcon } from 'lucide-react';
const REG: Record<string, LucideIcon> = { KeyRound, Building2, BuildingStore: Store, Banknote, CreditCard, NotebookPen, FileText, IdCard, CalendarDays, Landmark, Receipt, Lock, Mail, Phone, MapPin, Star };
export function NoteGlyph({ name, color, size = 16, className }: { name: string; color?: string; size?: number; className?: string }) {
  const Icon = REG[name] ?? FileText;
  return <Icon size={size} color={color} className={className} aria-hidden />;
}
```
> `IdCard` pode não existir em lucide; se faltar, trocar por `Contact`. Confirmar no implement (import quebra build se nome errado).
- [ ] **Step 2:** `TypeIcon.tsx` passa a reusar — manter assinatura `TypeIcon({type,size,className})` mas render `<NoteGlyph name={TYPE_DEFAULTS[type].icon} size className/>` (importa TYPE_DEFAULTS). (Mantém compat com NotesTypeFilter que usa TypeIcon.)
- [ ] **Step 3:** `npx tsc --noEmit` → 0.

## Task 4 — hook reorder
**Files:** `web/src/hooks/useGroupNotes.ts`
- [ ] **Step 1:** importar `reorderGroupNotes`; adicionar mutation:
```ts
const reorder = useMutation({
  mutationFn: (updates: {id:string;sort_order:number}[]) => reorderGroupNotes(updates),
  onMutate: async (updates) => {
    await qc.cancelQueries({ queryKey: key });
    const prev = qc.getQueryData<GroupNote[]>(key);
    const map = new Map(updates.map(u=>[u.id,u.sort_order]));
    qc.setQueryData<GroupNote[]>(key, (old)=> (old??[]).map(n=> map.has(n.id)?{...n,sort_order:map.get(n.id)!}:n));
    return { prev };
  },
  onError: (_e,_v,ctx)=> ctx?.prev && qc.setQueryData(key, ctx.prev),
  onSettled: inval,
});
return { notes: list.data ?? [], loading: list.isLoading, save, remove, pin, reorder };
```
- [ ] **Step 2:** `npx tsc --noEmit` → 0.

## Task 5 — NoteCard (accent + ícone + grip)
**Files:** `web/src/screens/grupos/notes/NoteCard.tsx`
- [ ] **Step 1:** props += `dragHandle?: React.ReactNode`. Trocar `<TypeIcon type=…>` por `<NoteGlyph name={resolveIcon(note)} color={resolveColor(note)} size={15} />`. Adicionar `style={{ borderLeft: \`3px solid ${resolveColor(note)}\` }}` no container (manter classes). Renderizar `{dragHandle}` antes do ícone quando passado.
- [ ] **Step 2:** `npx tsc --noEmit` → 0.

## Task 6 — NoteDetail (header cor/ícone)
**Files:** `web/src/screens/grupos/notes/NoteDetail.tsx`
- [ ] **Step 1:** trocar `<TypeIcon type={note.type} size={20} className="text-tom"/>` por `<NoteGlyph name={resolveIcon(note)} color={resolveColor(note)} size={20} />`.
- [ ] **Step 2:** `npx tsc --noEmit` → 0.

## Task 7 — NoteEditor (seção Aparência)
**Files:** `web/src/screens/grupos/notes/NoteEditor.tsx`
- [ ] **Step 1:** importar `NOTE_COLORS, NOTE_ICONS, resolveColor, resolveIcon`, `NoteGlyph`. Após a linha de Tipo, adicionar seção:
```tsx
<div className="text-label uppercase tracking-wide text-fg-muted mb-xs">Aparência</div>
<div className="flex flex-wrap gap-xs mb-sm">
  {NOTE_COLORS.map(c => (
    <button key={c} type="button" onClick={()=>patch({color:c})} aria-label={`Cor ${c}`}
      className="w-6 h-6 rounded-full focus-ring" style={{ background:c, outline: resolveColor({type:draft.type as NoteType, color:draft.color??null})===c ? '2px solid var(--color-fg)' : 'none', outlineOffset:'2px' }} />
  ))}
</div>
<div className="flex flex-wrap gap-xs mb-md">
  {NOTE_ICONS.map(ic => { const on = resolveIcon({type:draft.type as NoteType, icon:draft.icon??null})===ic; return (
    <button key={ic} type="button" onClick={()=>patch({icon:ic})} aria-label={ic}
      className={`grid place-items-center w-8 h-8 rounded-md border ${on?'border-tom text-tom':'border-border text-fg-muted'}`}>
      <NoteGlyph name={ic} size={16} /></button>); })}
</div>
```
> `patch` já existe (auto-save). `draft.type` já é controlado pelo CustomSelect. Garantir que `blankNote`/draft inicial não quebra (color/icon podem ser undefined → tratar como null).
- [ ] **Step 2:** `npx tsc --noEmit` → 0.

## Task 8 — GrupoAnotacoes (DnD)
**Files:** `web/src/screens/grupos/GrupoAnotacoes.tsx`
- [ ] **Step 1:** imports: `DndContext, closestCenter, type DragEndEvent` de `@dnd-kit/core`; `SortableContext, useSortable, verticalListSortingStrategy, arrayMove` de `@dnd-kit/sortable`; `CSS` de `@dnd-kit/utilities`; `useSortableSensors` de `../../lib/sortableSensors`; `renumber` de lib; `GripVertical` de lucide.
- [ ] **Step 2:** `const sensors = useSortableSensors();` `const dragEnabled = !typeFilter && !query.trim();`
- [ ] **Step 3:** dividir `filtered` em `pinned = filtered.filter(n=>n.pinned)` e `rest = filtered.filter(n=>!n.pinned)`. Componente interno `SortableNoteCard({note})` que usa `useSortable({id:note.id})` e passa o grip (com listeners/attributes) como `dragHandle` ao `NoteCard`, aplicando `style={{transform:CSS.Transform.toString(transform),transition}}`.
- [ ] **Step 4:** handler:
```tsx
function onDragEnd(section:'pinned'|'rest', e:DragEndEvent){
  const {active,over}=e; if(!over||active.id===over.id) return;
  const arr = section==='pinned'?pinned:rest;
  const oldI = arr.findIndex(n=>n.id===active.id), newI = arr.findIndex(n=>n.id===over.id);
  const next = arrayMove(arr, oldI, newI);
  reorder.mutate(renumber(next));
}
```
- [ ] **Step 5:** render: quando `dragEnabled`, embrulhar cada seção em `<DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={(e)=>onDragEnd('pinned',e)}><SortableContext items={pinned.map(n=>n.id)} strategy={verticalListSortingStrategy}>…SortableNoteCard…</SortableContext></DndContext>` (idem rest). Quando `!dragEnabled`, render `NoteCard` simples (sem grip), lista achatada `filtered`. Cabeçalhos "📌 Fixadas"/"Demais" aparecem só quando há pinned (na visão Todas). Manter `onClick={()=>openNote(n)}` no card; o grip tem `onClick stopPropagation`.
> Cuidado: clique no card abre a ficha; arrastar é só pelo grip (handle-only). `pointer distance:8` já distingue (sensor padrão).
- [ ] **Step 6:** `npx tsc --noEmit && npx vite build` → limpo.

## Task 9 — Validação no preview + entrega
- [ ] **Step 1:** preview localhost:4173 (limpar SW), grupo Financeiro → /anotacoes. Criar 2-3 fichas de teste (tipos diferentes). Arrastar pelo grip em "Todas" → ordem muda; **reload** → ordem PERSISTE (anti-reshuffle). Filtrar por tipo → grip some. Abrir editor → trocar cor+ícone → card e detalhe refletem. Validar com `preview_eval` + screenshot.
- [ ] **Step 2:** limpar fichas de teste (deixar só a "Contas a Pagar" da Rose). tsc+build limpos. Auto-deploy entrega.
- [ ] **Step 3:** memória [[project_groupchat_anotacoes_grupo]] += Fatia A (reorder sort_order + cor/ícone). Sem known issue (feature).

## Self-Review
- **Cobertura spec:** §3 migration→T1; §5.1 lib→T2; §5.2 registry→T3; §5.3 DnD→T8; §5.4 card→T5; §5.5 editor→T7; §5.6 detail→T6; hook→T4; testes→T2+T9. ✅
- **Placeholders:** nota do `IdCard`/`BuildingStore` = fidelidade ao lucide real (confirmar nome no implement), com fallback. Sem TBD.
- **Type consistency:** `resolveColor/resolveIcon` recebem `Pick<…>`; `renumber→{id,sort_order}`; `reorder.mutate(updates)` casa com `reorderGroupNotes`. `NoteGlyph({name,color,size})` consistente em card/detail/editor. ✅
