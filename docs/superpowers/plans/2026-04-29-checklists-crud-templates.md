# CRUD de Templates de Checklists Operacionais — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adicionar tela de gestão de templates de checklists operacionais ao PWA — director e coordinator criam, editam, arquivam e gerenciam itens, com audit log automático via triggers Postgres.

**Architecture:** Migration adiciona `updated_by` + `is_active` + `op_checklists_audit` + triggers. RLS segue padrão via email (sem auth_id). PWA: nova tela `/mais/checklists-templates` com BottomSheet para criar/editar, `ChecklistItemEditRow` com botões ↑/↓, entrada no menu Mais (visível só para director/coordinator).

**Tech Stack:** Supabase PostgreSQL (triggers, RLS), React + TypeScript + TanStack Query, lucide-react, padrão BottomSheet existente (ver `web/src/components/EditEventSheet.tsx`)

**Spec:** `docs/superpowers/specs/2026-04-29-checklists-crud-templates-design.md`

---

## Schema Corrections (real vs spec)

| Spec assumiu | Real (verificado Task 9 Sprint 1) |
|---|---|
| `op_checklists.active` | `op_checklists.is_active` (já existe) |
| `op_checklists.template_id` / `completion_date` | `checklist_id` / `reference_date` |
| Auth via `auth.uid()` | Auth via `email` (collaborators.email = auth.jwt()->>email) |

---

## File Map

| Arquivo | Ação | Responsabilidade |
|---|---|---|
| DB via MCP | CREATE/ALTER | `updated_by` em `op_checklists`, `is_active`+`updated_by` em `op_checklist_items`, `op_checklists_audit`, triggers, RLS |
| `src/rituals/dispatcher.js` | MODIFY | Filtrar `is_active=true` em `op_checklist_items` |
| `src/prompts/system.js` | MODIFY | Filtrar `is_active=true` em `op_checklist_items` |
| `web/src/types.ts` | MODIFY | Adicionar `is_active`, `updated_by`, `OpChecklistAudit` |
| `web/src/components/ChecklistItemEditRow.tsx` | CREATE | Linha de item editável com ↑/↓ + delete |
| `web/src/components/ChecklistTemplateSheet.tsx` | CREATE | BottomSheet criar/editar template + itens |
| `web/src/screens/ChecklistsTemplates.tsx` | CREATE | Lista de templates com FAB + archive |
| `web/src/screens/Mais.tsx` | MODIFY | Ativar link + restrição de role |
| `web/src/App.tsx` | MODIFY | Rota `/mais/checklists-templates` |

---

## Task 1: DB Migration — Colunas + Audit Table

**Files:** DB via Supabase MCP

- [ ] **Step 1: Inspecionar estado atual**

```sql
SELECT column_name, data_type FROM information_schema.columns
WHERE table_schema='public'
  AND table_name IN ('op_checklists','op_checklist_items')
ORDER BY table_name, ordinal_position;
```

Confirmar: `op_checklists.is_active` já existe, `op_checklist_items` não tem `is_active` nem `updated_by`.

- [ ] **Step 2: Aplicar migration via `apply_migration` com nome `op_checklists_crud_support`**

```sql
-- 1. op_checklists: coluna updated_by para trigger saber quem editou
ALTER TABLE op_checklists
  ADD COLUMN IF NOT EXISTS updated_by uuid REFERENCES collaborators(id);

-- 2. op_checklist_items: soft delete + rastreamento de autor
ALTER TABLE op_checklist_items
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS updated_by uuid REFERENCES collaborators(id),
  ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

-- 3. Tabela de auditoria
CREATE TABLE IF NOT EXISTS op_checklists_audit (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id uuid NOT NULL REFERENCES op_checklists(id) ON DELETE CASCADE,
  action      text NOT NULL CHECK (action IN (
    'created','updated','deactivated','activated',
    'item_added','item_removed','item_updated','reordered'
  )),
  changed_by  uuid REFERENCES collaborators(id),
  changed_at  timestamptz NOT NULL DEFAULT now(),
  details     jsonb
);
CREATE INDEX IF NOT EXISTS idx_op_checklists_audit_template
  ON op_checklists_audit(template_id, changed_at DESC);
```

- [ ] **Step 3: Verificar**

```sql
SELECT table_name, column_name FROM information_schema.columns
WHERE table_schema='public'
  AND column_name IN ('updated_by','is_active','updated_at')
  AND table_name IN ('op_checklists','op_checklist_items')
ORDER BY table_name, column_name;
-- Expected: 4 rows (updated_by em ambas + is_active + updated_at em items)

SELECT table_name FROM information_schema.tables
WHERE table_schema='public' AND table_name='op_checklists_audit';
-- Expected: 1 row
```

---

## Task 2: DB Triggers

**Files:** DB via Supabase MCP

- [ ] **Step 1: Trigger em `op_checklists`**

```sql
CREATE OR REPLACE FUNCTION op_checklists_audit_fn()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO op_checklists_audit(template_id, action, changed_by, details)
    VALUES (NEW.id, 'created', NEW.updated_by,
      jsonb_build_object('name', NEW.name));

  ELSIF TG_OP = 'UPDATE' THEN
    IF OLD.is_active = true AND NEW.is_active = false THEN
      INSERT INTO op_checklists_audit(template_id, action, changed_by, details)
      VALUES (NEW.id, 'deactivated', NEW.updated_by, NULL);

    ELSIF OLD.is_active = false AND NEW.is_active = true THEN
      INSERT INTO op_checklists_audit(template_id, action, changed_by, details)
      VALUES (NEW.id, 'activated', NEW.updated_by, NULL);

    ELSE
      INSERT INTO op_checklists_audit(template_id, action, changed_by, details)
      VALUES (NEW.id, 'updated', NEW.updated_by, jsonb_build_object(
        'before', to_jsonb(OLD) - 'updated_at' - 'updated_by',
        'after',  to_jsonb(NEW) - 'updated_at' - 'updated_by'
      ));
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_op_checklists_audit ON op_checklists;
CREATE TRIGGER trg_op_checklists_audit
  AFTER INSERT OR UPDATE ON op_checklists
  FOR EACH ROW EXECUTE FUNCTION op_checklists_audit_fn();
```

