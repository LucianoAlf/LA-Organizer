# Checklist Pessoal Diário com Histórico — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (inline, batch com checkpoints) para implementar task-a-task. Steps usam checkbox (`- [ ]`).
> **Idioma:** todo código em inglês onde o repo já usa; comentários e UI em PT-BR (padrão do projeto).
> **Sem framework de testes:** este repo não tem vitest/jest. Os "test steps" aqui são os gates de verificação reais do projeto: `npx tsc --noEmit`, `npx vite build`, `node --check`, e validação comportamental no Preview (localhost:4173). Não inventar suíte de testes.

**Goal:** Ligar as listas pessoais **recorrentes** (daily/weekly/monthly) ao modelo de completion diária com histórico que já roda no trabalho — reset automático por dia + histórico dia-a-dia — mantendo `recurrence_type='once'` no comportamento estático atual (`is_done`).

**Architecture:** *Lazy-ensure* sem cron: na primeira interação do dia, get-or-create de `personal_checklist_completions` (UNIQUE checklist_id,user_id,reference_date). O caminho VIVO é `PersonalChecklistCard` ← `fetchPersonalChecklists` (NÃO os hooks `useChecklistsHoje`/`useToggleItem`, que para listas pessoais estão mortos). Para recorrentes, a leitura passa a vir de `personal_checklist_item_completions` (overlay no fetch) e o toggle faz upsert nessa tabela. Histórico = drawer (BottomSheet) por lista, aberto pelo RowMenu. Paridade no engine (TOM/WhatsApp) escreve nas mesmas tabelas via service_role.

**Tech Stack:** React + Vite + TypeScript + Tailwind (PWA), TanStack Query, Supabase JS, design system local (BottomSheet/Button/RowMenu/ChecklistItemRow). Engine Node.js ES modules. Migrations via Supabase MCP.

---

## Convenções confirmadas (NÃO reabrir — já validadas no código + com Alf)

- **`days_of_week` de listas pessoais = convenção do `RecurrenceField.tsx`:** `1=Dom, 2=Seg, 3=Ter, 4=Qua, 5=Qui, 6=Sex, 7=Sáb` → `getUTCDay()+1`. **NÃO** é a convenção ISO do dispatcher (`1=Seg…7=Dom`). Ex.: Treino do Jhonatan `[2,3,4,5,6]` = **Seg–Sex**.
- **"Hoje" = `todaySP()`** de `web/src/utils/date.ts` (America/Sao_Paulo). NUNCA `new Date().toISOString()` cru.
- **`personal_checklist_completions.user_id` = id do colaborador** (`collaborator.id`), não `collaborator_id`. No engine o write é via service_role (bypassa RLS); `user_id` vem sempre de `collab.id` do remetente identificado, nunca de marker do LLM.
- **Caminho vivo:** mobile `ChecklistsMobile.tsx` (PessoalTab) e desktop `HojeTab.tsx` (PessoalView) → ambos renderizam `PersonalChecklistCard` → toggle via `personalChecklists.toggleItem` (a mudar).

---

## File Structure

| Arquivo | Responsabilidade | Ação |
|---|---|---|
| `supabase/migrations/2026053000_personal_completions_realtime.sql` | Add as 2 tabelas de completion à publication `supabase_realtime` | Create |
| `supabase/migrations/2026053001_backfill_jhonatan_today.sql` | Backfill da completion de hoje + seed de `is_checked` a partir de `is_done` | Create |
| `web/src/types.ts` | Add `recurrence_type/days_of_week/day_of_month` + `today_completion_id` a `PersonalChecklist` | Modify |
| `web/src/lib/personalCompletions.ts` | `recurrenceAppliesToday`, `ensurePersonalCompletion`, `togglePersonalCompletionItem`, `fetchPersonalChecklistsHoje`, `fetchPersonalHistory` | Create |
| `web/src/components/PersonalChecklistCard.tsx` | Recorrência-aware: render de `is_checked` do dia, toggle em completions, item "Ver histórico" no RowMenu | Modify |
| `web/src/components/PersonalChecklistHistorySheet.tsx` | Drawer (BottomSheet) com timeline dia-a-dia | Create |
| `web/src/screens/checklists/ChecklistsMobile.tsx` | PessoalTab: usar `fetchPersonalChecklistsHoje` + realtime nas tabelas de completion | Modify |
| `web/src/screens/checklists/HojeTab.tsx` | PessoalView (desktop): idem | Modify |
| `src/services/personalCompletions.js` | `ensurePersonalCompletion` + `recurrenceAppliesToday` (Node, service_role) | Create |
| `src/engine.js` | Branch recorrente em `toggle_item` (linha ~6660) | Modify |

---

### Task 0: Migration — publication realtime das tabelas de completion

**Files:**
- Create: `supabase/migrations/2026053000_personal_completions_realtime.sql`

- [ ] **Step 1: Escrever a migration (idempotente)**

```sql
-- 2026053000_personal_completions_realtime.sql
-- Liga realtime (postgres_changes) nas tabelas de completion de checklist pessoal.
-- Sem isso o PWA não recebe UPDATE quando o TOM marca via WhatsApp (falha em silêncio).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'personal_checklist_completions'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE personal_checklist_completions;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'personal_checklist_item_completions'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE personal_checklist_item_completions;
  END IF;
END $$;

-- REPLICA IDENTITY FULL pra UPDATE/DELETE carregarem os valores (filtros realtime).
ALTER TABLE personal_checklist_completions REPLICA IDENTITY FULL;
ALTER TABLE personal_checklist_item_completions REPLICA IDENTITY FULL;
```

