# Sprint 22.37 — Aderência Operacional de Checklists Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tela nova `/mais/aderencia-checklists` (com drilldown `/:colabId`) pra liderança operacional (`director` + `manager unit-específica`) ver aderência de checklists operacionais por colaborador, com toggle Hoje/Semana/Mês, filtro por unidade, breakdown por template e observações capturadas.

**Architecture:** PWA-only (zero CRUD novo). RLS expande SELECT pra liderança via 2 helpers SECURITY DEFINER + 3 policies. 2 RPCs SQL fazem agregação server-side respeitando RLS via SECURITY INVOKER. Skill subfluxo 7 do TOM ganha dado real via `buildContext()` pra leadership.

**Tech Stack:** React 18 + Vite + TypeScript, TanStack Query, Supabase RLS + RPC, react-router-dom, lucide-react, Tailwind tokens (`bg-tom`, `text-fg`, etc).

**Spec:** `docs/superpowers/specs/2026-05-08-sprint22-37-aderencia-checklists-design.md`

---

## File Structure

| File | Responsibility | Status |
|---|---|---|
| `migrations/2026-05-08-sprint22-37-adherence-rls.sql` | RLS helpers + policies + 2 RPCs | NEW |
| `web/src/types.ts` | Tipos `AdherenceByCollab`, `AdherenceByTemplate`, `Observation` | modify |
| `web/src/lib/adherence.ts` | Queries (`fetchAdherenceByCollab`, etc) + `getDateRange` | NEW |
| `web/src/hooks/useAdherence.ts` | useQuery wrappers + URL state | NEW |
| `web/src/components/TimeWindowChips.tsx` | Hoje/Semana/Mês toggle | NEW |
| `web/src/components/UnitFilterChips.tsx` | Filtro chips, director-only | NEW |
| `web/src/components/AdherenceCard.tsx` | Card por colab (lista) | NEW |
| `web/src/components/TeamSummaryCard.tsx` | Resumo equipe topo da lista | NEW |
| `web/src/components/CollabHeaderCard.tsx` | Header drilldown | NEW |
| `web/src/components/TemplateBreakdownCard.tsx` | Card por template no drilldown | NEW |
| `web/src/components/ObservationCard.tsx` | Card de nota capturada | NEW |
| `web/src/screens/AderenciaChecklists.tsx` | Lista | NEW |
| `web/src/screens/AderenciaChecklistDetalhe.tsx` | Drilldown | NEW |
| `web/src/screens/Mais.tsx` | Link novo no menu | modify |
| `web/src/App.tsx` | 2 routes novas com `requireRoles` | modify |
| `src/engine.js` | Fetch teamAderencia pra leadership | modify |
| `src/prompts/system.js` | `buildContext()` injeta bloco aderência equipe | modify |

---

## Task Pattern

Esse codebase não tem suite de testes automatizados pro PWA/engine. Cada task usa este pattern de validação:
- TypeScript: `npx --no-install tsc --noEmit` (deve passar zero erros)
- Backend: `node --check <file>` (sintaxe ok)
- Visual/comportamento: `npm run build` + Simple Browser preview validation com `mcp__Claude_Preview__preview_eval` + `preview_screenshot`

Commits são feitos no final do plan (1 bundle por sprint, conforme CLAUDE.md). Tasks individuais não commitam.

---

## Task 1: Migration RLS + RPCs

**Files:**
- Create: `migrations/2026-05-08-sprint22-37-adherence-rls.sql`

- [ ] **Step 1: Write the migration file**

```sql
-- Sprint 22.37 — Aderência Operacional de Checklists
-- Habilita liderança operacional (director + manager unit-específica) a ler
-- completions de toda equipe (manager filtrado por sua unidade).
-- Adiciona 2 RPCs de agregação para evitar N+1 queries no PWA.

-- 1. Helpers SECURITY DEFINER (lendo collaborators sem trigger RLS recursão)
CREATE OR REPLACE FUNCTION current_collab_unit()
  RETURNS text LANGUAGE sql SECURITY DEFINER STABLE AS $$
    SELECT unit FROM collaborators WHERE id = current_collab_id();
  $$;

CREATE OR REPLACE FUNCTION current_collab_role()
  RETURNS text LANGUAGE sql SECURITY DEFINER STABLE AS $$
    SELECT role FROM collaborators WHERE id = current_collab_id();
  $$;

-- 2. Policies SELECT pra liderança operacional
DROP POLICY IF EXISTS leadership_read_completions ON op_checklist_completions;
CREATE POLICY leadership_read_completions
  ON op_checklist_completions FOR SELECT
  USING (
    current_collab_role() = 'director'
    OR (
      current_collab_role() = 'manager'
      AND current_collab_unit() != 'all'
      AND EXISTS (
        SELECT 1 FROM collaborators c
        WHERE c.id = op_checklist_completions.collaborator_id
          AND c.unit = current_collab_unit()
      )
    )
  );

DROP POLICY IF EXISTS leadership_read_item_completions ON op_checklist_item_completions;
CREATE POLICY leadership_read_item_completions
  ON op_checklist_item_completions FOR SELECT
  USING (
    current_collab_role() = 'director'
    OR (
      current_collab_role() = 'manager'
      AND current_collab_unit() != 'all'
      AND EXISTS (
        SELECT 1 FROM op_checklist_completions c
        JOIN collaborators k ON k.id = c.collaborator_id
        WHERE c.id = op_checklist_item_completions.completion_id
          AND k.unit = current_collab_unit()
      )
    )
  );

DROP POLICY IF EXISTS leadership_read_templates ON op_checklists;
CREATE POLICY leadership_read_templates
  ON op_checklists FOR SELECT
  USING (
    current_collab_role() IN ('director', 'manager')
  );

-- 3. RPC: aderência por colaborador (já filtra unit via RLS)
CREATE OR REPLACE FUNCTION get_adherence_by_collab(
  start_date date,
  end_date date,
  unit_filter text DEFAULT NULL
)
RETURNS TABLE (
  collab_id uuid,
  full_name text,
  role text,
  unit text,
  function_role text,
  dispatched int,
  completed int,
  late_items int,
  escalated_count int,
  pct numeric
) LANGUAGE sql SECURITY INVOKER STABLE AS $$
  SELECT
    k.id,
    k.full_name,
    k.role,
    k.unit,
    k.function_role,
    count(c.id)::int as dispatched,
    count(c.completed_at)::int as completed,
    coalesce((
      SELECT count(*) FROM op_checklist_item_completions ic
      JOIN op_checklist_completions cc ON cc.id = ic.completion_id
      WHERE cc.collaborator_id = k.id
        AND cc.reference_date BETWEEN start_date AND end_date
        AND ic.late = true
    ), 0)::int as late_items,
    count(c.escalated_at)::int as escalated_count,
    CASE WHEN count(c.id) = 0 THEN 0
         ELSE round(count(c.completed_at)::numeric / count(c.id) * 100, 0)
    END as pct
  FROM collaborators k
  LEFT JOIN op_checklist_completions c
    ON c.collaborator_id = k.id
    AND c.reference_date BETWEEN start_date AND end_date
  WHERE k.is_active = true
    AND (unit_filter IS NULL OR k.unit = unit_filter)
  GROUP BY k.id, k.full_name, k.role, k.unit, k.function_role
  HAVING count(c.id) > 0
  ORDER BY pct ASC, k.full_name ASC;
$$;

-- 4. RPC: aderência por template pra um colab específico
CREATE OR REPLACE FUNCTION get_adherence_by_template(
  collab_id uuid,
  start_date date,
  end_date date
)
RETURNS TABLE (
  template_id uuid,
  template_name text,
  template_unit text,
  dispatched int,
  completed int,
  late_items int,
  escalated_count int,
  pct numeric
) LANGUAGE sql SECURITY INVOKER STABLE AS $$
  SELECT
    t.id,
    t.name,
    t.unit,
    count(c.id)::int,
    count(c.completed_at)::int,
    coalesce((
      SELECT count(*) FROM op_checklist_item_completions ic
      WHERE ic.completion_id IN (
        SELECT id FROM op_checklist_completions
        WHERE collaborator_id = $1
          AND reference_date BETWEEN $2 AND $3
          AND checklist_id = t.id
      )
        AND ic.late = true
    ), 0)::int,
    count(c.escalated_at)::int,
    CASE WHEN count(c.id) = 0 THEN 0
         ELSE round(count(c.completed_at)::numeric / count(c.id) * 100, 0)
    END
  FROM op_checklists t
  LEFT JOIN op_checklist_completions c
    ON c.checklist_id = t.id
    AND c.collaborator_id = $1
    AND c.reference_date BETWEEN $2 AND $3
  GROUP BY t.id, t.name, t.unit
  HAVING count(c.id) > 0
  ORDER BY pct ASC;
$$;
```