- [ ] **Step 2: Trigger em `op_checklist_items`**

```sql
CREATE OR REPLACE FUNCTION op_checklist_items_audit_fn()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO op_checklists_audit(template_id, action, changed_by, details)
    VALUES (NEW.checklist_id, 'item_added', NEW.updated_by,
      jsonb_build_object('item_id', NEW.id, 'description', NEW.description,
        'sort_order', NEW.sort_order));

  ELSIF TG_OP = 'UPDATE' THEN
    IF OLD.is_active = true AND NEW.is_active = false THEN
      INSERT INTO op_checklists_audit(template_id, action, changed_by, details)
      VALUES (NEW.checklist_id, 'item_removed', NEW.updated_by,
        jsonb_build_object('item_id', NEW.id, 'description', OLD.description));

    ELSIF OLD.sort_order IS DISTINCT FROM NEW.sort_order THEN
      INSERT INTO op_checklists_audit(template_id, action, changed_by, details)
      VALUES (NEW.checklist_id, 'reordered', NEW.updated_by,
        jsonb_build_object('item_id', NEW.id,
          'from', OLD.sort_order, 'to', NEW.sort_order));

    ELSIF OLD.description IS DISTINCT FROM NEW.description THEN
      INSERT INTO op_checklists_audit(template_id, action, changed_by, details)
      VALUES (NEW.checklist_id, 'item_updated', NEW.updated_by,
        jsonb_build_object('item_id', NEW.id,
          'before', OLD.description, 'after', NEW.description));
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_op_checklist_items_audit ON op_checklist_items;
CREATE TRIGGER trg_op_checklist_items_audit
  AFTER INSERT OR UPDATE ON op_checklist_items
  FOR EACH ROW EXECUTE FUNCTION op_checklist_items_audit_fn();
```

- [ ] **Step 3: Testar trigger em `op_checklists`**

```sql
-- Atualizar um template existente com updated_by de um collaborator real
SELECT id FROM collaborators LIMIT 1; -- pegar um UUID
SELECT id FROM op_checklists WHERE name='Abertura Escola';

UPDATE op_checklists
SET name='Abertura Escola v2', updated_by='<COLLAB_ID>'
WHERE id='<TEMPLATE_ID>';

SELECT action, changed_by, details->>'before' AS before_name
FROM op_checklists_audit WHERE template_id='<TEMPLATE_ID>'
ORDER BY changed_at DESC LIMIT 1;
-- Expected: action='updated', details.before.name='Abertura Escola'

-- Reverter
UPDATE op_checklists SET name='Abertura Escola', updated_by=NULL WHERE id='<TEMPLATE_ID>';
```

- [ ] **Step 4: Testar trigger em `op_checklist_items`**

```sql
SELECT id FROM op_checklist_items WHERE checklist_id='<TEMPLATE_ID>' LIMIT 1;

UPDATE op_checklist_items
SET description='Abrir portões TESTE', updated_by='<COLLAB_ID>'
WHERE id='<ITEM_ID>';

SELECT action, details FROM op_checklists_audit
WHERE template_id='<TEMPLATE_ID>' ORDER BY changed_at DESC LIMIT 1;
-- Expected: action='item_updated', details.before='Abrir portões e recepção'

-- Reverter
UPDATE op_checklist_items SET description='Abrir portões e recepção', updated_by=NULL WHERE id='<ITEM_ID>';
```

---

## Task 3: DB RLS Policies

**Files:** DB via Supabase MCP

- [ ] **Step 1: Descobrir padrão de auth → collaborator.id**

```sql
-- Verificar corpo das policies existentes em tasks (referência)
SELECT policyname, qual
FROM pg_policies
WHERE schemaname='public' AND tablename='tasks'
ORDER BY policyname LIMIT 3;

-- Verificar se existe função helper de auth
SELECT proname, prosrc FROM pg_proc
WHERE proname IN ('get_my_collaborator_id','auth_collaborator_id','current_collaborator_id');
```

O resultado de `qual` mostra o padrão exato. Use-o nos steps seguintes no lugar de `<AUTH_PATTERN>`.

**Padrão mais provável** (auth via email, sem auth_id column):
```sql
(SELECT id FROM collaborators WHERE email = (auth.jwt() ->> 'email') AND is_active = true)
```

Se `qual` de uma policy existente mostrar padrão diferente, use o padrão existente.

- [ ] **Step 2: Confirmar padrão resolvendo para um UUID real**

```sql
-- Testar se o padrão retorna um id válido (logar como director no Supabase Studio primeiro)
SELECT id, email, role FROM collaborators
WHERE email = (SELECT email FROM auth.users LIMIT 1)
LIMIT 1;
-- Se retornar um director/coordinator — padrão confirmado
```

- [ ] **Step 3: Aplicar RLS em `op_checklists`**

```sql
-- RLS já pode estar habilitado (verificar)
ALTER TABLE op_checklists ENABLE ROW LEVEL SECURITY;

-- SELECT: todos os colaboradores autenticados (cron + PWA precisam ler)
CREATE POLICY op_checklists_select_auth ON op_checklists
  FOR SELECT TO authenticated USING (true);

-- INSERT/UPDATE/DELETE: só director e coordinator
-- SUBSTITUIR <AUTH_PATTERN> pelo padrão verificado no Step 1
CREATE POLICY op_checklists_write_director_coord ON op_checklists
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM collaborators
      WHERE id = <AUTH_PATTERN>
        AND role IN ('director','coordinator')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM collaborators
      WHERE id = <AUTH_PATTERN>
        AND role IN ('director','coordinator')
    )
  );
```