- [ ] **Step 2: Aplicar via MCP** — `apply_migration` no projeto `cesnbnrynvxvgdhfmaua` com o nome `personal_completions_realtime`.

- [ ] **Step 3: Verificar** — rodar via MCP `execute_sql`:

```sql
SELECT tablename FROM pg_publication_tables
WHERE pubname='supabase_realtime' AND tablename LIKE 'personal_checklist%';
```
Esperado: 2 linhas (`personal_checklist_completions`, `personal_checklist_item_completions`).

---

### Task 1: Types — campos de recorrência em PersonalChecklist

**Files:**
- Modify: `web/src/types.ts:432-443`

- [ ] **Step 1: Adicionar campos ao interface**

Em `web/src/types.ts`, substituir o bloco `export interface PersonalChecklist { ... }` por:

```ts
export interface PersonalChecklist {
  id: string
  owner_collab_id: string
  name: string
  list_type: PersonalListType
  context: PersonalListContext
  is_active: boolean
  icon_emoji: string | null
  created_at: string
  updated_at: string
  // Recorrência (migration 20260527010000). 'once' = modelo estático (is_done).
  recurrence_type: 'once' | 'daily' | 'weekly' | 'monthly'
  days_of_week: number[] | null   // convenção RecurrenceField: 1=Dom … 7=Sáb
  day_of_month: number | null
  personal_checklist_items?: PersonalChecklistItem[]
  // Preenchido em runtime pelo fetch de "Hoje" só pra recorrentes (não vem do banco).
  today_completion_id?: string | null
}
```

- [ ] **Step 2: Type-check** — `cd _remote/web && npx tsc --noEmit`. Esperado: PASS (campos novos são compatíveis; `fetchPersonalChecklists` já faz `select('*')`, então as colunas chegam).

---

### Task 2: Lib de completions pessoais (web) — `personalCompletions.ts`

**Files:**
- Create: `web/src/lib/personalCompletions.ts`

- [ ] **Step 1: Criar o arquivo completo**