- [ ] **Step 2: Apply migration via Supabase MCP**

Use `mcp__4c04bb52-f946-4fe8-85f6-b01d200f8c20__apply_migration` with name `sprint22_37_aderencia_checklists` and the SQL above.

Expected: `{"success":true}`

- [ ] **Step 3: Verify policies and RPCs exist**

Use `mcp__4c04bb52-f946-4fe8-85f6-b01d200f8c20__execute_sql`:

```sql
SELECT policyname FROM pg_policies WHERE tablename IN ('op_checklist_completions', 'op_checklist_item_completions', 'op_checklists') AND policyname LIKE 'leadership%';
SELECT proname FROM pg_proc WHERE proname IN ('current_collab_unit', 'current_collab_role', 'get_adherence_by_collab', 'get_adherence_by_template');
```

Expected: 3 policies + 4 functions retornados.

- [ ] **Step 4: Verify RPC works (zero data ok, validamos schema)**

```sql
SELECT * FROM get_adherence_by_collab(CURRENT_DATE - 7, CURRENT_DATE);
```

Expected: zero rows ou rows reais (depende do banco). Sem erro de tipo.

---

## Task 2: TypeScript types

**Files:**
- Modify: `web/src/types.ts`

- [ ] **Step 1: Adicionar types após `OpChecklistCompletionExtraItem`**

```typescript
/** Sprint 22.37 — agregado de aderência por colab. Vem do RPC get_adherence_by_collab. */
export interface AdherenceByCollab {
  collab_id: string
  full_name: string
  role: string
  unit: string | null
  function_role: string | null
  dispatched: number
  completed: number
  late_items: number
  escalated_count: number
  pct: number
}

/** Sprint 22.37 — agregado de aderência por template (drilldown). */
export interface AdherenceByTemplate {
  template_id: string
  template_name: string
  template_unit: string | null
  dispatched: number
  completed: number
  late_items: number
  escalated_count: number
  pct: number
}

/** Sprint 22.37 — observação capturada num item (drilldown). */
export interface AdherenceObservation {
  notes: string
  reference_date: string
  template_name: string
  item_description?: string | null
}

/** Sprint 22.37 — janela temporal selecionável na tela de aderência. */
export type AdherenceWindow = 'today' | 'week' | 'month'
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd web && npx --no-install tsc --noEmit`
Expected: sem erros.

---

## Task 3: Adherence library (queries + date helpers)

**Files:**
- Create: `web/src/lib/adherence.ts`

- [ ] **Step 1: Criar arquivo**

```typescript
// web/src/lib/adherence.ts
// Sprint 22.37 — queries + helpers pra tela /mais/aderencia-checklists.
// Usa RPCs server-side (get_adherence_by_collab, get_adherence_by_template)
// pra agregar com 1 round-trip respeitando RLS.

import { supabase } from './supabase'
import { todaySP, ymdAddDays } from '../utils/date'
import type {
  AdherenceByCollab,
  AdherenceByTemplate,
  AdherenceObservation,
  AdherenceWindow,
} from '../types'

/** Resolve uma janela em [start, end] no formato YYYY-MM-DD (BRT). */
export function getDateRange(window: AdherenceWindow): { start: string; end: string } {
  const today = todaySP()
  if (window === 'today') {
    return { start: today, end: today }
  }
  if (window === 'week') {
    // Segunda → hoje
    const d = new Date(today + 'T15:00:00.000Z') // meio-dia BRT
    const dow = d.getUTCDay() // 0=dom, 1=seg, ..., 6=sáb
    const diffToMonday = dow === 0 ? -6 : 1 - dow
    const monday = ymdAddDays(today, diffToMonday)
    return { start: monday, end: today }
  }
  // month
  const [y, m] = today.split('-')
  const startOfMonth = `${y}-${m}-01`
  return { start: startOfMonth, end: today }
}

export async function fetchAdherenceByCollab(
  start: string,
  end: string,
  unit: string | null,
): Promise<AdherenceByCollab[]> {
  const { data, error } = await supabase.rpc('get_adherence_by_collab', {
    start_date: start,
    end_date: end,
    unit_filter: unit,
  })
  if (error) throw error
  return (data ?? []) as AdherenceByCollab[]
}

export async function fetchAdherenceByTemplate(
  collabId: string,
  start: string,
  end: string,
): Promise<AdherenceByTemplate[]> {
  const { data, error } = await supabase.rpc('get_adherence_by_template', {
    collab_id: collabId,
    start_date: start,
    end_date: end,
  })
  if (error) throw error
  return (data ?? []) as AdherenceByTemplate[]
}

export async function fetchAdherenceObservations(
  collabId: string,
  start: string,
  end: string,
  limit = 20,
): Promise<AdherenceObservation[]> {
  // Items do template
  const { data: tplData, error: tplErr } = await supabase
    .from('op_checklist_item_completions')
    .select(`
      notes,
      op_checklist_items(description),
      op_checklist_completions!inner(reference_date, op_checklists(name))
    `)
    .eq('op_checklist_completions.collaborator_id', collabId)
    .gte('op_checklist_completions.reference_date', start)
    .lte('op_checklist_completions.reference_date', end)
    .not('notes', 'is', null)
    .limit(limit)
  if (tplErr) throw tplErr

  // Items ad-hoc
  const { data: extraData, error: extraErr } = await supabase
    .from('op_checklist_completion_extra_items')
    .select(`
      notes, description,
      op_checklist_completions!inner(reference_date, op_checklists(name))
    `)
    .eq('op_checklist_completions.collaborator_id', collabId)
    .gte('op_checklist_completions.reference_date', start)
    .lte('op_checklist_completions.reference_date', end)
    .not('notes', 'is', null)
    .limit(limit)
  if (extraErr) throw extraErr

  type RawCompletion = { reference_date: string; op_checklists: { name: string } | { name: string }[] | null }
  function unwrapCompletion(c: RawCompletion | RawCompletion[] | null): { reference_date: string; tplName: string } {
    const obj = Array.isArray(c) ? c[0] : c
    if (!obj) return { reference_date: '', tplName: '' }
    const tpl = Array.isArray(obj.op_checklists) ? obj.op_checklists[0] : obj.op_checklists
    return { reference_date: obj.reference_date, tplName: tpl?.name ?? '' }
  }
  function unwrapItem(i: { description: string } | { description: string }[] | null | undefined): string | null {
    if (!i) return null
    const obj = Array.isArray(i) ? i[0] : i
    return obj?.description ?? null
  }

  const tplMapped: AdherenceObservation[] = (tplData ?? []).map((row) => {
    const c = unwrapCompletion(row.op_checklist_completions as RawCompletion)
    return {
      notes: row.notes as string,
      reference_date: c.reference_date,
      template_name: c.tplName,
      item_description: unwrapItem(row.op_checklist_items as { description: string } | null),
    }
  })

  const extraMapped: AdherenceObservation[] = (extraData ?? []).map((row) => {
    const c = unwrapCompletion(row.op_checklist_completions as RawCompletion)
    return {
      notes: row.notes as string,
      reference_date: c.reference_date,
      template_name: c.tplName,
      item_description: row.description as string,
    }
  })

  return [...tplMapped, ...extraMapped]
    .sort((a, b) => b.reference_date.localeCompare(a.reference_date))
    .slice(0, limit)
}

/** Tone helper baseado em PRD §4. */
export function adherenceTone(pct: number): 'success' | 'warning' | 'danger' {
  if (pct >= 90) return 'success'
  if (pct >= 70) return 'warning'
  return 'danger'
}

/** Cor do border-left do card. */
export function adherenceBorder(pct: number): string {
  const tone = adherenceTone(pct)
  if (tone === 'success') return 'border-success'
  if (tone === 'warning') return 'border-warning'
  return 'border-danger'
}

/** Emoji semáforo. */
export function adherenceEmoji(pct: number): string {
  const tone = adherenceTone(pct)
  if (tone === 'success') return '🟢'
  if (tone === 'warning') return '🟡'
  return '🔴'
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd web && npx --no-install tsc --noEmit`
Expected: sem erros.