- [ ] **Step 4: Aplicar RLS em `op_checklist_items`**

```sql
ALTER TABLE op_checklist_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY op_checklist_items_select_auth ON op_checklist_items
  FOR SELECT TO authenticated USING (true);

CREATE POLICY op_checklist_items_write_director_coord ON op_checklist_items
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM collaborators
      WHERE id = <AUTH_PATTERN>
        AND role IN ('director','coordinator')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM collaborators
      WHERE id = <AUTH_PATTERN>
        AND role IN ('director','coordinator')
    )
  );
```

- [ ] **Step 5: RLS em `op_checklists_audit` (só leitura para director/coord)**

```sql
ALTER TABLE op_checklists_audit ENABLE ROW LEVEL SECURITY;

-- Triggers rodam como SECURITY DEFINER — bypass RLS para INSERT
CREATE POLICY op_checklists_audit_select ON op_checklists_audit
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM collaborators
      WHERE id = <AUTH_PATTERN>
        AND role IN ('director','coordinator')
    )
  );
```

- [ ] **Step 6: Service role mantém acesso total**

```sql
-- Se existir service role policy, verificar que não é sobreposta
SELECT policyname FROM pg_policies
WHERE tablename IN ('op_checklists','op_checklist_items','op_checklists_audit')
  AND policyname LIKE '%service%';
-- Se existir, ok — service role bypasses RLS por padrão no Supabase
```

---

## Task 4: Sprint 1 Patch — Filtrar `is_active=true` em Items

**Files:**
- Modify: `D:\la-organizer\_remote\src\rituals\dispatcher.js`
- Modify: `D:\la-organizer\_remote\src\prompts\system.js`

Os itens agora têm `is_active boolean`. O cron e o context injection precisam ignorar itens desativados.

- [ ] **Step 1: Patch `dispatcher.js`**

Localize a query que seleciona `op_checklist_items`:
```js
.select('*, op_checklist_items(id, description, sort_order)')
```

Adicione filtro `is_active`:
```js
.select('*, op_checklist_items!inner(id, description, sort_order)')
// Após select, adicione:
// Nota: Supabase não suporta filtro em relação aninhada diretamente.
// Alternativa: filtrar no JS após o fetch:
```

Na verdade, para filtrar itens inativos em join aninhado no Supabase JS v2, use:
```js
const { data: templates } = await supabase
  .from('op_checklists')
  .select('*, op_checklist_items(id, description, sort_order, is_active)')
  .contains('days_of_week', [dow])
  .gte('dispatch_time', timeMinus5)
  .lte('dispatch_time', timeNow)
  .eq('is_active', true);  // filtro do template

// Então filtrar itens ativos no JS:
for (const template of templates) {
  template.op_checklist_items = (template.op_checklist_items || [])
    .filter(i => i.is_active !== false);
  // resto do código inalterado
}
```

Localize o bloco `for (const template of templates)` em `dispatchChecklists` e adicione o filtro logo após o início do loop.

- [ ] **Step 2: Patch `system.js`**

Localize `getActiveChecklistHint` em `system.js`. Na query:
```js
.select(`
  id, dispatched_at,
  op_checklists (
    name, completion_threshold,
    op_checklist_items ( id, description, sort_order )
  )
`)
```

Adicione `is_active` ao select de items e filtre no JS após o fetch:
```js
.select(`
  id, dispatched_at,
  op_checklists (
    name, completion_threshold,
    op_checklist_items ( id, description, sort_order, is_active )
  )
`)
```

Logo após receber `data`, antes de `.sort(...)`:
```js
const activeItems = (template.op_checklist_items || [])
  .filter(i => i.is_active !== false)
  .sort((a, b) => a.sort_order - b.sort_order)
  .map((item, i) => `${i + 1}. [item_id:${item.id}] ${item.description}`)
  .join('\n');
```

- [ ] **Step 3: Smoke test**

```
node -e "
const d = require('fs').readFileSync('D:/la-organizer/_remote/src/rituals/dispatcher.js','utf8');
console.log('is_active filter:', d.includes('is_active') ? 'FOUND' : 'MISSING');
const s = require('fs').readFileSync('D:/la-organizer/_remote/src/prompts/system.js','utf8');
console.log('is_active in system:', s.includes('is_active') ? 'FOUND' : 'MISSING');
"
```

---

## Task 5: PWA Types

**Files:**
- Modify: `D:\la-organizer\_remote\web\src\types.ts`

- [ ] **Step 1: Ler o final atual de `types.ts`**

Localizar a seção `// ── Checklists Operacionais ──` adicionada na Sprint 1.

- [ ] **Step 2: Atualizar `OpChecklistTemplate` e `OpChecklistItem`**

Localizar `export interface OpChecklistTemplate` e adicionar campos:
```typescript
export interface OpChecklistTemplate {
  id: string
  name: string
  function_role: string
  unit: string
  shift: string
  days_of_week: number[]
  dispatch_time: string
  completion_threshold: number
  is_active: boolean          // já existia no DB
  created_by: string | null
  updated_by: string | null
  created_at?: string
  updated_at?: string
}
```

Localizar `export interface OpChecklistItem` e adicionar:
```typescript
export interface OpChecklistItem {
  id: string
  checklist_id: string
  description: string
  sort_order: number
  is_active: boolean          // adicionado nesta sprint
  updated_by: string | null
}
```

- [ ] **Step 3: Adicionar `OpChecklistAudit`**

Após `isChecklistWindowClosed`, adicionar:

```typescript
export interface OpChecklistAudit {
  id: string
  template_id: string
  action:
    | 'created' | 'updated' | 'deactivated' | 'activated'
    | 'item_added' | 'item_removed' | 'item_updated' | 'reordered'
  changed_by: string | null
  changed_at: string
  details: Record<string, unknown> | null
  // join opcional
  collaborator?: { full_name: string }
}

/** Formulário local de item (antes de salvar no DB) */
export interface OpChecklistItemDraft {
  id?: string           // undefined = novo item (não existe no DB ainda)
  description: string
  sort_order: number
  is_active: boolean    // false = marcado para remoção
}
```