```ts
// web/src/lib/personalCompletions.ts
// Sprint Checklist-Diário — liga listas pessoais RECORRENTES ao modelo de
// completion por dia (espelha op_checklist_completions do trabalho).
// 'once' continua no modelo estático (is_done) — ver personalChecklists.ts.
import { supabase } from './supabase'
import { todaySP } from '../utils/date'
import type { PersonalChecklist } from '../types'

/** Dia da semana de um YMD na convenção do RecurrenceField: 1=Dom … 7=Sáb. */
export function dowPersonal(ymd: string): number {
  const [y, m, d] = ymd.split('-').map(Number)
  // meio-dia UTC evita drift de fuso; getUTCDay: 0=Dom..6=Sáb → +1 = 1..7
  return new Date(Date.UTC(y, m - 1, d, 12)).getUTCDay() + 1
}

function lastDayOfMonth(ymd: string): number {
  const [y, m] = ymd.split('-').map(Number)
  return new Date(Date.UTC(y, m, 0)).getUTCDate()
}

/** A lista recorrente "vale" para o YMD informado? 'once' nunca usa este caminho. */
export function recurrenceAppliesToday(list: PersonalChecklist, ymd = todaySP()): boolean {
  switch (list.recurrence_type) {
    case 'daily':
      return true
    case 'weekly':
      return (list.days_of_week ?? []).includes(dowPersonal(ymd))
    case 'monthly': {
      const dom = Number(ymd.split('-')[2])
      const target = list.day_of_month ?? 1
      if (dom === target) return true
      // dia 31 em mês de 30/Fev: dispara no último dia do mês.
      return target > lastDayOfMonth(ymd) && dom === lastDayOfMonth(ymd)
    }
    default:
      return false
  }
}

/**
 * get-or-create REAL da completion do dia: SELECT primeiro, INSERT só se faltar.
 * ⚠️ NUNCA chamar no caminho de LEITURA — só no toggle/escrita. Steady-state = 0
 * escrita (sem isto, o realtime do Task 5 entra em loop refetch→escreve→evento→refetch).
 * user_id = collabId.
 */
export async function ensurePersonalCompletion(
  checklistId: string,
  collabId: string,
  ymd = todaySP(),
): Promise<{ id: string }> {
  const { data: existing, error: e1 } = await supabase
    .from('personal_checklist_completions')
    .select('id')
    .eq('checklist_id', checklistId)
    .eq('user_id', collabId)
    .eq('reference_date', ymd)
    .maybeSingle()
  if (e1) throw e1
  if (existing) return existing as { id: string }

  const { data: created, error: e2 } = await supabase
    .from('personal_checklist_completions')
    .insert({ checklist_id: checklistId, user_id: collabId, reference_date: ymd, channel: 'pwa' })
    .select('id')
    .single()
  if (e2) throw e2
  return created as { id: string }
}

/** Marca/desmarca item recorrente no dia (upsert em item_completions). */
export async function togglePersonalCompletionItem(
  completionId: string,
  itemId: string,
  isChecked: boolean,
) {
  const { error } = await supabase
    .from('personal_checklist_item_completions')
    .upsert(
      {
        completion_id: completionId,
        item_id: itemId,
        is_checked: isChecked,
        checked_at: isChecked ? new Date().toISOString() : null,
      },
      { onConflict: 'completion_id,item_id' },
    )
  if (error) throw error
}

/**
 * Busca listas pessoais do dia para o caminho "Hoje". LEITURA PURA — NÃO escreve.
 * - 'once': retorna como está (is_done estático).
 * - recorrente que NÃO vale hoje: filtrada fora.
 * - recorrente que vale hoje: LÊ a completion de hoje se já existir e faz overlay
 *   de is_checked em cada item. Se NÃO existir completion → todos os itens caem em
 *   is_done=false, que é exatamente o reset do dia. (A completion só é criada no
 *   1º toggle, via ensurePersonalCompletion no card/engine — nunca aqui.)
 */
export async function fetchPersonalChecklistsHoje(
  collabId: string,
  context: 'personal' | 'work',
): Promise<PersonalChecklist[]> {
  const ymd = todaySP()
  const { data, error } = await supabase
    .from('personal_checklists')
    .select('*, personal_checklist_items (*)')
    .eq('owner_collab_id', collabId)
    .eq('context', context)
    .eq('is_active', true)
    .order('created_at', { ascending: false })
  if (error) throw error
  const lists = (data ?? []) as PersonalChecklist[]

  const out: PersonalChecklist[] = []
  for (const list of lists) {
    if (list.recurrence_type === 'once') {
      out.push(list)
      continue
    }
    if (!recurrenceAppliesToday(list, ymd)) continue // não aparece hoje

    // LEITURA PURA: lê a completion de hoje SE existir (maybeSingle). Não cria.
    const { data: comp, error: e2 } = await supabase
      .from('personal_checklist_completions')
      .select('id, personal_checklist_item_completions ( item_id, is_checked )')
      .eq('checklist_id', list.id)
      .eq('user_id', collabId)
      .eq('reference_date', ymd)
      .maybeSingle()
    if (e2) throw e2

    const checkedMap = new Map(
      (comp?.personal_checklist_item_completions ?? []).map((c: any) => [c.item_id, !!c.is_checked]),
    )
    out.push({
      ...list,
      today_completion_id: comp?.id ?? null,
      personal_checklist_items: (list.personal_checklist_items ?? []).map((it) => ({
        ...it,
        is_done: checkedMap.get(it.id) ?? false, // sem completion → false (reset do dia)
      })),
    })
  }
  return out
}

export interface PersonalHistoryDay {
  reference_date: string
  total: number
  done: number
  pct: number
  items: Array<{ id: string; description: string; is_checked: boolean }>
}

/** Histórico dia-a-dia de uma lista recorrente (desc por data). */
export async function fetchPersonalHistory(
  checklistId: string,
  collabId: string,
  limit = 30,
): Promise<PersonalHistoryDay[]> {
  const { data: comps, error } = await supabase
    .from('personal_checklist_completions')
    .select(`
      id, reference_date,
      personal_checklist_item_completions ( item_id, is_checked ),
      personal_checklists!inner (
        personal_checklist_items ( id, description, sort_order )
      )
    `)
    .eq('checklist_id', checklistId)
    .eq('user_id', collabId)
    .order('reference_date', { ascending: false })
    .limit(limit)
  if (error) throw error

  return (comps ?? []).map((c: any) => {
    const allItems = (c.personal_checklists?.personal_checklist_items ?? [])
      .slice()
      .sort((a: any, b: any) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
    const checkedMap = new Map(
      (c.personal_checklist_item_completions ?? []).map((x: any) => [x.item_id, !!x.is_checked]),
    )
    const items = allItems.map((it: any) => ({
      id: it.id,
      description: it.description,
      is_checked: checkedMap.get(it.id) ?? false,
    }))
    const total = items.length
    const done = items.filter((i: any) => i.is_checked).length
    return {
      reference_date: c.reference_date,
      total,
      done,
      pct: total ? Math.round((done / total) * 100) : 0,
      items,
    }
  })
}
```

- [ ] **Step 2: Type-check** — `cd _remote/web && npx tsc --noEmit`. Esperado: PASS.

---

### Task 3: PersonalChecklistCard — recorrência-aware (render + toggle + histórico)

**Files:**
- Modify: `web/src/components/PersonalChecklistCard.tsx`

- [ ] **Step 1: Imports** — adicionar no topo (junto aos imports existentes):

```ts
import { useState } from 'react' // (já existe useState; garantir)
import { useAuth } from '../contexts/AuthContext'
import { ensurePersonalCompletion, togglePersonalCompletionItem } from '../lib/personalCompletions'
import { PersonalChecklistHistorySheet } from './PersonalChecklistHistorySheet'
```

- [ ] **Step 2: Trocar a `toggleMutation` — recorrente SEMPRE passa pela completion (sem fallback)**

⚠️ Correção de review (bloqueante): o toggle recorrente NÃO depende de `today_completion_id` vir preenchido. Ele faz `ensurePersonalCompletion` (get-or-create) na hora — assim o 1º toggle do dia cria a completion (1 escrita correta) em vez de cair em `is_done`. `is_done` fica SÓ para `once`.