---

## Task 4: useAdherence hook + URL state

**Files:**
- Create: `web/src/hooks/useAdherence.ts`

- [ ] **Step 1: Criar hook**

```typescript
// web/src/hooks/useAdherence.ts
// Sprint 22.37 — wrappers TanStack Query pras tela de aderência.
// Estado da janela e do filtro de unidade vivem em URLSearchParams pra
// preservar quando user faz drilldown e volta.

import { useQuery } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import {
  fetchAdherenceByCollab,
  fetchAdherenceByTemplate,
  fetchAdherenceObservations,
  getDateRange,
} from '../lib/adherence'
import type { AdherenceWindow } from '../types'

const VALID_WINDOWS: readonly AdherenceWindow[] = ['today', 'week', 'month']

export function useAdherenceWindow() {
  const [params, setParams] = useSearchParams()
  const raw = params.get('window') ?? 'week'
  const window = (VALID_WINDOWS.includes(raw as AdherenceWindow) ? raw : 'week') as AdherenceWindow
  function setWindow(next: AdherenceWindow) {
    const p = new URLSearchParams(params)
    p.set('window', next)
    setParams(p, { replace: true })
  }
  return [window, setWindow] as const
}

export function useUnitFilter() {
  const [params, setParams] = useSearchParams()
  const unit = params.get('unit') // null = "Todas"
  function setUnit(next: string | null) {
    const p = new URLSearchParams(params)
    if (next === null) p.delete('unit')
    else p.set('unit', next)
    setParams(p, { replace: true })
  }
  return [unit, setUnit] as const
}

export function useAdherenceByCollab(window: AdherenceWindow, unit: string | null) {
  const { collaborator } = useAuth()
  const { start, end } = getDateRange(window)
  const isLeadership =
    collaborator?.role === 'director' ||
    (collaborator?.role === 'manager' && collaborator?.unit !== 'all')
  return useQuery({
    queryKey: ['adherence-by-collab', start, end, unit],
    queryFn: () => fetchAdherenceByCollab(start, end, unit),
    enabled: !!collaborator && isLeadership,
    staleTime: 60_000,
  })
}

export function useAdherenceByTemplate(
  collabId: string | undefined,
  window: AdherenceWindow,
) {
  const { start, end } = getDateRange(window)
  return useQuery({
    queryKey: ['adherence-by-template', collabId, start, end],
    queryFn: () => fetchAdherenceByTemplate(collabId!, start, end),
    enabled: !!collabId,
    staleTime: 60_000,
  })
}

export function useAdherenceObservations(
  collabId: string | undefined,
  window: AdherenceWindow,
) {
  const { start, end } = getDateRange(window)
  return useQuery({
    queryKey: ['adherence-observations', collabId, start, end],
    queryFn: () => fetchAdherenceObservations(collabId!, start, end),
    enabled: !!collabId,
    staleTime: 60_000,
  })
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd web && npx --no-install tsc --noEmit`
Expected: sem erros.

---

## Task 5: TimeWindowChips component

**Files:**
- Create: `web/src/components/TimeWindowChips.tsx`

- [ ] **Step 1: Criar componente**

```typescript
// web/src/components/TimeWindowChips.tsx
// Sprint 22.37 — toggle Hoje/Semana/Mês. Valor e onChange controlados
// externos (vem do useAdherenceWindow).
import type { AdherenceWindow } from '../types'

interface Props {
  value: AdherenceWindow
  onChange: (next: AdherenceWindow) => void
}

const OPTIONS: { value: AdherenceWindow; label: string }[] = [
  { value: 'today', label: 'Hoje' },
  { value: 'week', label: 'Semana' },
  { value: 'month', label: 'Mês' },
]

export function TimeWindowChips({ value, onChange }: Props) {
  return (
    <div className="inline-flex gap-1 p-1 rounded-lg bg-bg-elevated">
      {OPTIONS.map((opt) => {
        const active = opt.value === value
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            className={[
              'px-3 py-1.5 rounded-md text-body-sm font-medium transition-colors focus-ring',
              active
                ? 'bg-tom text-white shadow-sm'
                : 'text-fg-muted hover:text-fg hover:bg-bg-app',
            ].join(' ')}
            aria-pressed={active}
          >
            {opt.label}
          </button>
        )
      })}
    </div>
  )
}
```

- [ ] **Step 2: Verify**

Run: `cd web && npx --no-install tsc --noEmit`
Expected: sem erros.

---

## Task 6: UnitFilterChips component

**Files:**
- Create: `web/src/components/UnitFilterChips.tsx`

- [ ] **Step 1: Criar componente**

```typescript
// web/src/components/UnitFilterChips.tsx
// Sprint 22.37 — chips de filtro por unidade. Visível só pra director.
// Manager unit-específica não vê (já filtra automaticamente via RLS).

interface Props {
  value: string | null // null = todas
  onChange: (next: string | null) => void
}

const UNITS: { value: string | null; label: string }[] = [
  { value: null, label: 'Todas' },
  { value: 'barra', label: 'Barra' },
  { value: 'recreio', label: 'Recreio' },
  { value: 'campo_grande', label: 'Campo Grande' },
]

export function UnitFilterChips({ value, onChange }: Props) {
  return (
    <div className="flex flex-wrap gap-2">
      {UNITS.map((opt) => {
        const active = opt.value === value
        return (
          <button
            key={opt.label}
            type="button"
            onClick={() => onChange(opt.value)}
            className={[
              'px-3 py-1.5 rounded-full text-body-sm font-medium transition-colors focus-ring',
              active
                ? 'bg-tom text-white'
                : 'bg-bg-elevated text-fg-muted hover:text-fg hover:bg-bg-app border border-border',
            ].join(' ')}
            aria-pressed={active}
          >
            {opt.label}
          </button>
        )
      })}
    </div>
  )
}
```