- [ ] **Step 4: TypeScript check**

```bash
cd D:\la-organizer\_remote\web && npx tsc --noEmit 2>&1 | grep -E "OpChecklist|types\.ts" | head -10
```

**Esperado:** 0 erros nos tipos de checklist.

---

## Task 6: ChecklistItemEditRow

**Files:**
- Create: `D:\la-organizer\_remote\web\src\components\ChecklistItemEditRow.tsx`

- [ ] **Step 1: Ler `ChecklistItemRow.tsx` para referência de estilo**

```bash
# Leia web/src/components/ChecklistItemRow.tsx para seguir o mesmo padrão de classes CSS
```

- [ ] **Step 2: Criar `ChecklistItemEditRow.tsx`**

```tsx
// web/src/components/ChecklistItemEditRow.tsx
import { ChevronUp, ChevronDown, Trash2 } from 'lucide-react'

interface Props {
  description: string
  index: number
  isFirst: boolean
  isLast: boolean
  onMoveUp: () => void
  onMoveDown: () => void
  onChange: (value: string) => void
  onDelete: () => void
}

export function ChecklistItemEditRow({
  description, index, isFirst, isLast,
  onMoveUp, onMoveDown, onChange, onDelete,
}: Props) {
  return (
    <div className="flex items-center gap-2 py-1">
      <div className="flex flex-col gap-0.5">
        <button
          type="button"
          onClick={onMoveUp}
          disabled={isFirst}
          className="p-0.5 rounded text-fg-muted hover:text-fg disabled:opacity-20 disabled:cursor-not-allowed"
          aria-label="Mover item para cima"
        >
          <ChevronUp size={16} />
        </button>
        <button
          type="button"
          onClick={onMoveDown}
          disabled={isLast}
          className="p-0.5 rounded text-fg-muted hover:text-fg disabled:opacity-20 disabled:cursor-not-allowed"
          aria-label="Mover item para baixo"
        >
          <ChevronDown size={16} />
        </button>
      </div>

      <span className="text-fg-muted text-caption w-5 text-right flex-shrink-0">
        {index}.
      </span>

      <input
        type="text"
        value={description}
        onChange={e => onChange(e.target.value)}
        className="flex-1 bg-transparent border-b border-border text-body-sm text-fg py-0.5 focus:outline-none focus:border-brand"
        placeholder="Descrição do item"
      />

      <button
        type="button"
        onClick={onDelete}
        className="p-1 rounded text-fg-muted hover:text-danger transition-colors"
        aria-label="Remover item"
      >
        <Trash2 size={15} />
      </button>
    </div>
  )
}
```

- [ ] **Step 3: TypeScript check**

```bash
cd D:\la-organizer\_remote\web && npx tsc --noEmit 2>&1 | grep "ChecklistItemEditRow" | head -5
```

**Esperado:** sem erros.

---

## Task 7: ChecklistTemplateSheet

**Files:**
- Create: `D:\la-organizer\_remote\web\src\components\ChecklistTemplateSheet.tsx`

Antes de criar, leia `web/src/components/EditEventSheet.tsx` para entender o padrão BottomSheet do projeto (como `open`, `onClose`, estrutura interna, botões de ação).

- [ ] **Step 1: Ler `EditEventSheet.tsx` para padrão BottomSheet**

Confirme: como `BottomSheet` é importado e usado, como o formulário é estruturado, se há padrão de `useMutation`.

- [ ] **Step 2: Criar `ChecklistTemplateSheet.tsx`**

