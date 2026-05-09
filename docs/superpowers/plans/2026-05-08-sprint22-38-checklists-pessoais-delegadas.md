# Sprint 22.38 — Checklists Pessoais + Delegadas — Implementation Plan

> **Codebase note:** Este projeto **não tem suíte de testes**. TDD steps são substituídos por "verificação manual via Simple Browser preview + SQL test". Padrão estabelecido na Sprint 22.37.

**Goal:** Adicionar tabs Trabalho/Pessoal/Delegadas em `/checklists`, com schema novo de listas pessoais (CRUD via PWA + TOM) e leitura de tasks delegadas.

**Architecture:** Migration cria 2 tabelas com RLS owner-only. PWA ganha 3 componentes novos + tabs em Checklists.tsx. Engine TOM lê listas no contexto (gated) + handler para `<<PERSONAL_LIST_ACTION>>`.

**Tech Stack:** React 18 + Vite + TypeScript, Supabase (Postgres + RLS), TanStack Query, @dnd-kit/sortable, Tailwind, Node.js engine.

---

## File Structure

### Novos
- `migrations/2026-05-08-sprint22-38-personal-checklists.sql`
- `web/src/lib/personalChecklists.ts` — fetch/mutation helpers + types
- `web/src/components/PersonalChecklistCard.tsx` — card com items, DnD, ⋮ menu
- `web/src/components/PersonalChecklistSheet.tsx` — BottomSheet criar/editar
- `web/src/components/DelegatedTaskRow.tsx` — linha de delegada
- `skills/listas-pessoais.md` — skill TOM

### Modificados
- `web/src/screens/Checklists.tsx` — tabs (Trabalho/Pessoal/Delegadas)
- `web/src/types.ts` — types novos
- `src/prompts/system.js` — context bloco "Listas pessoais"
- `src/engine.js` — handler `<<PERSONAL_LIST_ACTION>>`
- `docs/06-prd-la-organizer-v3.md` — bump versão + Sprint 22.38
- `docs/05-mapa-telas-pwa-v3.md` — atualizar /checklists com tabs
- `docs/TOM-SKILLS-CATALOG.md` — listas-pessoais

---

## Task 0: Skill `lista-mental.md` — decidir merge/separação

**Files:**
- Read: `skills/lista-mental.md`

- [ ] **Step 1: Ler skill atual e decidir**

Se for sobre "memória mental persistente" (notas soltas) → manter, criar `listas-pessoais.md` ortogonal com cross-link.
Se for sobre "lista de itens executável" → renomear/integrar.

Reportar decisão e proceder.

---

## Task 1: Migration — schema + RLS

**Files:**
- Create: `migrations/2026-05-08-sprint22-38-personal-checklists.sql`

- [ ] **Step 1: Escrever migration**

```sql
-- Sprint 22.38 — Personal checklists (mercado, viagem, remédios, geral)
-- Owner-only via RLS. Sem cron, sem TOM notify automático.

CREATE TABLE personal_checklists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_collab_id uuid NOT NULL REFERENCES collaborators(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  list_type text NOT NULL DEFAULT 'general'
    CHECK (list_type IN ('shopping','travel','meds','general')),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE personal_checklist_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  list_id uuid NOT NULL REFERENCES personal_checklists(id) ON DELETE CASCADE,
  description text NOT NULL CHECK (length(description) BETWEEN 1 AND 200),
  is_done boolean NOT NULL DEFAULT false,
  sort_order integer NOT NULL DEFAULT 0,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX personal_checklists_owner_active_idx
  ON personal_checklists (owner_collab_id, is_active);
CREATE INDEX personal_checklist_items_list_sort_idx
  ON personal_checklist_items (list_id, sort_order);

ALTER TABLE personal_checklists ENABLE ROW LEVEL SECURITY;
ALTER TABLE personal_checklist_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY personal_checklists_owner ON personal_checklists
  FOR ALL TO authenticated
  USING (owner_collab_id = current_collab_id())
  WITH CHECK (owner_collab_id = current_collab_id());

CREATE POLICY personal_checklist_items_owner ON personal_checklist_items
  FOR ALL TO authenticated
  USING (list_id IN (SELECT id FROM personal_checklists WHERE owner_collab_id = current_collab_id()))
  WITH CHECK (list_id IN (SELECT id FROM personal_checklists WHERE owner_collab_id = current_collab_id()));

-- Auto updated_at via trigger (assume função update_updated_at_column existe; senão criar)
CREATE TRIGGER personal_checklists_updated
  BEFORE UPDATE ON personal_checklists
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER personal_checklist_items_updated
  BEFORE UPDATE ON personal_checklist_items
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
```