- [ ] **Step 2: Verify**

Run: `cd web && npx --no-install tsc --noEmit`
Expected: sem erros.

---

## Task 7: AdherenceCard component

**Files:**
- Create: `web/src/components/AdherenceCard.tsx`

- [ ] **Step 1: Criar componente**

```typescript
// web/src/components/AdherenceCard.tsx
// Sprint 22.37 — card de aderência por colab. Border-left 🟢🟡🔴, barra bg-tom.
// Click navega pro drilldown.
import { Link } from 'react-router-dom'
import { adherenceBorder, adherenceTone } from '../lib/adherence'
import type { AdherenceByCollab } from '../types'

interface Props {
  data: AdherenceByCollab
}

const ROLE_LABEL: Record<string, string> = {
  director: 'direção',
  manager: 'gerente',
  coordinator: 'coordenador',
  collaborator: 'colaborador',
}

const UNIT_LABEL: Record<string, string> = {
  barra: 'Barra',
  recreio: 'Recreio',
  campo_grande: 'Campo Grande',
  all: 'Todas',
}

function initials(fullName: string) {
  const parts = fullName.trim().split(/\s+/)
  const first = parts[0]?.[0] ?? '?'
  const last = parts[parts.length - 1]?.[0] ?? ''
  return (first + (parts.length > 1 ? last : '')).toUpperCase()
}

export function AdherenceCard({ data }: Props) {
  const tone = adherenceTone(data.pct)
  const borderCls = adherenceBorder(data.pct)
  const pctTextCls =
    tone === 'success' ? 'text-success' : tone === 'warning' ? 'text-warning' : 'text-danger'

  const subline = [
    UNIT_LABEL[data.unit ?? ''] ?? data.unit,
    ROLE_LABEL[data.role] ?? data.role,
  ].filter(Boolean).join(' · ')

  const annotations: string[] = []
  if (data.late_items > 0) annotations.push(`${data.late_items} com atraso`)
  if (data.escalated_count > 0) annotations.push(`${data.escalated_count} escaladas`)

  return (
    <Link
      to={`/mais/aderencia-checklists/${data.collab_id}`}
      className={[
        'block bg-bg-surface rounded-xl shadow-sm border border-border border-l-4 p-4',
        'hover:bg-bg-elevated transition-colors focus-ring',
        borderCls,
      ].join(' ')}
    >
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-full bg-tom text-white flex items-center justify-center font-semibold text-body-sm flex-shrink-0">
          {initials(data.full_name)}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-section-title text-fg truncate">{data.full_name}</div>
          {subline && <div className="text-caption text-fg-muted truncate">{subline}</div>}
        </div>
        <div className={['text-heading-sm font-bold tabular-nums', pctTextCls].join(' ')}>
          {data.pct}%
        </div>
      </div>

      <div className="mt-2 h-1.5 w-full bg-bg-elevated rounded-full overflow-hidden">
        <div
          className="h-full bg-tom transition-[width]"
          style={{ width: `${data.pct}%` }}
          role="progressbar"
          aria-valuenow={data.pct}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`Aderência ${data.pct}%`}
        />
      </div>

      <div className="mt-1 text-body-sm text-fg-muted tabular-nums">
        {data.completed}/{data.dispatched} fechados
        {annotations.length > 0 && (
          <span className="text-fg-muted"> · {annotations.join(' · ')}</span>
        )}
      </div>
    </Link>
  )
}
```

- [ ] **Step 2: Verify**

Run: `cd web && npx --no-install tsc --noEmit`
Expected: sem erros.

---

## Task 8: TeamSummaryCard component

**Files:**
- Create: `web/src/components/TeamSummaryCard.tsx`

- [ ] **Step 1: Criar componente**

```typescript
// web/src/components/TeamSummaryCard.tsx
// Sprint 22.37 — resumo agregado da equipe filtrada. Mostra geral + count <70.
import type { AdherenceByCollab } from '../types'

interface Props {
  rows: AdherenceByCollab[]
}

export function TeamSummaryCard({ rows }: Props) {
  if (rows.length === 0) return null

  const totalDispatched = rows.reduce((acc, r) => acc + r.dispatched, 0)
  const totalCompleted = rows.reduce((acc, r) => acc + r.completed, 0)
  const overall = totalDispatched > 0
    ? Math.round((totalCompleted / totalDispatched) * 100)
    : 0
  const belowThreshold = rows.filter((r) => r.pct < 70).length

  const overallTextCls =
    overall >= 90 ? 'text-success' : overall >= 70 ? 'text-warning' : 'text-danger'

  return (
    <div className="bg-bg-surface rounded-xl border border-border p-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <div className="text-caption text-fg-muted uppercase tracking-wide">Equipe</div>
          <div className={['text-heading-sm font-bold tabular-nums', overallTextCls].join(' ')}>
            {overall}%
          </div>
        </div>
        <div className="text-right">
          <div className="text-caption text-fg-muted uppercase tracking-wide">Abaixo de 70%</div>
          <div className={['text-heading-sm font-bold tabular-nums', belowThreshold > 0 ? 'text-danger' : 'text-fg'].join(' ')}>
            {belowThreshold}
          </div>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Verify**

Run: `cd web && npx --no-install tsc --noEmit`
Expected: sem erros.

---

## Task 9: AderenciaChecklists screen (lista)

**Files:**
- Create: `web/src/screens/AderenciaChecklists.tsx`

- [ ] **Step 1: Criar screen**

```typescript
// web/src/screens/AderenciaChecklists.tsx
// Sprint 22.37 — Tela /mais/aderencia-checklists.
// Acesso: director (vê todas unidades) + manager unit-específica (vê só sua).
// Manager unit='all' (Yuri) vê empty state explicativo.
import { ClipboardCheck } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { LoadingState } from '../components/LoadingState'
import { EmptyState } from '../components/EmptyState'
import { ErrorState } from '../components/ErrorState'
import { TimeWindowChips } from '../components/TimeWindowChips'
import { UnitFilterChips } from '../components/UnitFilterChips'
import { TeamSummaryCard } from '../components/TeamSummaryCard'
import { AdherenceCard } from '../components/AdherenceCard'
import {
  useAdherenceWindow,
  useUnitFilter,
  useAdherenceByCollab,
} from '../hooks/useAdherence'