```tsx
// web/src/components/ChecklistTemplateSheet.tsx
import { useState, useEffect } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { BottomSheet } from './BottomSheet'
import { ChecklistItemEditRow } from './ChecklistItemEditRow'
import type { OpChecklistTemplate, OpChecklistItemDraft } from '../types'

const FUNCTION_ROLES = [
  { value: 'secretary_morning',     label: 'Secretária (manhã)' },
  { value: 'secretary_evening',     label: 'Secretária (noite)' },
  { value: 'pedagogical_assistant', label: 'Assistente pedagógica' },
  { value: 'cleaning',              label: 'Limpeza' },
] as const

const UNITS = [
  { value: 'all',          label: 'Todas as unidades' },
  { value: 'barra',        label: 'Barra' },
  { value: 'recreio',      label: 'Recreio' },
  { value: 'campo_grande', label: 'Campo Grande' },
] as const

const SHIFTS = [
  { value: 'morning',   label: 'Manhã' },
  { value: 'afternoon', label: 'Tarde' },
  { value: 'evening',   label: 'Noite' },
  { value: 'full',      label: 'Integral' },
] as const

const DAYS = [
  { n: 1, label: 'Seg' }, { n: 2, label: 'Ter' }, { n: 3, label: 'Qua' },
  { n: 4, label: 'Qui' }, { n: 5, label: 'Sex' }, { n: 6, label: 'Sáb' },
  { n: 7, label: 'Dom' },
]

interface Props {
  open: boolean
  template: OpChecklistTemplate | null  // null = create mode
  onClose: () => void
}

export function ChecklistTemplateSheet({ open, template, onClose }: Props) {
  const { collaborator } = useAuth()
  const queryClient = useQueryClient()

  const [name, setName] = useState('')
  const [functionRole, setFunctionRole] = useState('secretary_morning')
  const [unit, setUnit] = useState('all')
  const [shift, setShift] = useState('morning')
  const [daysOfWeek, setDaysOfWeek] = useState<number[]>([1,2,3,4,5])
  const [dispatchTime, setDispatchTime] = useState('08:00')
  const [threshold, setThreshold] = useState(80)
  const [items, setItems] = useState<OpChecklistItemDraft[]>([])
  const [newItemText, setNewItemText] = useState('')

  useEffect(() => {
    if (!open) return
    if (template) {
      setName(template.name)
      setFunctionRole(template.function_role)
      setUnit(template.unit)
      setShift(template.shift)
      setDaysOfWeek(template.days_of_week)
      setDispatchTime(template.dispatch_time)
      setThreshold(template.completion_threshold)
      const activeItems = (template.op_checklist_items ?? [])
        .filter(i => i.is_active !== false)
        .sort((a, b) => a.sort_order - b.sort_order)
        .map(i => ({ id: i.id, description: i.description,
                     sort_order: i.sort_order, is_active: true }))
      setItems(activeItems)
    } else {
      setName('')
      setFunctionRole('secretary_morning')
      setUnit('all')
      setShift('morning')
      setDaysOfWeek([1,2,3,4,5])
      setDispatchTime('08:00')
      setThreshold(80)
      setItems([])
    }
    setNewItemText('')
  }, [open, template])

  const isValid = name.trim().length > 0
    && daysOfWeek.length > 0
    && threshold >= 0 && threshold <= 100

  const toggleDay = (n: number) =>
    setDaysOfWeek(prev =>
      prev.includes(n) ? prev.filter(d => d !== n) : [...prev, n].sort()
    )

  const moveItem = (index: number, dir: -1 | 1) => {
    setItems(prev => {
      const next = [...prev]
      const target = index + dir
      if (target < 0 || target >= next.length) return prev
      ;[next[index], next[target]] = [next[target], next[index]]
      return next.map((item, i) => ({ ...item, sort_order: i + 1 }))
    })
  }

  const deleteItem = (index: number) => {
    setItems(prev => prev.filter((_, i) => i !== index))
  }

  const addItem = () => {
    const text = newItemText.trim()
    if (!text) return
    setItems(prev => [...prev, {
      description: text,
      sort_order: prev.length + 1,
      is_active: true,
    }])
    setNewItemText('')
  }

  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        name: name.trim(),
        function_role: functionRole,
        unit,
        shift,
        days_of_week: daysOfWeek,
        dispatch_time: dispatchTime,
        completion_threshold: threshold,
        is_active: true,
        updated_by: collaborator!.id,
        ...(template ? { id: template.id } : {}),
      }

      const { data: saved, error: upsertErr } = await supabase
        .from('op_checklists')
        .upsert(payload)
        .select('id')
        .single()
      if (upsertErr) throw upsertErr

      // Soft-delete itens removidos
      if (template) {
        const existingIds = (template.op_checklist_items ?? [])
          .filter(i => i.is_active !== false)
          .map(i => i.id)
        const keepIds = new Set(items.filter(i => i.id).map(i => i.id!))
        const removedIds = existingIds.filter(id => !keepIds.has(id))
        for (const rid of removedIds) {
          await supabase
            .from('op_checklist_items')
            .update({ is_active: false, updated_by: collaborator!.id })
            .eq('id', rid)
        }
      }

      // Upsert itens ativos
      for (let i = 0; i < items.length; i++) {
        const item = items[i]
        const itemPayload = {
          checklist_id: saved.id,
          description: item.description,
          sort_order: i + 1,
          is_active: true,
          updated_by: collaborator!.id,
          ...(item.id ? { id: item.id } : {}),
        }
        const { error } = await supabase
          .from('op_checklist_items')
          .upsert(itemPayload)
        if (error) throw error
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['checklists-templates'] })
      onClose()
    },
  })

  return (
    <BottomSheet open={open} onClose={onClose}
      title={template ? 'Editar template' : 'Novo template'}>
      <div className="space-y-4 pb-4">

        {/* Nome */}
        <div>
          <label className="text-caption text-fg-muted block mb-1">Nome *</label>
          <input
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            maxLength={80}
            placeholder="ex: Abertura Escola"
            className="w-full bg-bg-surface border border-border rounded-lg px-3 py-2
                       text-body text-fg focus:outline-none focus:border-brand"
          />
        </div>

        {/* Função */}
        <div>
          <label className="text-caption text-fg-muted block mb-1">Função *</label>
          <select
            value={functionRole}
            onChange={e => setFunctionRole(e.target.value)}
            className="w-full bg-bg-surface border border-border rounded-lg px-3 py-2
                       text-body text-fg focus:outline-none focus:border-brand"
          >
            {FUNCTION_ROLES.map(r => (
              <option key={r.value} value={r.value}>{r.label}</option>
            ))}
          </select>
        </div>

        {/* Unidade + Turno */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-caption text-fg-muted block mb-1">Unidade *</label>
            <select
              value={unit}
              onChange={e => setUnit(e.target.value)}
              className="w-full bg-bg-surface border border-border rounded-lg px-3 py-2
                         text-body-sm text-fg focus:outline-none focus:border-brand"
            >
              {UNITS.map(u => (
                <option key={u.value} value={u.value}>{u.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-caption text-fg-muted block mb-1">Turno *</label>
            <select
              value={shift}
              onChange={e => setShift(e.target.value)}
              className="w-full bg-bg-surface border border-border rounded-lg px-3 py-2
                         text-body-sm text-fg focus:outline-none focus:border-brand"
            >
              {SHIFTS.map(s => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Dias da semana */}
        <div>
          <label className="text-caption text-fg-muted block mb-2">Dias *</label>
          <div className="flex gap-1.5 flex-wrap">
            {DAYS.map(d => (
              <button
                key={d.n}
                type="button"
                onClick={() => toggleDay(d.n)}
                className={[
                  'px-2.5 py-1 rounded-lg text-caption font-medium transition-colors',
                  daysOfWeek.includes(d.n)
                    ? 'bg-brand text-white'
                    : 'bg-bg-surface border border-border text-fg-muted',
                ].join(' ')}
              >
                {d.label}
              </button>
            ))}
          </div>
        </div>

        {/* Horário + Threshold */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-caption text-fg-muted block mb-1">Horário *</label>
            <input
              type="time"
              value={dispatchTime}
              onChange={e => setDispatchTime(e.target.value)}
              className="w-full bg-bg-surface border border-border rounded-lg px-3 py-2
                         text-body-sm text-fg focus:outline-none focus:border-brand"
            />
          </div>
          <div>
            <label className="text-caption text-fg-muted block mb-1">
              Threshold (%) *
            </label>
            <input
              type="number"
              min={0} max={100}
              value={threshold}
              onChange={e => setThreshold(Number(e.target.value))}
              className="w-full bg-bg-surface border border-border rounded-lg px-3 py-2
                         text-body-sm text-fg focus:outline-none focus:border-brand"
            />
          </div>
        </div>

        {/* Itens */}
        <div>
          <label className="text-caption text-fg-muted block mb-2">
            Itens ({items.length})
          </label>
          <div className="space-y-0.5">
            {items.map((item, index) => (
              <ChecklistItemEditRow
                key={index}
                description={item.description}
                index={index + 1}
                isFirst={index === 0}
                isLast={index === items.length - 1}
                onMoveUp={() => moveItem(index, -1)}
                onMoveDown={() => moveItem(index, 1)}
                onChange={val =>
                  setItems(prev =>
                    prev.map((it, i) => i === index ? { ...it, description: val } : it)
                  )
                }
                onDelete={() => deleteItem(index)}
              />
            ))}
          </div>
          <div className="flex gap-2 mt-2">
            <input
              type="text"
              value={newItemText}
              onChange={e => setNewItemText(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && addItem()}
              placeholder="Adicionar item..."
              className="flex-1 bg-bg-surface border border-border rounded-lg px-3 py-1.5
                         text-body-sm text-fg focus:outline-none focus:border-brand"
            />
            <button
              type="button"
              onClick={addItem}
              className="px-3 py-1.5 bg-brand text-white rounded-lg text-body-sm font-medium"
            >
              +
            </button>
          </div>
        </div>

        {/* Ações */}
        {saveMutation.isError && (
          <p className="text-danger text-caption">
            Erro ao salvar. Verifique sua conexão e tente novamente.
          </p>
        )}
        <button
          type="button"
          onClick={() => saveMutation.mutate()}
          disabled={!isValid || saveMutation.isPending}
          className="w-full py-3 bg-brand text-white rounded-xl font-semibold
                     disabled:opacity-40 disabled:cursor-not-allowed transition-opacity"
        >
          {saveMutation.isPending ? 'Salvando...' : 'Salvar template'}
        </button>
      </div>
    </BottomSheet>
  )
}
```