- [ ] **Step 2: Aplicar via mcp__4c04bb52-...__apply_migration**

- [ ] **Step 3: Validar SQL test**

```sql
SELECT id FROM personal_checklists LIMIT 1;
-- Insert teste: deve funcionar pra owner próprio
INSERT INTO personal_checklists (owner_collab_id, name, list_type)
  VALUES (current_collab_id(), 'Mercado teste', 'shopping')
  RETURNING id;
```

---

## Task 2: Types em `web/src/types.ts`

**Files:**
- Modify: `web/src/types.ts`

- [ ] **Step 1: Adicionar types**

```typescript
export type PersonalListType = 'shopping' | 'travel' | 'meds' | 'general';

export interface PersonalChecklistItem {
  id: string;
  list_id: string;
  description: string;
  is_done: boolean;
  sort_order: number;
  note: string | null;
  created_at: string;
  updated_at: string;
}

export interface PersonalChecklist {
  id: string;
  owner_collab_id: string;
  name: string;
  list_type: PersonalListType;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  personal_checklist_items?: PersonalChecklistItem[];
}

export const PERSONAL_LIST_TYPE_ICON: Record<PersonalListType, string> = {
  shopping: '🛒',
  travel: '✈️',
  meds: '💊',
  general: '📋',
};

export const PERSONAL_LIST_TYPE_LABEL: Record<PersonalListType, string> = {
  shopping: 'Mercado',
  travel: 'Viagem',
  meds: 'Remédios',
  general: 'Geral',
};
```

---

## Task 3: Helpers `web/src/lib/personalChecklists.ts`

**Files:**
- Create: `web/src/lib/personalChecklists.ts`

- [ ] **Step 1: Criar fetch helpers**