export function AderenciaChecklists() {
  const { collaborator } = useAuth()
  const [window, setWindow] = useAdherenceWindow()
  const [unit, setUnit] = useUnitFilter()

  const isDirector = collaborator?.role === 'director'
  const isUnitManager =
    collaborator?.role === 'manager' && collaborator?.unit !== 'all'

  // Yuri (manager unit='all', Marketing) — empty state explicativo.
  if (collaborator?.role === 'manager' && collaborator?.unit === 'all') {
    return (
      <EmptyState
        icon={<ClipboardCheck size={32} />}
        title="Sem unidade operacional"
        description="Você não tem uma unidade operacional atribuída. Fale com a direção se isso não tá certo."
      />
    )
  }

  if (!isDirector && !isUnitManager) {
    return (
      <EmptyState
        icon={<ClipboardCheck size={32} />}
        title="Acesso restrito"
        description="Esta tela é só pra liderança operacional (direção e gerência de unidade)."
      />
    )
  }

  const effectiveUnit = isDirector ? unit : (collaborator?.unit ?? null)
  const { data: rows = [], isLoading, error, refetch } = useAdherenceByCollab(window, effectiveUnit)

  return (
    <div className="space-y-md">
      <h2 className="text-section-title">Aderência operacional</h2>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <TimeWindowChips value={window} onChange={setWindow} />
        {isDirector && <UnitFilterChips value={unit} onChange={setUnit} />}
      </div>

      {isLoading && <LoadingState rows={3} />}

      {error && (
        <ErrorState
          title="Não consegui carregar a aderência"
          description="Pode ser conexão ou um problema no servidor."
          onRetry={() => refetch()}
        />
      )}

      {!isLoading && !error && rows.length === 0 && (
        <EmptyState
          icon={<ClipboardCheck size={32} />}
          title="Sem checklists despachados"
          description="Não tem checklist no período selecionado pra esses colaboradores."
        />
      )}

      {!isLoading && !error && rows.length > 0 && (
        <>
          <TeamSummaryCard rows={rows} />
          <div className="space-y-sm">
            {rows.map((row) => (
              <AdherenceCard key={row.collab_id} data={row} />
            ))}
          </div>
        </>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Verify**

Run: `cd web && npx --no-install tsc --noEmit`
Expected: sem erros.

---

## Task 10: CollabHeaderCard component

**Files:**
- Create: `web/src/components/CollabHeaderCard.tsx`

- [ ] **Step 1: Criar componente**

```typescript
// web/src/components/CollabHeaderCard.tsx
// Sprint 22.37 — header do drilldown. Avatar grande + nome + role/unidade + % geral.
import { adherenceTone } from '../lib/adherence'
import type { AdherenceByCollab } from '../types'

interface Props {
  data: AdherenceByCollab
  windowLabel: string
}

const ROLE_LABEL: Record<string, string> = {
  director: 'direção',
  manager: 'gerente',
  coordinator: 'coordenador',
  collaborator: 'colaborador',
}

const UNIT_LABEL: Record<string, string> = {
  barra: 'Barra',
  recreio: 'Recreio',
  campo_grande: 'Campo Grande',
  all: 'Todas',
}

function initials(fullName: string) {
  const parts = fullName.trim().split(/\s+/)
  const first = parts[0]?.[0] ?? '?'
  const last = parts[parts.length - 1]?.[0] ?? ''
  return (first + (parts.length > 1 ? last : '')).toUpperCase()
}

export function CollabHeaderCard({ data, windowLabel }: Props) {
  const tone = adherenceTone(data.pct)
  const pctCls =
    tone === 'success' ? 'text-success' : tone === 'warning' ? 'text-warning' : 'text-danger'
  const subline = [
    UNIT_LABEL[data.unit ?? ''] ?? data.unit,
    ROLE_LABEL[data.role] ?? data.role,
  ].filter(Boolean).join(' · ')

  return (
    <div className="bg-bg-surface rounded-xl border border-border p-4">
      <div className="flex items-center gap-3">
        <div className="w-12 h-12 rounded-full bg-tom text-white flex items-center justify-center font-semibold flex-shrink-0">
          {initials(data.full_name)}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-section-title text-fg">{data.full_name}</div>
          {subline && <div className="text-body-sm text-fg-muted">{subline}</div>}
        </div>
        <div className="text-right">
          <div className={['text-heading-sm font-bold tabular-nums', pctCls].join(' ')}>{data.pct}%</div>
          <div className="text-caption text-fg-muted">{windowLabel}</div>
        </div>
      </div>

      <div className="mt-2 h-1.5 w-full bg-bg-elevated rounded-full overflow-hidden">
        <div
          className="h-full bg-tom transition-[width]"
          style={{ width: `${data.pct}%` }}
        />
      </div>
      <div className="mt-1 text-body-sm text-fg-muted tabular-nums">
        {data.completed}/{data.dispatched} fechados
        {data.late_items > 0 && <span> · {data.late_items} com atraso</span>}
        {data.escalated_count > 0 && <span> · {data.escalated_count} escaladas</span>}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Verify**

Run: `cd web && npx --no-install tsc --noEmit`
Expected: sem erros.

---

## Task 11: TemplateBreakdownCard component

**Files:**
- Create: `web/src/components/TemplateBreakdownCard.tsx`

- [ ] **Step 1: Criar componente**

```typescript
// web/src/components/TemplateBreakdownCard.tsx
// Sprint 22.37 — card por template no drilldown. Mostra %, contador e atraso/escalação.
import { adherenceBorder, adherenceTone } from '../lib/adherence'
import type { AdherenceByTemplate } from '../types'

interface Props {
  data: AdherenceByTemplate
}

export function TemplateBreakdownCard({ data }: Props) {
  const tone = adherenceTone(data.pct)
  const borderCls = adherenceBorder(data.pct)
  const pctCls =
    tone === 'success' ? 'text-success' : tone === 'warning' ? 'text-warning' : 'text-danger'

  const annotations: string[] = []
  if (data.late_items > 0) annotations.push(`${data.late_items} com atraso`)
  if (data.escalated_count > 0) annotations.push(`${data.escalated_count} escaladas`)

  return (
    <div
      className={[
        'bg-bg-surface rounded-xl border border-border border-l-4 p-3',
        borderCls,
      ].join(' ')}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="text-fg font-medium truncate">{data.template_name}</div>
        <div className={['text-body-md font-bold tabular-nums', pctCls].join(' ')}>{data.pct}%</div>
      </div>

      <div className="mt-2 h-1 w-full bg-bg-elevated rounded-full overflow-hidden">
        <div className="h-full bg-tom" style={{ width: `${data.pct}%` }} />
      </div>

      <div className="mt-1 text-caption text-fg-muted tabular-nums">
        {data.completed}/{data.dispatched} fechados
        {annotations.length > 0 && <span> · {annotations.join(' · ')}</span>}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Verify**

Run: `cd web && npx --no-install tsc --noEmit`
Expected: sem erros.

---

## Task 12: ObservationCard component

**Files:**
- Create: `web/src/components/ObservationCard.tsx`

- [ ] **Step 1: Criar componente**

```typescript
// web/src/components/ObservationCard.tsx
// Sprint 22.37 — card de observação capturada (drilldown).
import type { AdherenceObservation } from '../types'

interface Props {
  obs: AdherenceObservation
}

function fmtDateBR(ymd: string): string {
  if (!ymd || ymd.length < 10) return ymd
  const [, m, d] = ymd.split('-')
  return `${d}/${m}`
}

export function ObservationCard({ obs }: Props) {
  return (
    <div className="bg-bg-surface rounded-xl border border-border border-l-2 border-l-tom p-3">
      <p className="text-body-sm text-fg whitespace-pre-wrap">{obs.notes}</p>
      <p className="mt-1 text-caption text-fg-muted">
        {obs.template_name}
        {obs.item_description && <span> · {obs.item_description}</span>}
        <span> · {fmtDateBR(obs.reference_date)}</span>
      </p>
    </div>
  )
}
```

- [ ] **Step 2: Verify**

Run: `cd web && npx --no-install tsc --noEmit`
Expected: sem erros.

---

## Task 13: AderenciaChecklistDetalhe screen (drilldown)

**Files:**
- Create: `web/src/screens/AderenciaChecklistDetalhe.tsx`

- [ ] **Step 1: Criar screen**

```typescript
// web/src/screens/AderenciaChecklistDetalhe.tsx
// Sprint 22.37 — drilldown /mais/aderencia-checklists/:colabId.
import { useNavigate, useParams } from 'react-router-dom'
import { ChevronLeft, ClipboardCheck } from 'lucide-react'
import { LoadingState } from '../components/LoadingState'
import { EmptyState } from '../components/EmptyState'
import { ErrorState } from '../components/ErrorState'
import { CollabHeaderCard } from '../components/CollabHeaderCard'
import { TemplateBreakdownCard } from '../components/TemplateBreakdownCard'
import { ObservationCard } from '../components/ObservationCard'
import {
  useAdherenceWindow,
  useUnitFilter,
  useAdherenceByCollab,
  useAdherenceByTemplate,
  useAdherenceObservations,
} from '../hooks/useAdherence'

const WINDOW_LABEL: Record<string, string> = {
  today: 'hoje',
  week: 'semana',
  month: 'mês',
}

export function AderenciaChecklistDetalhe() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [window] = useAdherenceWindow()
  const [unit] = useUnitFilter()

  const listQuery = useAdherenceByCollab(window, unit)
  const collab = (listQuery.data ?? []).find((c) => c.collab_id === id)

  const tplQuery = useAdherenceByTemplate(id, window)
  const obsQuery = useAdherenceObservations(id, window)

  return (
    <div className="space-y-md">
      <button
        type="button"
        onClick={() => navigate('/mais/aderencia-checklists')}
        className="inline-flex items-center gap-1 text-tom hover:text-tom-shade focus-ring rounded-sm"
      >
        <ChevronLeft size={16} />
        <span className="text-body-sm">Aderência</span>
      </button>

      {listQuery.isLoading && <LoadingState rows={1} />}

      {listQuery.error && (
        <ErrorState
          title="Não consegui carregar"
          description="Pode ser conexão ou permissão."
          onRetry={() => listQuery.refetch()}
        />
      )}

      {!listQuery.isLoading && !listQuery.error && !collab && (
        <EmptyState
          icon={<ClipboardCheck size={32} />}
          title="Colaborador não encontrado"
          description="Pode ser que ele não tenha checklist na janela selecionada, ou esteja fora da sua unidade."
        />
      )}

      {collab && (
        <>
          <CollabHeaderCard data={collab} windowLabel={WINDOW_LABEL[window] ?? window} />

          <div>
            <h3 className="text-label text-fg-muted uppercase tracking-wide mb-2">Por checklist</h3>
            {tplQuery.isLoading && <LoadingState rows={2} />}
            {tplQuery.error && (
              <ErrorState
                title="Não consegui carregar breakdown"
                description=""
                onRetry={() => tplQuery.refetch()}
              />
            )}
            {!tplQuery.isLoading && !tplQuery.error && (tplQuery.data ?? []).length === 0 && (
              <p className="text-body-sm text-fg-muted">Sem despachos no período.</p>
            )}
            <div className="space-y-sm">
              {(tplQuery.data ?? []).map((tpl) => (
                <TemplateBreakdownCard key={tpl.template_id} data={tpl} />
              ))}
            </div>
          </div>

          <div>
            <h3 className="text-label text-fg-muted uppercase tracking-wide mb-2">Observações capturadas</h3>
            {obsQuery.isLoading && <LoadingState rows={1} />}
            {!obsQuery.isLoading && (obsQuery.data ?? []).length === 0 && (
              <p className="text-body-sm text-fg-muted">Sem observações registradas.</p>
            )}
            <div className="space-y-sm">
              {(obsQuery.data ?? []).map((obs, idx) => (
                <ObservationCard key={idx} obs={obs} />
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Verify**

Run: `cd web && npx --no-install tsc --noEmit`
Expected: sem erros.

---

## Task 14: Routes + Mais menu link

**Files:**
- Modify: `web/src/App.tsx`
- Modify: `web/src/screens/Mais.tsx`

- [ ] **Step 1: Modificar `web/src/App.tsx` — adicionar imports**

Localize o bloco de imports de screens e adicione:

```typescript
import { AderenciaChecklists } from './screens/AderenciaChecklists';
import { AderenciaChecklistDetalhe } from './screens/AderenciaChecklistDetalhe';
```

- [ ] **Step 2: Adicionar 2 routes no bloco gated por `requireRoles`**

Localize:

```tsx
<Route element={<ProtectedRoute requireRoles={['coordinator', 'director']} />}>
  <Route path="time" element={<DashboardTime />} />
  <Route path="time/:id" element={<PessoaDetalhe />} />
</Route>
```

Adicione um novo bloco `<Route element>` específico pra liderança operacional (director + manager) ANTES ou DEPOIS do bloco existente:

```tsx
<Route element={<ProtectedRoute requireRoles={['director', 'manager']} />}>
  <Route path="mais/aderencia-checklists" element={<AderenciaChecklists />} />
  <Route path="mais/aderencia-checklists/:id" element={<AderenciaChecklistDetalhe />} />
</Route>
```

- [ ] **Step 3: Modificar `web/src/screens/Mais.tsx` — adicionar item**

Localize o array `items: Item[]` e adicione **após** o item de "Histórico" (ou em posição visual coerente):

```typescript
{ to: '/mais/aderencia-checklists', label: 'Aderência operacional', hint: 'Checklists por colaborador', requireRoles: ['director', 'manager'] },
```

- [ ] **Step 4: Verify**

Run: `cd web && npx --no-install tsc --noEmit && npm run build 2>&1 | tail -8`
Expected: build OK, sem erros.

- [ ] **Step 5: Validar no preview**

```javascript
// preview_eval com:
(async () => {
  const regs = await navigator.serviceWorker.getRegistrations();
  for (const r of regs) await r.unregister();
  for (const k of await caches.keys()) await caches.delete(k);
  window.location.href = '/mais?_t=' + Date.now();
})()
```

Take screenshot. Esperado: link "Aderência operacional" aparece no menu Mais (pra Luciano que é director).

Click no link. Esperado: navega pra `/mais/aderencia-checklists` mostrando empty state ou lista (depende do dado).

---

## Task 15: Engine context — TOM lê aderência da equipe

**Files:**
- Modify: `src/prompts/system.js`

- [ ] **Step 1: Adicionar query de aderência da equipe em `fetchCollaboratorContext`**

Localize o bloco que adicionei na Sprint 22.36 Fatia 2 (queries `delegatedRes` e `todayChecklistsRes`). Adicione DEPOIS desse bloco, ainda dentro do `Promise.all`:

```javascript
    // Sprint 22.37 — Aderência da equipe pra liderança operacional (director + manager unit-específica).
    // Query roda só pra esses roles; pra outros retorna [] e o render condicional pula.
    (collaborator.role === 'director' || (collaborator.role === 'manager' && collaborator.unit !== 'all'))
      ? supabase.rpc('get_adherence_by_collab', {
          start_date: (() => {
            // Segunda da semana atual (BRT)
            const tzFmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' });
            const today = tzFmt.format(new Date()); // YYYY-MM-DD
            const d = new Date(today + 'T15:00:00.000Z');
            const dow = d.getUTCDay();
            const diffToMonday = dow === 0 ? -6 : 1 - dow;
            d.setUTCDate(d.getUTCDate() + diffToMonday);
            return d.toISOString().slice(0, 10);
          })(),
          end_date: new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date()),
          unit_filter: collaborator.role === 'manager' ? collaborator.unit : null,
        })
      : Promise.resolve({ data: [], error: null }),
```

E acrescentar no array de destructuring (após `todayChecklistsRes`):

```javascript
    teamAdherenceRes,
```

- [ ] **Step 2: Adicionar no return do `fetchCollaboratorContext`**

```javascript
    teamAdherence: teamAdherenceRes.data || [],
```

- [ ] **Step 3: Atualizar assinatura de `buildContext` pra aceitar teamAdherence**

Localize:

```javascript
function buildContext(collab, memories, prefs, tasks, projects, lastMsgAge, habits, events, delegatedTasks, todayChecklists) {
```

Mude pra:

```javascript
function buildContext(collab, memories, prefs, tasks, projects, lastMsgAge, habits, events, delegatedTasks, todayChecklists, teamAdherence) {
```

- [ ] **Step 4: Adicionar render do bloco aderência da equipe**

Localize o bloco "CHECKLISTS DE HOJE" que adicionei na Sprint 22.36 Fatia 2. Adicione DEPOIS:

```javascript
  // Sprint 22.37 — ADERÊNCIA DA EQUIPE (semana atual) pra liderança operacional.
  if (teamAdherence && teamAdherence.length) {
    lines.push('', `**Aderência da equipe (esta semana):**`);
    teamAdherence.slice(0, 25).forEach(t => {
      const emoji = t.pct >= 90 ? '🟢' : t.pct >= 70 ? '🟡' : '🔴';
      const first = (t.full_name || '').split(' ')[0];
      const annotations = [];
      if (t.late_items > 0) annotations.push(`${t.late_items} c/atraso`);
      if (t.escalated_count > 0) annotations.push(`${t.escalated_count} escaladas`);
      const tail = annotations.length ? ` — ${annotations.join(', ')}` : '';
      lines.push(`• ${emoji} ${first}: ${t.pct}% (${t.completed}/${t.dispatched})${tail}`);
    });
  }
```

- [ ] **Step 5: Atualizar os 2 call sites de `buildContext`**

Localize as 2 chamadas (linhas ~1210 e ~1386). Adicione `ctx.teamAdherence || []` como último argumento em ambas:

Antes:
```javascript
buildContext(collaborator, ctx.memories, ctx.prefs, tasksForCtx, ctx.activeProjects, lastMsgAge, habitsForCtx, eventsForCtx, ctx.delegatedTasks || [], ctx.todayChecklists || []);
```

Depois:
```javascript
buildContext(collaborator, ctx.memories, ctx.prefs, tasksForCtx, ctx.activeProjects, lastMsgAge, habitsForCtx, eventsForCtx, ctx.delegatedTasks || [], ctx.todayChecklists || [], ctx.teamAdherence || []);
```

Mesmo padrão pro segundo call site.

- [ ] **Step 6: Verify**

Run: `cd /d/la-organizer/_remote && node --check src/prompts/system.js`
Expected: sem erros.

---

## Task 16: Update PRD/mapa/skills

**Files:**
- Modify: `docs/06-prd-la-organizer-v3.md`
- Modify: `docs/05-mapa-telas-pwa-v3.md`
- Modify: `docs/TOM-SKILLS-CATALOG.md`

- [ ] **Step 1: Bump PRD pra v3.10**

Modificar `docs/06-prd-la-organizer-v3.md` linha 4-5:

Antes:
```markdown
**Versão:** 3.9
**Data:** 2026-05-08 (atualizado Sprint 22.36 — Checklist design system + DnD + CRUD + TOM celebra/cobra/escala)
```

Depois:
```markdown
**Versão:** 3.10
**Data:** 2026-05-08 (atualizado Sprint 22.37 — Aderência operacional pra liderança)
```

- [ ] **Step 2: Adicionar changelog v3.10 acima do v3.9**

Localize `### v3.8 → v3.9 (2026-05-08)` e ANTES dele adicione:

```markdown
### v3.9 → v3.10 (2026-05-08) — pós-Sprint 22.37 (Aderência operacional)

| Item | v3.9 | v3.10 |
|---|---|---|
| Tela aderência | Não existia | `/mais/aderencia-checklists` lista + drilldown `/:colabId`. Acesso `director` + `manager unit-específica` (Quintela/Juliana, role coordinator pedagogical, NÃO veem) |
| Cor da aderência | n/a | 🟢 ≥90 / 🟡 70-89 / 🔴 <70 baseado em fechados/despachados (PRD §4 alinhado) |
| Janela | n/a | Toggle Hoje / Semana / Mês (default Semana) |
| Filtro unidade | n/a | Director vê chips Todas/Barra/Recreio/Campo Grande; manager vê só sua unidade |
| Drilldown | n/a | Header colab + breakdown por template + observações capturadas + escalações |
| TOM contexto | sem aderência da equipe | Bloco "Aderência da equipe (esta semana)" injetado em `buildContext` pra leadership. Skill subfluxo 7 ganha dado real |
| Schema 22.37 | n/a | Helpers `current_collab_unit/role()` + 3 policies SELECT (completions/items/templates) + 2 RPCs (`get_adherence_by_collab`, `get_adherence_by_template`) |
| Bug fix Sprint 22.36 | findUnitManager retornava coordinator | Agora retorna role='manager' AND unit-específica, fallback director. Quintela não recebe escalação |
```

- [ ] **Step 3: Atualizar `docs/05-mapa-telas-pwa-v3.md`**

Adicionar no índice de telas (procurar tabela com lista de telas) na seção de cobertura por role:

```markdown
| Aderência operacional `/mais/aderencia-checklists` | — | — | ✓ (manager + director) | ✅ Sprint 22.37 |
| Aderência detalhe `/mais/aderencia-checklists/:id` | — | — | ✓ (manager + director) | ✅ Sprint 22.37 |
```

E adicionar uma seção "Tela 19" (ou próximo número) com descrição:

```markdown
### Tela 19 — Aderência operacional `/mais/aderencia-checklists` *(novo Sprint 22.37)*

**Route:** `<ProtectedRoute requireRoles={['director', 'manager']} />`

Lista colaboradores ativos com aderência de checklists na janela selecionada (Hoje/Semana/Mês). Director vê todas as unidades + chips de filtro. Manager unit-específica vê só sua unidade. Manager `unit='all'` (Yuri Marketing) e coordinator pedagógicas (Quintela/Juliana) NÃO acessam — empty state ou bloqueio.

Card por colab: avatar + nome/role/unidade + % grande + barra `bg-tom` + border-left 🟢🟡🔴 + contador "X/Y fechados · Z com atraso · W escaladas".

Resumo da equipe no topo: % geral + count de colabs <70%.

Click no card → drilldown `/mais/aderencia-checklists/:id`.

---

### Tela 20 — Aderência operacional drilldown `/mais/aderencia-checklists/:id`

Header colab (avatar grande + % geral) + breakdown por template (1 card por template do colab no período, com sua barra) + observações capturadas (notes do TOM e do PWA). Escalações aparecem como annotation no card do template. Mesmo padrão visual de `PessoaDetalhe` (drilldown do Dashboard do time).
```

- [ ] **Step 4: Atualizar `docs/TOM-SKILLS-CATALOG.md`**

Localize a seção "## 6. Checklists operacionais" e adicione no fim do bloco de reforços (após o conteúdo da Sprint 22.36):

```markdown
**Reforços Sprint 22.37:**
- Bloco "Aderência da equipe (esta semana)" agora aparece no `buildContext` pra `director` e `manager unit-específica`. Cada linha: `🟢/🟡/🔴 Nome: pct% (X/Y) — annotations`.
- TOM responde subfluxo 7 ("Aderência da semana") usando esse dado real, não inventando.
- Coordinator pedagogical (Quintela/Juliana) e manager Marketing (Yuri unit='all') não recebem o bloco — `teamAdherence: []`.
```

- [ ] **Step 5: Verify**

Não tem typecheck pra docs. Verificação visual: abrir cada arquivo e confirmar mudanças aplicadas.

---

## Task 17: Final commit + push + deploy

**Files:** todos os criados/modificados.

- [ ] **Step 1: Validar tudo localmente**

```bash
cd /d/la-organizer/_remote
node --check src/prompts/system.js && echo "system OK"
cd web && npx --no-install tsc --noEmit && echo "tsc OK"
npm run build 2>&1 | tail -8
```

Expected: tudo passa, build sucesso.

- [ ] **Step 2: Validar no preview com dado de teste**

Insert via SQL pra criar 2 completions hoje pra outro colab além do Luciano (ex: um colab com role 'collaborator' associado a uma unidade) — opcional, só se quiser ver a tela com dado real.

Rodar:
```javascript
preview_eval: `
  (async () => {
    const regs = await navigator.serviceWorker.getRegistrations();
    for (const r of regs) await r.unregister();
    for (const k of await caches.keys()) await caches.delete(k);
    window.location.href = '/mais/aderencia-checklists?_t=' + Date.now();
  })()
`
preview_screenshot
```

Esperado: tela carrega, mostra empty state OU lista de colabs com despacho.

- [ ] **Step 3: Clone repo e copy files**

```bash
git clone -q https://github.com/LucianoAlf/LA-Organizer.git /tmp/dep-22-37
cd /tmp/dep-22-37
cp /d/la-organizer/_remote/migrations/2026-05-08-sprint22-37-adherence-rls.sql migrations/
cp /d/la-organizer/_remote/web/src/types.ts web/src/
cp /d/la-organizer/_remote/web/src/lib/adherence.ts web/src/lib/
cp /d/la-organizer/_remote/web/src/hooks/useAdherence.ts web/src/hooks/
cp /d/la-organizer/_remote/web/src/components/TimeWindowChips.tsx web/src/components/
cp /d/la-organizer/_remote/web/src/components/UnitFilterChips.tsx web/src/components/
cp /d/la-organizer/_remote/web/src/components/AdherenceCard.tsx web/src/components/
cp /d/la-organizer/_remote/web/src/components/TeamSummaryCard.tsx web/src/components/
cp /d/la-organizer/_remote/web/src/components/CollabHeaderCard.tsx web/src/components/
cp /d/la-organizer/_remote/web/src/components/TemplateBreakdownCard.tsx web/src/components/
cp /d/la-organizer/_remote/web/src/components/ObservationCard.tsx web/src/components/
cp /d/la-organizer/_remote/web/src/screens/AderenciaChecklists.tsx web/src/screens/
cp /d/la-organizer/_remote/web/src/screens/AderenciaChecklistDetalhe.tsx web/src/screens/
cp /d/la-organizer/_remote/web/src/screens/Mais.tsx web/src/screens/
cp /d/la-organizer/_remote/web/src/App.tsx web/src/
cp /d/la-organizer/_remote/src/prompts/system.js src/prompts/
cp /d/la-organizer/_remote/docs/06-prd-la-organizer-v3.md docs/
cp /d/la-organizer/_remote/docs/05-mapa-telas-pwa-v3.md docs/
cp /d/la-organizer/_remote/docs/TOM-SKILLS-CATALOG.md docs/
git add -A
```

Sub-skill `superpowers:subagent-driven-development` ou inline: para evitar `cp` direto, criar mkdir -p antes se diretório não existir.

- [ ] **Step 4: Commit bundle**

```bash
git commit -m "$(cat <<'EOF'
feat(aderencia): Sprint 22.37 — tela aderência operacional pra liderança

Migration 2026-05-08-sprint22-37-adherence-rls.sql:
- Helpers current_collab_unit() + current_collab_role() (SECURITY DEFINER)
- 3 policies SELECT (completions/items/templates) pra leadership
- 2 RPCs SECURITY INVOKER (get_adherence_by_collab, get_adherence_by_template)

PWA:
- Tela /mais/aderencia-checklists (lista) + /:id (drilldown)
- Componentes: AdherenceCard, TemplateBreakdownCard, ObservationCard,
  CollabHeaderCard, TeamSummaryCard, TimeWindowChips, UnitFilterChips
- Hook useAdherence (URL state + queries)
- Lib adherence (queries + getDateRange + tone helpers)
- Acesso: requireRoles ['director', 'manager']

Engine TOM:
- buildContext injeta teamAdherence pra liderança (director +
  manager unit-específica). Skill subfluxo 7 ganha dado real.
- Coordinator pedagogical (Quintela/Juliana) e manager Marketing
  (Yuri unit='all') NÃO recebem o bloco.

Docs: PRD bump v3.10, mapa de telas (Telas 19+20), catalog skills.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 5: Apply migration via Supabase MCP** (se ainda não aplicado)

Use `mcp__4c04bb52-f946-4fe8-85f6-b01d200f8c20__apply_migration` (já feito na Task 1, verificar `pg_policies` se já existe).

- [ ] **Step 6: Push + deploy via script**

```bash
bash scripts/push-and-deploy.sh /tmp/dep-22-37
```

Expected: push OK + VPS pull + pm2 restart (mudou `src/`).

- [ ] **Step 7: Cleanup**

```bash
rm -rf /tmp/dep-22-37
```

- [ ] **Step 8: Validar produção**

Aguardar Vercel deploy (~2min). Acessar PWA, ir em `/mais` e clicar "Aderência operacional". Confirmar que abre.

---

## Self-Review Checklist (post-write)

**1. Spec coverage:**
- ✅ §4 RBAC (Task 9 + 14 + 15)
- ✅ §5 Janela temporal (Task 4 + 5)
- ✅ §6 Fórmula (Task 1 RPC + Task 3 lib helpers)
- ✅ §7 Lista layout (Task 7 + 8 + 9)
- ✅ §8 Drilldown (Task 10 + 11 + 12 + 13)
- ✅ §9 RLS (Task 1)
- ✅ §10 RPCs (Task 1)
- ✅ §11 Engine TOM (Task 15)
- ✅ §12 Arquivos (mapa em File Structure)
- ✅ §13 Critérios cobertos pelos verifies

**2. Placeholder scan:** sem TBD/TODO. Cada step tem código completo.

**3. Type consistency:** `AdherenceByCollab`, `AdherenceByTemplate`, `AdherenceObservation`, `AdherenceWindow` consistentes em types.ts → lib → hooks → componentes → screens.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-08-sprint22-37-aderencia-checklists.md`.

Two execution options:

**1. Subagent-Driven (recommended)** — dispatch fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — execute tasks in this session via executing-plans, batch with checkpoints.

Which approach?