- [ ] **Step 3: TypeScript check**

```bash
cd D:\la-organizer\_remote\web && npx tsc --noEmit 2>&1 | grep "ChecklistTemplateSheet" | head -5
```

**Esperado:** 0 erros.

---

## Task 8: ChecklistsTemplates Screen

**Files:**
- Create: `D:\la-organizer\_remote\web\src\screens\ChecklistsTemplates.tsx`

Antes de criar, leia `web/src/screens/Projetos.tsx` para referência de lista com FAB e cards.

- [ ] **Step 1: Criar `ChecklistsTemplates.tsx`**

```tsx
// web/src/screens/ChecklistsTemplates.tsx
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Archive, ArchiveRestore, Pencil } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { ChecklistTemplateSheet } from '../components/ChecklistTemplateSheet'
import type { OpChecklistTemplate, OpChecklistAudit } from '../types'

type TemplateWithMeta = OpChecklistTemplate & {
  op_checklist_items: OpChecklistTemplate['op_checklist_items'] // typed via join
  last_audit?: Pick<OpChecklistAudit, 'changed_at'> & {
    collaborator?: { full_name: string }
  }
}

export function ChecklistsTemplates() {
  const { collaborator } = useAuth()
  const queryClient = useQueryClient()
  const [showArchived, setShowArchived] = useState(false)
  const [sheetTemplate, setSheetTemplate] = useState<OpChecklistTemplate | null | undefined>(
    undefined  // undefined=fechado, null=criar, object=editar
  )

  const { data: templates = [], isLoading } = useQuery<TemplateWithMeta[]>({
    queryKey: ['checklists-templates', showArchived],
    queryFn: async () => {
      // Step 1: buscar templates + itens
      const tQuery = supabase
        .from('op_checklists')
        .select('*, op_checklist_items ( id, description, sort_order, is_active )')
        .order('name')
      if (!showArchived) tQuery.eq('is_active', true)
      const { data: tData, error: tErr } = await tQuery
      if (tErr) throw tErr
      const rows = (tData ?? []) as TemplateWithMeta[]

      // Step 2: buscar último audit por template (Supabase não suporta limit em relação aninhada)
      const ids = rows.map(r => r.id)
      if (ids.length === 0) return rows
      const { data: audits } = await supabase
        .from('op_checklists_audit')
        .select('template_id, changed_at, collaborator:collaborators(full_name)')
        .in('template_id', ids)
        .order('changed_at', { ascending: false })

      // Pegar o mais recente por template_id
      const latestAudit = new Map<string, typeof audits extends null ? never : (typeof audits)[0]>()
      for (const a of (audits ?? [])) {
        if (!latestAudit.has(a.template_id)) latestAudit.set(a.template_id, a)
      }
      return rows.map(r => ({ ...r, last_audit: latestAudit.get(r.id) }))
    },
  })

  const archiveMutation = useMutation({
    mutationFn: async ({ id, activate }: { id: string; activate: boolean }) => {
      const { error } = await supabase
        .from('op_checklists')
        .update({ is_active: activate, updated_by: collaborator!.id })
        .eq('id', id)
      if (error) throw error
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['checklists-templates'] }),
  })

  if (isLoading) {
    return (
      <div className="p-4 space-y-3">
        {[1,2,3].map(i => (
          <div key={i} className="bg-bg-surface rounded-xl h-20 animate-pulse" />
        ))}
      </div>
    )
  }

  return (
    <div className="p-4 space-y-4 max-w-content mx-auto pb-28">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-heading-sm font-bold text-fg">Templates de Checklist</h1>
        <button
          type="button"
          onClick={() => setShowArchived(v => !v)}
          className="text-caption text-fg-muted underline"
        >
          {showArchived ? 'Ocultar arquivados' : 'Mostrar arquivados'}
        </button>
      </div>

      {templates.length === 0 && (
        <div className="text-center text-fg-muted py-12">
          <p className="text-body">Nenhum template{showArchived ? '' : ' ativo'}.</p>
          <p className="text-body-sm mt-1">Use o + para criar o primeiro.</p>
        </div>
      )}

      {/* Template cards */}
      {templates.map(t => {
        const activeItems = (t.op_checklist_items ?? []).filter(i => i.is_active !== false)
        const lastAudit = Array.isArray(t.last_audit) ? t.last_audit[0] : t.last_audit
        const editorName = lastAudit?.collaborator?.full_name
        const editedAt = lastAudit?.changed_at
          ? new Date(lastAudit.changed_at).toLocaleDateString('pt-BR', { day:'2-digit', month:'short' })
          : null

        return (
          <div key={t.id}
            className={[
              'bg-bg-surface rounded-xl border border-border p-4',
              !t.is_active ? 'opacity-60' : '',
            ].join(' ')}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1 min-w-0">
                <p className="text-body font-semibold text-fg truncate">{t.name}</p>
                <p className="text-caption text-fg-muted">
                  {t.function_role} · {t.unit} · {t.shift} · {t.dispatch_time?.slice(0,5)}
                </p>
                <p className="text-caption text-fg-muted">
                  {activeItems.length} itens · threshold {t.completion_threshold}%
                </p>
                {editedAt && (
                  <p className="text-caption text-fg-muted mt-1">
                    Editado por {editorName ?? '—'} em {editedAt}
                  </p>
                )}
              </div>

              <div className="flex gap-1">
                {t.is_active && (
                  <button type="button"
                    onClick={() => setSheetTemplate(t)}
                    className="p-2 rounded-lg text-fg-muted hover:text-brand transition-colors"
                    aria-label="Editar"
                  >
                    <Pencil size={16} />
                  </button>
                )}
                <button type="button"
                  onClick={() => archiveMutation.mutate({ id: t.id, activate: !t.is_active })}
                  className="p-2 rounded-lg text-fg-muted hover:text-fg transition-colors"
                  aria-label={t.is_active ? 'Arquivar' : 'Reativar'}
                >
                  {t.is_active ? <Archive size={16} /> : <ArchiveRestore size={16} />}
                </button>
              </div>
            </div>
          </div>
        )
      })}

      {/* FAB */}
      <button
        type="button"
        onClick={() => setSheetTemplate(null)}
        className="fixed bottom-24 right-4 w-14 h-14 bg-brand rounded-full
                   flex items-center justify-center shadow-lg text-white
                   hover:bg-brand/90 transition-colors z-20"
        aria-label="Criar template"
      >
        <Plus size={24} />
      </button>

      {/* Sheet */}
      <ChecklistTemplateSheet
        open={sheetTemplate !== undefined}
        template={sheetTemplate ?? null}
        onClose={() => setSheetTemplate(undefined)}
      />
    </div>
  )
}
```