```typescript
import { supabase } from './supabase';
import type { PersonalChecklist, PersonalListType } from '../types';

export async function fetchPersonalChecklists(ownerId: string): Promise<PersonalChecklist[]> {
  const { data, error } = await supabase
    .from('personal_checklists')
    .select('*, personal_checklist_items (*)')
    .eq('owner_collab_id', ownerId)
    .eq('is_active', true)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as PersonalChecklist[];
}

export async function createPersonalChecklist(input: {
  ownerId: string;
  name: string;
  listType: PersonalListType;
  initialItems: string[];
}): Promise<PersonalChecklist> {
  const { data: list, error: e1 } = await supabase
    .from('personal_checklists')
    .insert({ owner_collab_id: input.ownerId, name: input.name, list_type: input.listType })
    .select('*')
    .single();
  if (e1) throw e1;

  if (input.initialItems.length) {
    const items = input.initialItems.map((d, i) => ({
      list_id: list.id, description: d, sort_order: i + 1,
    }));
    const { error: e2 } = await supabase.from('personal_checklist_items').insert(items);
    if (e2) throw e2;
  }
  return list as PersonalChecklist;
}

export async function toggleItem(itemId: string, isDone: boolean) {
  const { error } = await supabase
    .from('personal_checklist_items')
    .update({ is_done: isDone })
    .eq('id', itemId);
  if (error) throw error;
}

export async function addItem(listId: string, description: string, sortOrder: number) {
  const { error } = await supabase
    .from('personal_checklist_items')
    .insert({ list_id: listId, description, sort_order: sortOrder });
  if (error) throw error;
}

export async function updateItemDescription(itemId: string, description: string) {
  const { error } = await supabase
    .from('personal_checklist_items')
    .update({ description })
    .eq('id', itemId);
  if (error) throw error;
}

export async function deleteItem(itemId: string) {
  const { error } = await supabase
    .from('personal_checklist_items')
    .delete()
    .eq('id', itemId);
  if (error) throw error;
}

export async function reorderItems(listId: string, ordered: { id: string; sort_order: number }[]) {
  const updates = ordered.map(o =>
    supabase.from('personal_checklist_items')
      .update({ sort_order: o.sort_order })
      .eq('id', o.id)
  );
  const results = await Promise.all(updates);
  for (const r of results) if (r.error) throw r.error;
}

export async function renameList(listId: string, name: string) {
  const { error } = await supabase
    .from('personal_checklists')
    .update({ name })
    .eq('id', listId);
  if (error) throw error;
}

export async function changeListType(listId: string, listType: PersonalListType) {
  const { error } = await supabase
    .from('personal_checklists')
    .update({ list_type: listType })
    .eq('id', listId);
  if (error) throw error;
}

export async function archiveList(listId: string) {
  const { error } = await supabase
    .from('personal_checklists')
    .update({ is_active: false })
    .eq('id', listId);
  if (error) throw error;
}

export async function saveItemNote(itemId: string, note: string) {
  const { error } = await supabase
    .from('personal_checklist_items')
    .update({ note })
    .eq('id', itemId);
  if (error) throw error;
}
```

---

## Task 4: `PersonalChecklistCard.tsx`

**Files:**
- Create: `web/src/components/PersonalChecklistCard.tsx`

- [ ] **Step 1: Implementar card com DnD + items + menu**

Estrutura:
- Header colapsável (chevron + click), persiste em localStorage `personal-checklist:collapsed:<id>`.
- Barra `bg-tom` width pct.
- ⋮ menu: Renomear / Mudar tipo / Arquivar.
- Body: `<DndContext>` + `<SortableContext>` com `ChecklistItemRow` reutilizado (passar `onCreateTask={undefined}`).
- Inline `<ChecklistAddItemForm onAdd={...} />`.
- Auto-colapsa quando 100%.

Reusa: `ChecklistItemRow`, `ChecklistAddItemForm`, `useSortableSensors`, `RowMenu` (se existir; senão usar componente menu existente do ChecklistCard como ref).

Props: `{ list: PersonalChecklist }`. Mutations via `personalChecklists.ts` + `queryClient.invalidateQueries(['personal-checklists'])`.

---

## Task 5: `PersonalChecklistSheet.tsx`

**Files:**
- Create: `web/src/components/PersonalChecklistSheet.tsx`

- [ ] **Step 1: BottomSheet criar/editar**

Estrutura:
- Input nome (max 80)
- Radio chips de tipo (4 emoji: 🛒 ✈️ 💊 📋)
- Lista de items iniciais (input + botão "+", mostra items com ícone X pra remover)
- Botão "Salvar lista"

Props: `{ open: boolean; onClose: () => void }`. Usa `createPersonalChecklist`.

---

## Task 6: `DelegatedTaskRow.tsx`

**Files:**
- Create: `web/src/components/DelegatedTaskRow.tsx`

- [ ] **Step 1: Implementar linha**

Recebe task. Renderiza:
```
👤 [assignee.full_name]
"[task.title]"
📅 [due_date formatted] · [emoji status]
```

Status emoji helper local:
```typescript
function statusEmoji(status: string, dueDate: string | null): string {
  const today = new Date().toISOString().slice(0,10);
  if (dueDate && dueDate < today && status !== 'done') return '🔴';
  switch (status) {
    case 'pending': return '🟡';
    case 'in_progress': return '🟢';
    case 'awaiting_confirmation': return '🟣';
    default: return '⚪';
  }
}
```