Substituir:

```ts
  const toggleMutation = useMutation({
    mutationFn: ({ id, isDone }: { id: string; isDone: boolean }) => toggleItem(id, isDone),
    onSuccess: invalidate,
  })
```

por:

```ts
  const { collaborator } = useAuth()
  const collabId = collaborator?.id ?? null
  const isRecurrent = list.recurrence_type && list.recurrence_type !== 'once'

  const toggleMutation = useMutation({
    mutationFn: async ({ id, isDone }: { id: string; isDone: boolean }) => {
      if (isRecurrent) {
        if (!collabId) throw new Error('Sem colaborador no contexto')
        // get-or-create na hora: 1º toggle do dia cria a completion; demais reusam.
        const completion = await ensurePersonalCompletion(list.id, collabId)
        return togglePersonalCompletionItem(completion.id, id, isDone)
      }
      return toggleItem(id, isDone) // 'once': modelo estático (is_done)
    },
    onSuccess: invalidate,
  })
```

- [ ] **Step 3: Estado do drawer de histórico**

Junto aos outros `useState` do componente, adicionar:

```ts
  const [historyOpen, setHistoryOpen] = useState(false)
```

- [ ] **Step 4: Item "Ver histórico" no RowMenu (só recorrentes)**

Substituir o array `cardMenu` por (mantendo Editar/Arquivar/Apagar, inserindo histórico no topo quando recorrente):

```ts
  const cardMenu: MenuItem[] = [
    ...(isRecurrent
      ? [{ label: 'Ver histórico', onClick: () => setHistoryOpen(true) }]
      : []),
    { label: 'Editar', onClick: () => setEditSheetOpen(true) },
    { label: 'Arquivar', onClick: () => setConfirmAction('archive') },
    { label: 'Apagar lista', danger: true, onClick: () => setConfirmAction('delete') },
  ]
```

- [ ] **Step 5: Render do drawer** — antes do `</div>` final (junto aos outros sheets/dialogs):

```tsx
      {isRecurrent && (
        <PersonalChecklistHistorySheet
          open={historyOpen}
          onClose={() => setHistoryOpen(false)}
          list={list}
        />
      )}
```

Nota: o render dos itens (`pct`, `doneCount`, barra, `is_done`) **não muda** — o overlay do Task 2 já fez `is_done = is_checked(hoje)` para recorrentes, então a barra e o toggle ficam corretos sem mexer no JSX dos itens.

- [ ] **Step 6: Type-check** — `cd _remote/web && npx tsc --noEmit`. Esperado: PASS (depende do Task 4 existir; criar Task 4 antes de rodar tsc deste).

---

### Task 4: PersonalChecklistHistorySheet — drawer de timeline

**Files:**
- Create: `web/src/components/PersonalChecklistHistorySheet.tsx`

- [ ] **Step 1: Criar o componente**