- [ ] **Step 2: TypeScript check**

```bash
cd D:\la-organizer\_remote\web && npx tsc --noEmit 2>&1 | grep "ChecklistsTemplates" | head -5
```

**Esperado:** 0 erros.

---

## Task 9: Mais.tsx + App.tsx

**Files:**
- Modify: `D:\la-organizer\_remote\web\src\screens\Mais.tsx`
- Modify: `D:\la-organizer\_remote\web\src\App.tsx`

- [ ] **Step 1: Ler `Mais.tsx` para entender a estrutura de `items`**

Confirmar: como o array de items é filtrado por role (se for). Linha 20 tem `{ to: '#', label: 'Checklists operacionais', hint: 'Por função e turno', status: 'soon' }`.

- [ ] **Step 2: Atualizar entrada em `Mais.tsx`**

Localize o item com `status: 'soon'` e `label: 'Checklists operacionais'`. Substitua por:

```ts
// SE o array é renderizado diretamente para todos:
// Trocar:
{ to: '#', label: 'Checklists operacionais', hint: 'Por função e turno', status: 'soon' },
// Por: (ativo, mas visível só para director/coordinator via renderização condicional)
{ to: '/mais/checklists-templates', label: 'Checklists operacionais', hint: 'Criar e gerenciar templates', requireRole: ['director','coordinator'] },
```

Se o array não tiver `requireRole`, adicione a filtragem no JSX de renderização:
```tsx
// No componente, antes de mapear o array:
const { role } = useAuth()
const filteredItems = items.filter(item =>
  !item.requireRole || item.requireRole.includes(role ?? '')
)
// Usar filteredItems.map(...) em vez de items.map(...)
```

**Alternativa mais simples** (se o array de items não tiver tipagem fácil de estender): renderizar o item condicionalmente inline no JSX em vez de alterar o array.

- [ ] **Step 3: Adicionar rota em `App.tsx`**

Abra `web/src/App.tsx`. Adicione:

```tsx
// Import
import { ChecklistsTemplates } from './screens/ChecklistsTemplates';

// Rota (dentro de ProtectedRoute > AppShell, junto com as outras):
<Route path="mais/checklists-templates" element={<ChecklistsTemplates />} />
```

- [ ] **Step 4: Build de verificação**

```bash
cd D:\la-organizer\_remote\web && npm run build 2>&1 | tail -5
```

**Esperado:** `built in X.XXs` sem erros.

- [ ] **Step 5: Smoke test visual**