Click: navega para `/projetos/${task.project_id}` se houver, senão `/agenda`.

---

## Task 7: Refactor `Checklists.tsx` com tabs

**Files:**
- Modify: `web/src/screens/Checklists.tsx`

- [ ] **Step 1: Adicionar tabs + switch**

```typescript
import { useSearchParams } from 'react-router-dom';
import { Tabs } from '../components/Tabs';
// ... imports

type Tab = 'trabalho' | 'pessoal' | 'delegadas';

export function Checklists() {
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = (searchParams.get('tab') as Tab) || 'trabalho';
  const setTab = (t: Tab) => setSearchParams({ tab: t });

  return (
    <div className="space-y-md">
      <Tabs
        items={[
          { value: 'trabalho', label: 'Trabalho' },
          { value: 'pessoal', label: 'Pessoal' },
          { value: 'delegadas', label: 'Delegadas' },
        ]}
        active={tab}
        onChange={v => setTab(v as Tab)}
      />
      {tab === 'trabalho' && <TrabalhoTab />}
      {tab === 'pessoal' && <PessoalTab />}
      {tab === 'delegadas' && <DelegadasTab />}
    </div>
  );
}
```

- [ ] **Step 2: Extrair `TrabalhoTab` (código atual)**

Move o `useQuery` de op_checklist_completions e render de `ChecklistCard` pra função local `TrabalhoTab`.

- [ ] **Step 3: Implementar `PessoalTab`**

```typescript
function PessoalTab() {
  const { collaborator } = useAuth();
  const [sheetOpen, setSheetOpen] = useState(false);
  const { data: lists, isLoading } = useQuery({
    queryKey: ['personal-checklists', collaborator?.id],
    queryFn: () => fetchPersonalChecklists(collaborator!.id),
    enabled: !!collaborator,
  });

  if (isLoading) return <LoadingState />;
  const items = lists ?? [];
  return (
    <div className="space-y-sm">
      <div className="flex items-center justify-between">
        <h2 className="text-section-title">Listas pessoais</h2>
        <button onClick={() => setSheetOpen(true)} className="...">+ Criar lista</button>
      </div>
      {items.length === 0 ? (
        <EmptyState ... />
      ) : items.map(l => <PersonalChecklistCard key={l.id} list={l} />)}
      <PersonalChecklistSheet open={sheetOpen} onClose={() => setSheetOpen(false)} />
    </div>
  );
}
```

- [ ] **Step 4: Implementar `DelegadasTab`**

```typescript
function DelegadasTab() {
  const { collaborator } = useAuth();
  const [view, setView] = useState<'ativas'|'concluidas'>('ativas');
  const { data: tasks, isLoading } = useQuery({
    queryKey: ['delegated-tasks', collaborator?.id, view],
    queryFn: async () => {
      const q = supabase.from('tasks')
        .select('id, title, status, due_date, project_id, assigned_to, projects(name), collaborators!tasks_assigned_to_fkey(full_name)')
        .eq('created_by', collaborator!.id)
        .neq('assigned_to', collaborator!.id);
      if (view === 'ativas') q.not('status', 'in', '(done,cancelled)');
      else q.in('status', ['done','cancelled']).gte('completed_at', new Date(Date.now()-30*24*3600*1000).toISOString());
      const { data, error } = await q.order('due_date', { ascending: true, nullsFirst: false });
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!collaborator,
  });

  if (isLoading) return <LoadingState />;
  const list = tasks ?? [];
  return (
    <div className="space-y-sm">
      <div className="flex gap-2">
        <button onClick={()=>setView('ativas')} className={view==='ativas'?'pill-active':'pill'}>Ativas</button>
        <button onClick={()=>setView('concluidas')} className={view==='concluidas'?'pill-active':'pill'}>Concluídas</button>
      </div>
      {list.length === 0 ? <EmptyState ... /> : list.map(t => <DelegatedTaskRow key={t.id} task={t as any} />)}
    </div>
  );
}
```