```tsx
// web/src/components/PersonalChecklistHistorySheet.tsx
// Drawer (BottomSheet) com o histórico dia-a-dia de uma lista pessoal recorrente.
// Mold: AderenciaTabela (badge de data + barra de progresso) em formato timeline.
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { BottomSheet } from './BottomSheet'
import { useAuth } from '../contexts/AuthContext'
import { fetchPersonalHistory } from '../lib/personalCompletions'
import { brShort, dowShort } from '../utils/date'
import { LoadingState } from './LoadingState'
import { EmptyState } from './EmptyState'
import type { PersonalChecklist } from '../types'

interface Props {
  open: boolean
  onClose: () => void
  list: PersonalChecklist
}

export function PersonalChecklistHistorySheet({ open, onClose, list }: Props) {
  const { collaborator } = useAuth()
  const collabId = collaborator?.id ?? null

  const { data: days = [], isLoading } = useQuery({
    queryKey: ['personal-history', list.id, collabId],
    enabled: open && !!collabId,
    queryFn: () => fetchPersonalHistory(list.id, collabId!, 30),
    staleTime: 30_000,
  })

  return (
    <BottomSheet open={open} onClose={onClose} title={`Histórico — ${list.name}`}>
      {isLoading ? (
        <LoadingState rows={3} />
      ) : days.length === 0 ? (
        <EmptyState
          title="Sem histórico ainda"
          description="Quando você marcar itens dia a dia, o histórico aparece aqui."
        />
      ) : (
        <div className="space-y-2">
          {days.map((d) => (
            <HistoryRow key={d.reference_date} day={d} />
          ))}
        </div>
      )}
    </BottomSheet>
  )
}

function HistoryRow({ day }: { day: ReturnType<typeof Object> extends never ? never : any }) {
  const [expanded, setExpanded] = useState(false)
  return (
    <div className="bg-bg-app rounded-lg border border-border">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center gap-2 p-3 text-left focus-ring rounded-lg"
        aria-expanded={expanded}
      >
        <span className="text-fg-muted flex-shrink-0">
          {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        </span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between mb-1">
            <span className="text-body-sm text-fg font-medium tabular-nums">
              {dowShort(day.reference_date)} {brShort(day.reference_date)}
            </span>
            <span className="text-body-sm text-fg-muted tabular-nums">
              {day.done}/{day.total} ({day.pct}%)
            </span>
          </div>
          <div className="h-2 bg-bg-surface rounded-full overflow-hidden">
            <div className="h-full bg-tom transition-all" style={{ width: `${day.pct}%` }} />
          </div>
        </div>
      </button>
      {expanded && (
        <ul className="px-3 pb-3 pt-1 space-y-1 border-t border-border">
          {day.items.map((it: any) => (
            <li key={it.id} className="flex items-center gap-2 text-body-sm">
              <span className={it.is_checked ? 'text-tom' : 'text-fg-muted'}>
                {it.is_checked ? '✓' : '○'}
              </span>
              <span className={it.is_checked ? 'text-fg' : 'text-fg-muted line-through'}>
                {it.description}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Limpar a assinatura do HistoryRow** — trocar o tipo improvisado do parâmetro por `PersonalHistoryDay`:

No import, adicionar `type PersonalHistoryDay`:
```ts
import { fetchPersonalHistory, type PersonalHistoryDay } from '../lib/personalCompletions'
```
E a assinatura:
```ts
function HistoryRow({ day }: { day: PersonalHistoryDay }) {
```

- [ ] **Step 3: Type-check** — `cd _remote/web && npx tsc --noEmit`. Esperado: PASS.

---

### Task 5: Wire dos consumidores + realtime (mobile e desktop)

**Files:**
- Modify: `web/src/screens/checklists/ChecklistsMobile.tsx` (PessoalTab)
- Modify: `web/src/screens/checklists/HojeTab.tsx` (PessoalView)

- [ ] **Step 1 (mobile): trocar o fetch da PessoalTab**

Em `ChecklistsMobile.tsx`, no `import`, trocar:
```ts
import { fetchPersonalChecklists } from '../../lib/personalChecklists'
```
por:
```ts
import { fetchPersonalChecklists } from '../../lib/personalChecklists'
import { fetchPersonalChecklistsHoje } from '../../lib/personalCompletions'
```
(`fetchPersonalChecklists` continua usado pela aba Trabalho de listas `work`; manter ambos.)

Na `PessoalTab`, trocar o `queryFn`:
```ts
    queryFn: () => fetchPersonalChecklistsHoje(collaborator!.id, 'personal'),
```

- [ ] **Step 2 (mobile): realtime nas tabelas de completion**

Dentro de `PessoalTab`, adicionar (precisa de `useEffect` + `useQueryClient`, já importados no arquivo):

```ts
  const queryClient = useQueryClient()
  useEffect(() => {
    if (!collaborator) return
    const ch = supabase
      .channel('personal-completions-realtime')
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'personal_checklist_item_completions' },
        () => queryClient.invalidateQueries({ queryKey: ['personal-checklists'] }))
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'personal_checklist_completions' },
        () => queryClient.invalidateQueries({ queryKey: ['personal-checklists'] }))
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [collaborator?.id])
```

- [ ] **Step 3 (desktop): mesma troca em HojeTab `PessoalView`**

Em `HojeTab.tsx`, import:
```ts
import { fetchPersonalChecklistsHoje } from '../../lib/personalCompletions';
import { useEffect } from 'react'; // adicionar; usar useQueryClient já importável de @tanstack/react-query
```
Trocar o `queryFn` da `PessoalView`:
```ts
    queryFn: () => fetchPersonalChecklistsHoje(collabId!, 'personal'),
```
E adicionar o mesmo bloco de realtime (canal com nome distinto, ex. `'personal-completions-desktop'`) dentro de `PessoalView`, usando `useQueryClient()`.

> ⚠️ Os dois canais (`personal-completions-realtime` e `personal-completions-desktop`) só co-existem se o usuário tiver as duas telas montadas (não acontece — mobile XOR desktop via breakpoint). Nomes distintos evitam colisão de canal caso HMR remonte.

- [ ] **Step 4: Type-check + build** — `cd _remote/web && npx tsc --noEmit && npx vite build`. Esperado: ambos PASS.

---

### Task 6: Paridade engine (TOM/WhatsApp)

**Files:**
- Create: `src/services/personalCompletions.js`
- Modify: `src/engine.js` (toggle_item, ~6660)

- [ ] **Step 1: Criar o service Node (espelha a lib web)**

```js
// src/services/personalCompletions.js
// Paridade WhatsApp: TOM marcando item de lista pessoal RECORRENTE escreve em
// personal_checklist_item_completions (não is_done). Write via service_role
// (bypassa RLS); user_id vem SEMPRE do collab identificado, nunca do LLM.
const supabase = require('../supabase/client'); // mesmo client service_role do engine.js:15 (NÃO laReportClient — outro projeto)

function todaySP() {
  // YYYY-MM-DD em America/Sao_Paulo (mesma intenção do todaySP do PWA)
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}