```
node -e "
const fs = require('fs');
const app = fs.readFileSync('D:/la-organizer/_remote/web/src/App.tsx','utf8');
console.log('route added:', app.includes('checklists-templates') ? 'YES' : 'NO');
const mais = fs.readFileSync('D:/la-organizer/_remote/web/src/screens/Mais.tsx','utf8');
console.log('EM BREVE removed:', !mais.includes(\"status: 'soon'\") ? 'YES' : 'STILL THERE');
console.log('new route in mais:', mais.includes('checklists-templates') ? 'YES' : 'NO');
"
```

---

## Task 10: E2E Validation

### 10.1 DB

- [ ] **Step 1: Verificar migration**

```sql
SELECT column_name FROM information_schema.columns
WHERE table_schema='public' AND table_name='op_checklists'
  AND column_name IN ('is_active','updated_by');
SELECT column_name FROM information_schema.columns
WHERE table_schema='public' AND table_name='op_checklist_items'
  AND column_name IN ('is_active','updated_by','updated_at');
SELECT table_name FROM information_schema.tables
WHERE table_name='op_checklists_audit';
-- Expected: 3 rows + 1 table
```

- [ ] **Step 2: Testar triggers ponta a ponta**

```sql
SELECT id AS collab_id FROM collaborators WHERE role='director' LIMIT 1;
SELECT id AS tpl_id FROM op_checklists WHERE name='Abertura Escola';

-- Archive e verificar audit
UPDATE op_checklists SET is_active=false, updated_by='<COLLAB_ID>'
WHERE id='<TPL_ID>';
SELECT action FROM op_checklists_audit
WHERE template_id='<TPL_ID>' ORDER BY changed_at DESC LIMIT 1;
-- Expected: 'deactivated'

-- Reativar
UPDATE op_checklists SET is_active=true, updated_by='<COLLAB_ID>'
WHERE id='<TPL_ID>';
SELECT action FROM op_checklists_audit
WHERE template_id='<TPL_ID>' ORDER BY changed_at DESC LIMIT 1;
-- Expected: 'activated'
```

- [ ] **Step 3: Testar item audit**

```sql
SELECT id FROM op_checklist_items WHERE checklist_id='<TPL_ID>' LIMIT 1;

-- item_removed via soft delete
UPDATE op_checklist_items
SET is_active=false, updated_by='<COLLAB_ID>'
WHERE id='<ITEM_ID>';
SELECT action, details FROM op_checklists_audit
WHERE template_id='<TPL_ID>' ORDER BY changed_at DESC LIMIT 1;
-- Expected: action='item_removed'

-- Reverter
UPDATE op_checklist_items SET is_active=true, updated_by=NULL WHERE id='<ITEM_ID>';
```

### 10.2 PWA — Testes manuais (no Simple Browser)

- [ ] **Step 4: Lista de testes manuais**

```
MANUAL TESTS (requer PWA rodando em localhost:4173):

1. Logar como director:
   → Menu /mais → "Checklists operacionais" → link ativo (não "EM BREVE")

2. Clicar → abre /mais/checklists-templates:
   → 4 templates existentes aparecem (Abertura, Fechamento, Fiscalização, Limpeza)
   → FAB + visível no canto

3. Clicar + → sheet abre em modo "Criar":
   → Campos vazios, threshold=80, dias seg-sex selecionados

4. Preencher nome "Teste Sprint 2", escolher função, clicar Salvar:
   → Toast/sheet fecha, template aparece na lista
   → DB: SELECT * FROM op_checklists WHERE name='Teste Sprint 2' — deve existir
   → DB: SELECT * FROM op_checklists_audit WHERE details->>'name'='Teste Sprint 2'
         → action='created', changed_by não null

5. Clicar ✏️ Editar no novo template:
   → Sheet abre pre-preenchida com valores corretos

6. Alterar nome para "Teste Sprint 2 Editado", Salvar:
   → Nome atualiza no card
   → Card mostra "Editado por [nome] em [data]"

7. Clicar arquivo (Archive) no template:
   → Desaparece da lista
   → Toggle "Mostrar arquivados" → reaparece com opacity menor
   → Botão mostra ArchiveRestore (Reativar)

8. Reativar → volta para lista ativa

9. Adicionar/remover item dentro de um template existente (Abertura Escola):
   → Itens aparecem na sheet
   → ↑/↓ funcionam; primeiro item tem ↑ desabilitado
   → Salvar → DB: op_checklist_items atualizado

10. Logar como colaborador comum (não director/coordinator):
    → /mais NÃO mostra "Checklists operacionais"
    → Tentar navegar direto para /mais/checklists-templates → redirect ou blank

11. Verificar que /checklists (Sprint 1) ainda funciona normalmente:
    → Nenhuma regressão
```

- [ ] **Step 5: Build final + restart**

```bash
cd D:\la-organizer\_remote\web && npm run build 2>&1 | tail -3
# No VPS quando sincronizar: pm2 restart LA-Organizer
```

---

## Checklist pós-implementação

- [ ] Migration aplicada: `updated_by` + `is_active` em items + `op_checklists_audit`
- [ ] Triggers funcionando: `trg_op_checklists_audit` + `trg_op_checklist_items_audit`
- [ ] RLS: SELECT todos, write só director/coordinator
- [ ] Sprint 1 patch: `is_active=true` filtrado em dispatcher + system.js
- [ ] `ChecklistItemEditRow` criado com ↑/↓ funcionando
- [ ] `ChecklistTemplateSheet` criado — criar + editar + gerenciar itens
- [ ] `ChecklistsTemplates` — lista + FAB + archive + "editado por"
- [ ] `Mais.tsx` — link ativo + visível só para director/coordinator
- [ ] `App.tsx` — rota `/mais/checklists-templates`
- [ ] Build limpo + 0 erros TypeScript
- [ ] Testes manuais 1–10 executados no Simple Browser