> **Nota:** confirmar nome da FK `tasks_assigned_to_fkey`. Se diferente, ajustar.

---

## Task 8: Engine context — bloco "Listas pessoais"

**Files:**
- Modify: `src/prompts/system.js`

- [ ] **Step 1: Adicionar fetch em `fetchCollaboratorContext`**

Encontrar bloco onde `Promise.all([...])` busca contexts (perto de `delegatedRes`). Adicionar:

```javascript
supabase.from('personal_checklists')
  .select('id, name, list_type, personal_checklist_items(description, is_done, sort_order)')
  .eq('owner_collab_id', collaborator.id)
  .eq('is_active', true)
  .limit(20)
```

E expor como `personalChecklists` no return.

- [ ] **Step 2: Estender `buildContext` com novo param**

Adicionar `personalChecklists` no signature e bloco de render:

```javascript
if (personalChecklists && personalChecklists.length) {
  const withPending = personalChecklists.filter(l =>
    (l.personal_checklist_items || []).some(it => !it.is_done)
  );
  if (withPending.length) {
    lines.push('', `**Listas pessoais (${withPending.length} ativas):**`);
    const ICON = { shopping:'🛒', travel:'✈️', meds:'💊', general:'📋' };
    withPending.slice(0, 8).forEach(l => {
      const items = (l.personal_checklist_items || []).filter(it => !it.is_done)
        .sort((a,b) => a.sort_order - b.sort_order);
      const sample = items.slice(0,3).map(it => it.description).join(', ');
      const more = items.length > 3 ? ` +${items.length - 3}` : '';
      lines.push(`- ${ICON[l.list_type] || '📋'} ${l.name}: ${items.length} pendentes (${sample}${more})`);
    });
  }
}
```

- [ ] **Step 3: Atualizar todos os call-sites de `buildContext`**

Buscar `buildContext(` no arquivo, adicionar `ctx.personalChecklists || []` como último arg em cada chamada.

---

## Task 9: Engine handler — `<<PERSONAL_LIST_ACTION>>`

**Files:**
- Modify: `src/engine.js`

- [ ] **Step 1: Adicionar handler**

Localizar onde outras action tags são processadas (ex: `<<HABIT_ACTION>>`). Adicionar branch:

```javascript
const personalListMatch = response.match(/<<PERSONAL_LIST_ACTION>>([\s\S]*?)<<END>>/);
if (personalListMatch) {
  try {
    const payload = JSON.parse(personalListMatch[1].trim());
    // payload: { action: 'create'|'add_item'|'toggle_item'|'rename'|'archive', ... }
    if (payload.action === 'create') {
      const { data: list } = await sb.from('personal_checklists').insert({
        owner_collab_id: collaborator.id,
        name: payload.name,
        list_type: payload.list_type || 'general',
      }).select('id').single();
      if (payload.items?.length) {
        await sb.from('personal_checklist_items').insert(
          payload.items.map((d, i) => ({ list_id: list.id, description: d, sort_order: i+1 }))
        );
      }
    } else if (payload.action === 'add_item') {
      // payload: { list_id, description }
      const { data: maxRow } = await sb.from('personal_checklist_items')
        .select('sort_order').eq('list_id', payload.list_id)
        .order('sort_order', { ascending: false }).limit(1).single();
      await sb.from('personal_checklist_items').insert({
        list_id: payload.list_id,
        description: payload.description,
        sort_order: (maxRow?.sort_order || 0) + 1,
      });
    } else if (payload.action === 'toggle_item') {
      await sb.from('personal_checklist_items').update({ is_done: payload.is_done })
        .eq('id', payload.item_id);
    } else if (payload.action === 'rename') {
      await sb.from('personal_checklists').update({ name: payload.name }).eq('id', payload.list_id);
    } else if (payload.action === 'archive') {
      await sb.from('personal_checklists').update({ is_active: false }).eq('id', payload.list_id);
    }
  } catch (e) {
    console.error('[engine] PERSONAL_LIST_ACTION failed:', e);
  }
}
```