function dowPersonal(ymd) {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12)).getUTCDay() + 1; // 1=Dom..7=Sáb
}
function lastDayOfMonth(ymd) {
  const [y, m] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

function recurrenceAppliesToday(list, ymd = todaySP()) {
  switch (list.recurrence_type) {
    case 'daily': return true;
    case 'weekly': return (list.days_of_week || []).includes(dowPersonal(ymd));
    case 'monthly': {
      const dom = Number(ymd.split('-')[2]);
      const target = list.day_of_month || 1;
      if (dom === target) return true;
      return target > lastDayOfMonth(ymd) && dom === lastDayOfMonth(ymd);
    }
    default: return false;
  }
}

async function ensurePersonalCompletion(checklistId, collabId, ymd = todaySP()) {
  // get-or-create REAL (SELECT; INSERT só se faltar). Sem DO UPDATE = sem churn.
  const { data: existing, error: e1 } = await supabase
    .from('personal_checklist_completions')
    .select('id')
    .eq('checklist_id', checklistId)
    .eq('user_id', collabId)
    .eq('reference_date', ymd)
    .maybeSingle();
  if (e1) throw e1;
  if (existing) return existing;

  const { data: created, error: e2 } = await supabase
    .from('personal_checklist_completions')
    .insert({ checklist_id: checklistId, user_id: collabId, reference_date: ymd, channel: 'whatsapp' })
    .select('id')
    .single();
  if (e2) throw e2;
  return created;
}

async function togglePersonalCompletionItem(completionId, itemId, isChecked) {
  const { error } = await supabase
    .from('personal_checklist_item_completions')
    .upsert(
      { completion_id: completionId, item_id: itemId, is_checked: isChecked,
        checked_at: isChecked ? new Date().toISOString() : null },
      { onConflict: 'completion_id,item_id' },
    );
  if (error) throw error;
}

module.exports = { todaySP, recurrenceAppliesToday, ensurePersonalCompletion, togglePersonalCompletionItem };
```

> Confirmado: `engine.js:15` faz `const supabase = require('./supabase/client');` (client service_role). O service em `src/services/` usa `require('../supabase/client')`. NÃO usar `laReportClient` (projeto Supabase diferente).

- [ ] **Step 2: Branch recorrente no `toggle_item` do engine**

Em `src/engine.js`, no handler `else if (a.action === 'toggle_item')` (~6660), após a verificação de ownership e antes do `update is_done`, buscar a lista para saber a recorrência e desviar:

```js
            } else if (a.action === 'toggle_item') {
              if (!a.item_id) { failCount++; continue; }
              // Ownership + dados da lista (recurrence) via FK chain.
              const { data: itemRow } = await supabase
                .from('personal_checklist_items')
                .select('id, list_id, personal_checklists!inner(id, owner_collab_id, recurrence_type, days_of_week, day_of_month)')
                .eq('id', a.item_id).maybeSingle();
              if (!itemRow || !itemRow.personal_checklists || itemRow.personal_checklists.owner_collab_id !== collab.id) {
                failCount++; continue;
              }
              const isDone = a.is_done === undefined ? true : !!a.is_done;
              const list = itemRow.personal_checklists;
              if (list.recurrence_type && list.recurrence_type !== 'once') {
                // Recorrente: escreve na completion do dia, não em is_done.
                const pc = require('./services/personalCompletions');
                const completion = await pc.ensurePersonalCompletion(list.id, collab.id);
                await pc.togglePersonalCompletionItem(completion.id, a.item_id, isDone);
                okCount++;
              } else {
                const { error } = await supabase.from('personal_checklist_items')
                  .update({ is_done: isDone }).eq('id', a.item_id);
                if (error) { failCount++; continue; }
                okCount++;
              }
            } else if (a.action === 'rename') {
```

- [ ] **Step 3: Syntax check** — `node --check src/services/personalCompletions.js && node --check src/engine.js`. Esperado: sem output (OK).

- [ ] **Step 4: Deploy engine** — `scp` dos 2 arquivos + restart:
```bash
scp D:/la-organizer/_remote/src/services/personalCompletions.js tom:/opt/LA-Organizer/src/services/personalCompletions.js
scp D:/la-organizer/_remote/src/engine.js tom:/opt/LA-Organizer/src/engine.js
ssh tom "pm2 restart tom"
```
- [ ] **Step 5: Verificar boot** — `ssh tom "pm2 logs tom --lines 20 --nostream"`. Esperado: sem erro de require/sintaxe no startup.

---

### Task 7: Backfill do dia de hoje (Jhonatan)

**Files:**
- Create: `supabase/migrations/2026053001_backfill_jhonatan_today.sql`

- [ ] **Step 1: Escrever o backfill (idempotente, só recorrentes do dono, só hoje em SP)**

```sql
-- 2026053001_backfill_jhonatan_today.sql
-- Cria a completion de HOJE (America/Sao_Paulo) das listas pessoais recorrentes
-- e semeia is_checked a partir do is_done atual, pra não perder o que já foi
-- marcado no modelo antigo. Idempotente (ON CONFLICT). Escopo: collab do Jhonatan.
-- collab id (= user_id em personal_checklist_completions): 5d74b86b-da6a-4aa1-8783-4b80a2a6d102
WITH today AS (
  SELECT (now() AT TIME ZONE 'America/Sao_Paulo')::date AS d
),
recurrent AS (
  SELECT c.id AS checklist_id
  FROM personal_checklists c
  WHERE c.owner_collab_id = '5d74b86b-da6a-4aa1-8783-4b80a2a6d102'
    AND c.is_active = true
    AND c.recurrence_type IN ('daily','weekly','monthly')
),
ins_comp AS (
  INSERT INTO personal_checklist_completions (checklist_id, user_id, reference_date, channel)
  SELECT r.checklist_id, '5d74b86b-da6a-4aa1-8783-4b80a2a6d102', t.d, 'pwa'
  FROM recurrent r CROSS JOIN today t
  ON CONFLICT (checklist_id, user_id, reference_date) DO UPDATE SET channel = personal_checklist_completions.channel
  RETURNING id, checklist_id
)
INSERT INTO personal_checklist_item_completions (completion_id, item_id, is_checked, checked_at)
SELECT ic.id, i.id, i.is_done, CASE WHEN i.is_done THEN now() ELSE NULL END
FROM ins_comp ic
JOIN personal_checklist_items i ON i.list_id = ic.checklist_id
ON CONFLICT (completion_id, item_id) DO NOTHING;
```

> Nota: `personal_checklist_items` usa `list_id` (confirmado em personalChecklists.ts) como FK para a lista. Confirmar com `execute_sql` o nome da coluna antes de aplicar (se for `checklist_id`, ajustar o JOIN).

- [ ] **Step 2: Pré-check do nome da coluna** (MCP `execute_sql`):
```sql
SELECT column_name FROM information_schema.columns
WHERE table_name='personal_checklist_items' AND column_name IN ('list_id','checklist_id');
```
Ajustar o JOIN do Step 1 conforme o resultado.

- [ ] **Step 3: Aplicar** via MCP `apply_migration` nome `backfill_jhonatan_today`.

- [ ] **Step 4: Verificar** (MCP `execute_sql`):
```sql
SELECT pcc.reference_date, pc.name,
       count(*) FILTER (WHERE pcic.is_checked) AS done, count(*) AS total
FROM personal_checklist_completions pcc
JOIN personal_checklists pc ON pc.id = pcc.checklist_id
JOIN personal_checklist_item_completions pcic ON pcic.completion_id = pcc.id
WHERE pcc.user_id='5d74b86b-da6a-4aa1-8783-4b80a2a6d102'
GROUP BY 1,2 ORDER BY 1 DESC;
```
Esperado: linha(s) de hoje com `done` = nº de itens que estavam `is_done=true` (ex.: Alimentação 1/6 se só "Refeição da manhã" estava marcada).

---

### Task 8: Validação no Preview (simular virada de dia) + checkpoint

**Files:** nenhum (validação comportamental).

Pré-condições: Tasks 0–7 aplicadas; auto-deploy do PWA já publica no push (mas o Preview local em `localhost:4173` reflete o build local — rodar `npx vite build` antes se necessário).

- [ ] **Step 1: Abrir Preview e logar como Jhonatan** — `preview_start` / navegar para `localhost:4173`, ir em Checklists → aba Pessoal. Limpar caches SW (snippet padrão) a cada navegação.

- [ ] **Step 2: Estado inicial do dia** — confirmar que "Alimentação" (daily) aparece com os itens semeados pelo backfill (1/6 se era esse o estado). Tirar `preview_screenshot`.

- [ ] **Step 3: Marcar um item** — `preview_click` num item pendente. Verificar via MCP `execute_sql` que apareceu linha em `personal_checklist_item_completions` da completion de HOJE com `is_checked=true` (não mexeu em `is_done`). Confirmar barra/`%` subiu no card.

- [ ] **Step 4: Simular virada de dia** — via MCP `execute_sql`, NÃO deletar produção; em vez disso validar a lógica de reset criando a leitura de "ontem": inserir manualmente uma completion de ontem com alguns itens marcados:
```sql
-- cria completion de ONTEM pra Alimentação só pra testar o histórico/reset
INSERT INTO personal_checklist_completions (checklist_id, user_id, reference_date, channel)
VALUES ('11ff1cc7-a954-47b1-b40c-a1a3defdb292','5d74b86b-da6a-4aa1-8783-4b80a2a6d102',
        (now() AT TIME ZONE 'America/Sao_Paulo')::date - 1, 'pwa')
ON CONFLICT DO NOTHING;
```
(semear 2 itens de ontem como is_checked via item_completions). Depois recarregar o Preview: o card de HOJE deve mostrar os itens conforme a completion de hoje (reset em relação a ontem — itens de ontem NÃO vazam pra hoje).

- [ ] **Step 5: Histórico** — abrir RowMenu → "Ver histórico". Confirmar timeline com a linha de ontem ("X/6") e de hoje, expandível mostrando ✓/○. `preview_screenshot`.

- [ ] **Step 6: Weekly off-day** — confirmar que "Treino" (`[2,3,4,5,6]` = Seg–Sex) **não aparece** em "Hoje" se hoje for sábado/domingo, e aparece em dia útil. (Se hoje não permitir testar o off-day, validar via `recurrenceAppliesToday` mentalmente + um `execute_sql` de sanity no dow.)

- [ ] **Step 7: Limpeza do dado de teste** — remover as linhas de "ontem" inseridas no Step 4 (são dado de teste, não produção real do Jhonatan):
```sql
DELETE FROM personal_checklist_completions
WHERE checklist_id='11ff1cc7-a954-47b1-b40c-a1a3defdb292'
  AND user_id='5d74b86b-da6a-4aa1-8783-4b80a2a6d102'
  AND reference_date = (now() AT TIME ZONE 'America/Sao_Paulo')::date - 1;
```
> Este DELETE remove só a completion de teste de ONTEM criada no Step 4 (cascata nos item_completions). NÃO toca na completion real de hoje. Mesmo assim, por ser delete em produção, **pedir OK ao Alf antes** (regra do CLAUDE.md).

- [ ] **Step 8: Checkpoint** — reportar ao Alf com screenshots (estado inicial, marcação, histórico) antes de pedir retest ao Jhonatan.

---

### Task 9: Encerramento / deploy final

- [ ] **Step 1: Type-check + build final** — `cd _remote/web && npx tsc --noEmit && npx vite build`. Esperado: PASS.
- [ ] **Step 2: Engine já deployado** no Task 6. Confirmar `pm2 logs tom --lines 20 --nostream` sem erros recentes.
- [ ] **Step 3: PWA** — terminar o turno; o Stop hook commita + push; Vercel deploya `web/` (~2min). NÃO commitar manual.
- [ ] **Step 4: Pedir retest ao Jhonatan** com instruções curtas (marcar item hoje, virar o dia, conferir histórico).

---

## Self-Review (conferido contra a spec)

- **§3.1 reset diário** → Task 2 (`ensurePersonalCompletion` lazy) + Task 5 (overlay no fetch). ✅
- **§3.2 histórico por data** → Tasks 4/5 (item_completions por dia) + Task 7 (backfill). ✅
- **§3.3 tela de histórico** → Tasks 3/4 (drawer). ✅
- **§4.1 lazy-ensure + recurrenceAppliesToday (convenção RecurrenceField)** → Task 2. ✅
- **§4.2 toggle em item_completions** → Task 3 (branch) + Task 6 (engine). ✅
- **§4.3 leitura via completions** → Task 2 overlay (no caminho VIVO PersonalChecklistCard, corrigindo o anchor stale da spec). ✅
- **§4.5 paridade TOM** → Task 6. ✅
- **§4.6 realtime + publication** → Task 0 (publication) + Task 5 (subscriptions). ✅
- **§5 migrations (publication, backfill)** → Tasks 0, 7. RLS já existe (migration 20260527010100). ✅
- **§6 edge cases:** item novo sem row = não marcado (overlay default false) ✅; `is_done` ignorado p/ recorrentes (overlay sobrescreve) ✅; fuso `todaySP()`/SP no SQL ✅.
- **Risco #1 (days_of_week):** `dowPersonal = getUTCDay()+1` em web e engine, idêntico ao RecurrenceField. ✅
- **Risco #2 (realtime silencioso):** publication no Task 0 + REPLICA IDENTITY FULL. ✅
- **Loop de escrita-na-leitura (review do Alf):** leitura é PURA (`fetchPersonalChecklistsHoje` nunca escreve); `ensurePersonalCompletion` é get-or-create real (SELECT→INSERT, sem DO UPDATE) e roda só no toggle. 1º toggle do dia cria a completion (1 escrita→1 refetch, correto); steady-state = 0 escrita → realtime não entra em loop. Mesmo get-or-create no engine (Task 6). ✅
- **Risco #3 (fuso):** `todaySP()` (web) e `now() AT TIME ZONE 'America/Sao_Paulo'` (SQL). ✅
- **Guardrail mobile/desktop:** mesma `PersonalChecklistCard` serve os dois; nenhuma rota nova (drawer via BottomSheet). ✅
- **Out of scope respeitado:** sem streaks, sem cron de lembrete, sem timeline global. ✅

---

## Execução — desvios e achados (2026-05-30)

1. **🔴 Bug crítico achado na validação (RLS/FK identity).** A migration original `20260527010100` criou `personal_checklist_completions.user_id` como `REFERENCES auth.users(id)` + RLS `auth.uid() = user_id`. Mas o módulo pessoal inteiro escreve `user_id = collaborator.id`. Isso só funciona para colaboradores cujo `collaborator.id == auth.users.id` — que são apenas **7 de 24 ativos** (Jhonatan está nesses 7; **17/71% quebrariam**, incluindo o Alf). Sintoma: o 1º toggle de lista recorrente falhava em silêncio (INSERT barrado por FK + RLS).
   **Correção aplicada — migration `personal_completions_collab_identity`:** trocou a FK de `auth.users(id)` para `collaborators(id)` e a RLS de `auth.uid()=user_id` para `user_id = current_collab_id()` (mesmo padrão de `personal_checklists`, que já funciona pra todos). **Zero mudança de código** (PWA/engine/backfill já usavam `collaborator.id`). Re-validado sob a conta do Alf (caso non-coinciding) → grava certo.

2. **Backfill melhorado:** a versão executada filtra por *aplica-hoje* (CASE por `recurrence_type` com `EXTRACT(DOW)+1`), evitando criar completion de lista weekly em dia que não é dela. Resultado real: Jhonatan **Alimentação 1/6** hoje; Treino (Seg–Sex) corretamente sem completion no Sáb.

3. **Sem framework de teste no repo confirmado.** Validação por `tsc`+`vite build`+Preview (drive autenticado como Alf, com lista de teste descartável já removida).

4. **Heads-up:** `src/engine.js` cresceu ~88 linhas entre duas leituras durante a execução (bloco `toggle_item` migrou de ~6660 p/ ~6748) — possível sessão paralela editando o engine. Edit reaplicado limpo; `node --check` OK no VPS.