`sb` = supabase service-role client (assumindo padrão existente; se nome diferente, ajustar).

---

## Task 10: Skill TOM `listas-pessoais.md`

**Files:**
- Create: `skills/listas-pessoais.md`

- [ ] **Step 1: Escrever skill**

Documenta:
- Quando ativar (user fala "lista de mercado", "viagem", "remédios", "tô fazendo compras")
- Como criar: `<<PERSONAL_LIST_ACTION>>{"action":"create","name":"Mercado","list_type":"shopping","items":["tomate","ovo"]}<<END>>`
- Como adicionar item: `{"action":"add_item","list_id":"<uuid do contexto>","description":"leite"}`
- Como marcar: `{"action":"toggle_item","item_id":"<uuid>","is_done":true}`
- Cross-link com `lista-mental.md` (decidido em Task 0)

---

## Task 11: Atualizar docs

**Files:**
- Modify: `docs/06-prd-la-organizer-v3.md` (bump versão + Sprint 22.38 history)
- Modify: `docs/05-mapa-telas-pwa-v3.md` (/checklists agora tem 3 tabs)
- Modify: `docs/TOM-SKILLS-CATALOG.md` (adicionar listas-pessoais)

- [ ] **Step 1: Bump PRD**

Incrementar versão (3.10 → 3.11). Adicionar entry em Sprint History:
> **22.38 (2026-05-08):** Tabs em /checklists (Trabalho/Pessoal/Delegadas), schema personal_checklists, TOM context "Listas pessoais", skill listas-pessoais.

- [ ] **Step 2: Atualizar mapa de telas**

Em `/checklists` adicionar: "3 tabs: Trabalho (op_checklist_completions), Pessoal (personal_checklists), Delegadas (tasks delegadas leitura)".

- [ ] **Step 3: Atualizar skills catalog**

Adicionar entry `listas-pessoais.md` com descrição.

---

## Task 12: Validação preview + deploy

- [ ] **Step 1: Preview valida fluxo completo**

1. Reload `/checklists?tab=trabalho` → vê checklists do dia.
2. `/checklists?tab=pessoal` → empty state.
3. Click "+ Criar lista" → sheet abre.
4. Nome="Mercado teste", tipo=🛒, items=["tomate","ovo","leite"], salvar.
5. Card aparece, marcar tomate, drag reorder, "+ Item" novo.
6. ⋮ menu → Renomear "Mercado semana".
7. `/checklists?tab=delegadas` → ativas/concluídas.
8. Refresh em cada tab → URL state persiste.

- [ ] **Step 2: SQL test**

```sql
-- Como meu user logado:
SELECT name, list_type, (SELECT count(*) FROM personal_checklist_items WHERE list_id = pc.id) AS n
  FROM personal_checklists pc WHERE owner_collab_id = current_collab_id();
```

- [ ] **Step 3: TOM test**

Mensagem para TOM (preview): "criar lista de viagem: passaporte, kindle, carregador". Verificar log da engine + `/checklists?tab=pessoal` mostra a lista nova.

- [ ] **Step 4: Commit + deploy bundle**

Single commit per CLAUDE.md:
```bash
git clone https://github.com/LucianoAlf/LA-Organizer.git /tmp/dep-22-38
# copiar arquivos modificados
git add -A
git commit -m "feat(sprint22.38): tabs Trabalho/Pessoal/Delegadas em /checklists + personal_checklists schema + TOM context"
bash scripts/push-and-deploy.sh /tmp/dep-22-38
rm -rf /tmp/dep-22-38
```
