# Checklists Desktop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesenhar página `/checklists` para desktop (mantendo mobile intocado), adicionar recorrência em listas pessoais, anexos, tarefa derivada, justificativas + ampliar TOM com 3 skills novas + sync bidirecional realtime.

**Architecture:** Dispatcher por breakpoint (`Checklists.tsx` → mobile vs desktop). Desktop tem tabs Hoje | Aderência + rota separada `/checklists/templates`. Padrão "lista esquerda + drawer direito" coerente com Agenda/Tarefas/Projetos.

**Tech Stack:** React 18 + TypeScript + Vite + Tailwind (PWA). Node.js ESM (TOM engine). Supabase Postgres + RLS + Storage + Realtime. PM2 + UAZAPI para WhatsApp.

**Spec base:** `docs/superpowers/specs/2026-05-27-checklists-desktop-design.md`

---

## File Structure

### Frontend (web/src/)

**Criar:**
- `screens/checklists/ChecklistsDesktop.tsx` — dispatcher tabs + KPI strip
- `screens/checklists/HojeTab.tsx` — toggle Trabalho/Pessoal + lista
- `screens/checklists/AderenciaTab.tsx` — view toggle Cards/Tabela + filtros
- `screens/checklists/AderenciaCards.tsx` — grid de cards (donut+avatares+sparkline)
- `screens/checklists/AderenciaTabela.tsx` — tabela densa
- `screens/checklists/TemplatesPage.tsx` — rota `/checklists/templates`
- `screens/checklists/TemplateEditDrawer.tsx` — form edição template
- `screens/checklists/ChecklistExecucaoDrawer.tsx` — drawer direito execução
- `screens/checklists/KpiStripe.tsx` — faixa compacta 4 métricas
- `screens/checklists/RecurrenceField.tsx` — chips Uma vez/Diária/Semanal/Mensal
- `screens/checklists/ChecklistAttachments.tsx` — upload + thumbnail
- `screens/checklists/JustifyDialog.tsx` — modal justificativa
- `screens/checklists/DeriveTaskDialog.tsx` — modal criar tarefa derivada
- `screens/checklists/hooks/useChecklistsHoje.ts`
- `screens/checklists/hooks/useAderencia.ts`
- `screens/checklists/hooks/useTemplates.ts`
- `screens/checklists/hooks/useChecklistAttachments.ts`
- `screens/checklists/hooks/useDeriveTask.ts`

**Modificar:**
- `screens/Checklists.tsx` — vira dispatcher mobile/desktop, conteúdo atual move pra `screens/checklists/ChecklistsMobile.tsx` (criar novo)
- `App.tsx` — adicionar rota `/checklists/templates`
- `lib/personalChecklists.ts` — funções com recurrence_type

### Backend (src/)

**Criar:**
- `src/skills-extended/checklist-anexo.md` — skill nova
- `src/skills-extended/checklist-tarefa-derivada.md` — skill nova
- `src/skills-extended/checklist-justificar.md` — skill nova

**Modificar:**
- `src/engine.js` — parsers de 3 markers novos + integração com tasks/storage
- `src/rituals/dispatcher.js` — função `dispatchPersonalRecurrentes()`
- `src/realtime/tom-realtime.js` — subscriber em item_completions + attachments
- `skills/checklists-operacionais.md` — referenciar novos markers

### Database

**Criar migrations:**
- `supabase/migrations/20260527010000_personal_checklists_recurrence.sql`
- `supabase/migrations/20260527010100_personal_checklist_completions.sql`
- `supabase/migrations/20260527010200_checklist_attachments.sql`
- `supabase/migrations/20260527010300_op_checklist_derived_task.sql`
- `supabase/migrations/20260527010400_personal_completion_derived_task.sql`
- `supabase/migrations/20260527010500_checklist_attachments_rls.sql`
- `supabase/migrations/20260527010600_storage_bucket_checklist_attachments.sql`

---

## Validation Pattern (each sprint ends with this)

1. `cd web && npx tsc --noEmit` → zero erros
2. `cd web && npx vite build` → zero warnings críticos
3. Backend: `node --check src/<arquivo>.js` (se mexeu em src/)
4. Chrome MCP smoke test (Simple Browser navegando + screenshots)
5. Commit + push (auto-deploy hook leva pro Vercel)
6. SCP src/* + `pm2 restart tom` (se sprint mexeu no engine)
7. Aprovação humana antes da próxima sprint

---

# Sprint 1 — Migrations + Storage Bucket

**Goal:** Aplicar todas as migrations no Supabase e criar bucket Storage. Sem código de frontend nem backend ainda.

### Task 1.1: Migration — recorrência em personal_checklists

**Files:**
- Create: `supabase/migrations/20260527010000_personal_checklists_recurrence.sql`

- [ ] **Step 1: Escrever migration**

```sql
-- 20260527010000_personal_checklists_recurrence.sql
-- Adiciona campos de recorrência em listas pessoais

ALTER TABLE personal_checklists
  ADD COLUMN IF NOT EXISTS recurrence_type text NOT NULL DEFAULT 'once'
    CHECK (recurrence_type IN ('once','daily','weekly','monthly')),
  ADD COLUMN IF NOT EXISTS days_of_week int[] NULL,
  ADD COLUMN IF NOT EXISTS day_of_month int NULL
    CHECK (day_of_month IS NULL OR (day_of_month BETWEEN 1 AND 31));

COMMENT ON COLUMN personal_checklists.recurrence_type IS 'once|daily|weekly|monthly';
COMMENT ON COLUMN personal_checklists.days_of_week IS 'Array de 1-7 (dom-sáb) quando recurrence_type=weekly';
COMMENT ON COLUMN personal_checklists.day_of_month IS 'Dia 1-31 quando recurrence_type=monthly';

CREATE INDEX IF NOT EXISTS idx_personal_checklists_recurrence
  ON personal_checklists (recurrence_type)
  WHERE recurrence_type != 'once';
```

- [ ] **Step 2: Aplicar via Supabase MCP**

Tool: `mcp__4c04bb52-f946-4fe8-85f6-b01d200f8c20__apply_migration`
Args: `{ project_id: "cesnbnrynvxvgdhfmaua", name: "personal_checklists_recurrence", query: "<SQL acima>" }`

- [ ] **Step 3: Validar schema**

Tool: `mcp__4c04bb52-f946-4fe8-85f6-b01d200f8c20__execute_sql`
Query:
```sql
SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_name='personal_checklists'
  AND column_name IN ('recurrence_type','days_of_week','day_of_month');
```
Expected: 3 linhas retornadas.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260527010000_personal_checklists_recurrence.sql
git commit -m "feat(db): adiciona recorrência em personal_checklists"
```

---

### Task 1.2: Migration — tabelas de completions pessoais

**Files:**
- Create: `supabase/migrations/20260527010100_personal_checklist_completions.sql`

- [ ] **Step 1: Escrever migration**

```sql
-- 20260527010100_personal_checklist_completions.sql
-- Instâncias diárias de listas pessoais recorrentes

CREATE TABLE IF NOT EXISTS personal_checklist_completions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  checklist_id uuid NOT NULL REFERENCES personal_checklists(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  reference_date date NOT NULL,
  started_at timestamptz NULL,
  completed_at timestamptz NULL,
  channel text DEFAULT 'pwa' CHECK (channel IN ('pwa','whatsapp','cron')),
  created_at timestamptz DEFAULT now(),
  UNIQUE (checklist_id, user_id, reference_date)
);

CREATE TABLE IF NOT EXISTS personal_checklist_item_completions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  completion_id uuid NOT NULL REFERENCES personal_checklist_completions(id) ON DELETE CASCADE,
  item_id uuid NOT NULL REFERENCES personal_checklist_items(id) ON DELETE CASCADE,
  is_checked boolean NOT NULL DEFAULT false,
  checked_at timestamptz NULL,
  notes text NULL,
  created_at timestamptz DEFAULT now(),
  UNIQUE (completion_id, item_id)
);

CREATE INDEX IF NOT EXISTS idx_pcc_user_date
  ON personal_checklist_completions (user_id, reference_date DESC);
CREATE INDEX IF NOT EXISTS idx_pcic_completion
  ON personal_checklist_item_completions (completion_id);

-- RLS
ALTER TABLE personal_checklist_completions ENABLE ROW LEVEL SECURITY;
ALTER TABLE personal_checklist_item_completions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owner full access pcc" ON personal_checklist_completions
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Owner full access pcic" ON personal_checklist_item_completions
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM personal_checklist_completions pcc
      WHERE pcc.id = personal_checklist_item_completions.completion_id
        AND pcc.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM personal_checklist_completions pcc
      WHERE pcc.id = personal_checklist_item_completions.completion_id
        AND pcc.user_id = auth.uid()
    )
  );

GRANT ALL ON personal_checklist_completions TO authenticated;
GRANT ALL ON personal_checklist_item_completions TO authenticated;
```

- [ ] **Step 2: Aplicar via Supabase MCP**

`apply_migration(project_id: "cesnbnrynvxvgdhfmaua", name: "personal_checklist_completions", query: <SQL>)`

- [ ] **Step 3: Validar com SELECT**

```sql
SELECT table_name FROM information_schema.tables
WHERE table_schema='public'
  AND table_name IN ('personal_checklist_completions', 'personal_checklist_item_completions');
```
Expected: 2 linhas.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260527010100_personal_checklist_completions.sql
git commit -m "feat(db): cria tabelas de completions pessoais"
```

---

### Task 1.3: Migration — checklist_attachments

**Files:**
- Create: `supabase/migrations/20260527010200_checklist_attachments.sql`

- [ ] **Step 1: Escrever migration**

```sql
-- 20260527010200_checklist_attachments.sql
-- Anexos genéricos (work + personal) — scope text discrimina

CREATE TABLE IF NOT EXISTS checklist_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope text NOT NULL CHECK (scope IN ('work','personal')),
  item_completion_id uuid NOT NULL,
  storage_path text NOT NULL,
  file_name text NOT NULL,
  mime_type text NOT NULL,
  size_bytes bigint NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 10485760),
  uploaded_by uuid REFERENCES auth.users(id),
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_checklist_attachments_lookup
  ON checklist_attachments (scope, item_completion_id);

CREATE INDEX IF NOT EXISTS idx_checklist_attachments_uploader
  ON checklist_attachments (uploaded_by);

ALTER TABLE checklist_attachments ENABLE ROW LEVEL SECURITY;

GRANT ALL ON checklist_attachments TO authenticated;
```

- [ ] **Step 2: Aplicar via Supabase MCP**

`apply_migration` com SQL acima.

- [ ] **Step 3: Validar tabela criada**

```sql
SELECT column_name, data_type FROM information_schema.columns
WHERE table_name='checklist_attachments' ORDER BY ordinal_position;
```
Expected: 9 colunas.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260527010200_checklist_attachments.sql
git commit -m "feat(db): cria tabela checklist_attachments"
```

---

### Task 1.4: Migration — derived_task_id em work completions

**Files:**
- Create: `supabase/migrations/20260527010300_op_checklist_derived_task.sql`

- [ ] **Step 1: Escrever migration**

```sql
-- 20260527010300_op_checklist_derived_task.sql
-- Permite item de checklist gerar uma tarefa derivada

ALTER TABLE op_checklist_item_completions
  ADD COLUMN IF NOT EXISTS derived_task_id uuid NULL REFERENCES tasks(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_op_cic_derived_task
  ON op_checklist_item_completions (derived_task_id)
  WHERE derived_task_id IS NOT NULL;

COMMENT ON COLUMN op_checklist_item_completions.derived_task_id
  IS 'Task gerada a partir deste item (ex: lâmpada queimada → trocar lâmpada)';
```

- [ ] **Step 2: Aplicar via Supabase MCP**

- [ ] **Step 3: Validar coluna**

```sql
SELECT column_name FROM information_schema.columns
WHERE table_name='op_checklist_item_completions' AND column_name='derived_task_id';
```
Expected: 1 linha.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260527010300_op_checklist_derived_task.sql
git commit -m "feat(db): adiciona derived_task_id em op_checklist_item_completions"
```

---

### Task 1.5: Migration — derived_task_id em personal completions

**Files:**
- Create: `supabase/migrations/20260527010400_personal_completion_derived_task.sql`

- [ ] **Step 1: Escrever migration**

```sql
-- 20260527010400_personal_completion_derived_task.sql

ALTER TABLE personal_checklist_item_completions
  ADD COLUMN IF NOT EXISTS derived_task_id uuid NULL REFERENCES tasks(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_pcic_derived_task
  ON personal_checklist_item_completions (derived_task_id)
  WHERE derived_task_id IS NOT NULL;
```

- [ ] **Step 2: Aplicar**
- [ ] **Step 3: Validar**

```sql
SELECT column_name FROM information_schema.columns
WHERE table_name='personal_checklist_item_completions' AND column_name='derived_task_id';
```
Expected: 1 linha.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260527010400_personal_completion_derived_task.sql
git commit -m "feat(db): adiciona derived_task_id em personal_checklist_item_completions"
```

---

### Task 1.6: Bucket Supabase Storage + RLS

**Files:**
- Create: `supabase/migrations/20260527010500_checklist_attachments_rls.sql`
- Create: `supabase/migrations/20260527010600_storage_bucket_checklist_attachments.sql`

- [ ] **Step 1: Escrever migration RLS de checklist_attachments**

```sql
-- 20260527010500_checklist_attachments_rls.sql

-- SELECT: dono do completion (work ou personal)
CREATE POLICY "Owner reads attachments" ON checklist_attachments
  FOR SELECT TO authenticated
  USING (
    (scope = 'work' AND EXISTS (
      SELECT 1 FROM op_checklist_item_completions oic
      JOIN op_checklist_completions occ ON occ.id = oic.completion_id
      WHERE oic.id = checklist_attachments.item_completion_id
        AND occ.collaborator_id = auth.uid()
    ))
    OR
    (scope = 'personal' AND EXISTS (
      SELECT 1 FROM personal_checklist_item_completions pic
      JOIN personal_checklist_completions pcc ON pcc.id = pic.completion_id
      WHERE pic.id = checklist_attachments.item_completion_id
        AND pcc.user_id = auth.uid()
    ))
  );

-- INSERT: dono pode anexar
CREATE POLICY "Owner inserts attachments" ON checklist_attachments
  FOR INSERT TO authenticated
  WITH CHECK (
    uploaded_by = auth.uid()
    AND (
      (scope = 'work' AND EXISTS (
        SELECT 1 FROM op_checklist_item_completions oic
        JOIN op_checklist_completions occ ON occ.id = oic.completion_id
        WHERE oic.id = checklist_attachments.item_completion_id
          AND occ.collaborator_id = auth.uid()
      ))
      OR
      (scope = 'personal' AND EXISTS (
        SELECT 1 FROM personal_checklist_item_completions pic
        JOIN personal_checklist_completions pcc ON pcc.id = pic.completion_id
        WHERE pic.id = checklist_attachments.item_completion_id
          AND pcc.user_id = auth.uid()
      ))
    )
  );

-- DELETE: uploader pode remover
CREATE POLICY "Uploader deletes own attachment" ON checklist_attachments
  FOR DELETE TO authenticated
  USING (uploaded_by = auth.uid());

-- Leadership pode SELECT em work
CREATE POLICY "Leadership reads work attachments" ON checklist_attachments
  FOR SELECT TO authenticated
  USING (
    scope = 'work'
    AND current_collab_role() = ANY (ARRAY['director','coordinator','manager'])
  );
```

- [ ] **Step 2: Aplicar RLS migration**

- [ ] **Step 3: Escrever migration de bucket**

```sql
-- 20260527010600_storage_bucket_checklist_attachments.sql

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'checklist-attachments',
  'checklist-attachments',
  false,
  10485760,
  ARRAY['image/jpeg','image/png','image/webp','application/pdf']
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Storage RLS — só dono lê/escreve em seu próprio path
CREATE POLICY "Authenticated upload to checklist-attachments"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'checklist-attachments'
    AND auth.uid()::text = (storage.foldername(name))[2]
  );

CREATE POLICY "Authenticated read own files in checklist-attachments"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'checklist-attachments'
    AND auth.uid()::text = (storage.foldername(name))[2]
  );

CREATE POLICY "Authenticated delete own files in checklist-attachments"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'checklist-attachments'
    AND auth.uid()::text = (storage.foldername(name))[2]
  );
```

Path pattern: `{scope}/{user_uuid}/{item_completion_id}/{uuid}-{filename}`

- [ ] **Step 4: Aplicar bucket migration**

- [ ] **Step 5: Validar bucket existe**

```sql
SELECT id, public, file_size_limit, allowed_mime_types
FROM storage.buckets WHERE id = 'checklist-attachments';
```
Expected: 1 linha.

- [ ] **Step 6: Commit ambas migrations**

```bash
git add supabase/migrations/20260527010500_checklist_attachments_rls.sql \
        supabase/migrations/20260527010600_storage_bucket_checklist_attachments.sql
git commit -m "feat(db): RLS em checklist_attachments + bucket Storage"
```

---

### Task 1.7: Validação final Sprint 1

- [ ] **Step 1: Verificar todas as 7 migrations aplicadas**

```sql
SELECT name FROM supabase_migrations.schema_migrations
WHERE name LIKE '20260527%'
ORDER BY name;
```
Expected: 7 linhas com nomes 20260527010000 a 20260527010600.

- [ ] **Step 2: Push final do Sprint 1**

```bash
git push origin main
```

Auto-deploy hook leva ao Vercel mas como não tem código de frontend novo, nada quebra.

- [ ] **Step 3: Reportar ao usuário**

"Sprint 1 concluído. 7 migrations aplicadas. Esperando OK pra Sprint 2."

---

# Sprint 2 — Dispatcher + Tela Hoje (estrutura)

**Goal:** Criar dispatcher mobile/desktop, montar tela desktop com tabs Hoje | Aderência, KpiStripe e HojeTab funcional (toggle Trabalho|Pessoal + lista, sem drawer ainda).

### Task 2.1: Mover mobile pra `ChecklistsMobile.tsx`

**Files:**
- Modify: `web/src/screens/Checklists.tsx` (existente, vai virar dispatcher)
- Create: `web/src/screens/checklists/ChecklistsMobile.tsx` (versão atual)

- [ ] **Step 1: Criar pasta de destino**

```bash
mkdir -p web/src/screens/checklists/hooks
```

- [ ] **Step 2: Copiar conteúdo atual de `Checklists.tsx` pra `checklists/ChecklistsMobile.tsx`**

Use Bash:
```bash
cp web/src/screens/Checklists.tsx web/src/screens/checklists/ChecklistsMobile.tsx
```

- [ ] **Step 3: Renomear export em `ChecklistsMobile.tsx`**

Use Edit:
- Find: `export function Checklists()`
- Replace: `export function ChecklistsMobile()`

Se tiver export default ou outras assinaturas, ajustar todas pra `ChecklistsMobile`.

- [ ] **Step 4: Reescrever `screens/Checklists.tsx` como dispatcher**

```tsx
import { useBreakpoint } from '../hooks/useBreakpoint';
import { ChecklistsMobile } from './checklists/ChecklistsMobile';
import { ChecklistsDesktop } from './checklists/ChecklistsDesktop';

export function Checklists() {
  const bp = useBreakpoint();
  if (bp === 'mobile') return <ChecklistsMobile />;
  return <ChecklistsDesktop />;
}
```

- [ ] **Step 5: TypeScript compila (vai falhar, ChecklistsDesktop ainda não existe — esperado)**

```bash
cd web && npx tsc --noEmit
```

Expected: erro em `Cannot find module './checklists/ChecklistsDesktop'`. Vai resolver na Task 2.2.

---

### Task 2.2: Criar `ChecklistsDesktop.tsx` stub

**Files:**
- Create: `web/src/screens/checklists/ChecklistsDesktop.tsx`

- [ ] **Step 1: Stub mínimo com tabs**

```tsx
import { useState } from 'react';
import { PageShell } from '../../design/shell/PageShell';
import { KpiStripe } from './KpiStripe';
import { HojeTab } from './HojeTab';
import { AderenciaTab } from './AderenciaTab';

type Tab = 'hoje' | 'aderencia';

export function ChecklistsDesktop() {
  const [tab, setTab] = useState<Tab>('hoje');

  return (
    <PageShell>
      <div className="flex flex-col h-full">
        <header className="px-6 pt-6 pb-2">
          <h1 className="text-fg text-2xl font-bold">Checklists</h1>
        </header>

        <KpiStripe />

        <div className="border-b border-border px-6 flex items-center gap-1">
          <TabButton active={tab === 'hoje'} onClick={() => setTab('hoje')}>
            Hoje
          </TabButton>
          <TabButton active={tab === 'aderencia'} onClick={() => setTab('aderencia')}>
            Aderência
          </TabButton>
          <a
            href="/checklists/templates"
            className="ml-auto text-fg/60 hover:text-tom p-2"
            title="Gerenciar templates"
          >
            ⚙️
          </a>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto">
          {tab === 'hoje' && <HojeTab />}
          {tab === 'aderencia' && <AderenciaTab />}
        </div>
      </div>
    </PageShell>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-2 text-sm font-semibold border-b-2 transition-colors ${
        active ? 'text-tom border-tom' : 'text-fg/60 border-transparent hover:text-fg'
      }`}
    >
      {children}
    </button>
  );
}
```

- [ ] **Step 2: Criar stubs vazios pros componentes filhos**

`web/src/screens/checklists/KpiStripe.tsx`:
```tsx
export function KpiStripe() {
  return <div className="px-6 py-2 text-fg/40 text-sm">KpiStripe (em construção)</div>;
}
```

`web/src/screens/checklists/HojeTab.tsx`:
```tsx
export function HojeTab() {
  return <div className="p-6 text-fg/40">HojeTab (em construção)</div>;
}
```

`web/src/screens/checklists/AderenciaTab.tsx`:
```tsx
export function AderenciaTab() {
  return <div className="p-6 text-fg/40">AderenciaTab (em construção)</div>;
}
```

- [ ] **Step 3: TypeScript compila**

```bash
cd web && npx tsc --noEmit
```
Expected: zero erros.

- [ ] **Step 4: Build OK**

```bash
cd web && npx vite build
```
Expected: build sem erros, gera `dist/`.

- [ ] **Step 5: Commit**

```bash
git add web/src/screens/Checklists.tsx web/src/screens/checklists/
git commit -m "feat(checklists): dispatcher mobile/desktop + stubs de tabs"
```

---

### Task 2.3: Hook `useChecklistsHoje`

**Files:**
- Create: `web/src/screens/checklists/hooks/useChecklistsHoje.ts`

- [ ] **Step 1: Implementar hook**

```ts
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../../../lib/supabaseClient';

export interface ChecklistItem {
  id: string;
  description: string;
  sort_order: number;
  is_checked: boolean;
  notes: string | null;
}

export interface WorkChecklistHoje {
  scope: 'work';
  completion_id: string;
  checklist_id: string;
  name: string;
  dispatch_time: string | null;
  threshold: number;
  items: ChecklistItem[];
  extras: Array<{ id: string; description: string; is_checked: boolean; notes: string | null }>;
  completed_at: string | null;
  dispatched_at: string | null;
  reference_date: string;
}

export interface PersonalChecklistHoje {
  scope: 'personal';
  completion_id: string | null; // null se "once" não-iniciada
  checklist_id: string;
  name: string;
  type: string; // shopping|travel|meds|general
  recurrence_type: 'once' | 'daily' | 'weekly' | 'monthly';
  items: ChecklistItem[];
  completed_at: string | null;
  reference_date: string;
}

export type ChecklistHoje = WorkChecklistHoje | PersonalChecklistHoje;

export function useChecklistsHoje() {
  return useQuery<{ work: WorkChecklistHoje[]; personal: PersonalChecklistHoje[] }>({
    queryKey: ['checklists-hoje'],
    queryFn: async () => {
      const today = new Date().toISOString().slice(0, 10);
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Não autenticado');

      // 1. Work: completions de hoje com itens + extras
      const { data: workComps, error: e1 } = await supabase
        .from('op_checklist_completions')
        .select(`
          id, checklist_id, reference_date, completed_at, dispatched_at,
          op_checklists!inner ( id, name, dispatch_time, completion_threshold,
            op_checklist_items ( id, description, sort_order, is_active )
          ),
          op_checklist_item_completions ( id, item_id, is_checked, notes ),
          op_checklist_completion_extra_items ( id, description, is_checked, notes, sort_order )
        `)
        .eq('reference_date', today)
        .eq('collaborator_id', user.id);

      if (e1) throw e1;

      const work: WorkChecklistHoje[] = (workComps || []).map((c: any) => {
        const tpl = c.op_checklists;
        const items: ChecklistItem[] = (tpl.op_checklist_items || [])
          .filter((it: any) => it.is_active)
          .sort((a: any, b: any) => a.sort_order - b.sort_order)
          .map((it: any) => {
            const ic = (c.op_checklist_item_completions || []).find((x: any) => x.item_id === it.id);
            return {
              id: it.id,
              description: it.description,
              sort_order: it.sort_order,
              is_checked: !!ic?.is_checked,
              notes: ic?.notes ?? null,
            };
          });
        const extras = (c.op_checklist_completion_extra_items || [])
          .sort((a: any, b: any) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
          .map((ex: any) => ({
            id: ex.id,
            description: ex.description,
            is_checked: !!ex.is_checked,
            notes: ex.notes ?? null,
          }));
        return {
          scope: 'work',
          completion_id: c.id,
          checklist_id: tpl.id,
          name: tpl.name,
          dispatch_time: tpl.dispatch_time,
          threshold: tpl.completion_threshold,
          items,
          extras,
          completed_at: c.completed_at,
          dispatched_at: c.dispatched_at,
          reference_date: c.reference_date,
        };
      });

      // 2. Personal: listas do user + completions de hoje
      const { data: personalLists, error: e2 } = await supabase
        .from('personal_checklists')
        .select(`
          id, name, type, recurrence_type, archived_at,
          personal_checklist_items ( id, description, sort_order, is_active ),
          personal_checklist_completions!left ( id, completed_at, started_at )
        `)
        .is('archived_at', null);

      if (e2) throw e2;

      const personal: PersonalChecklistHoje[] = (personalLists || []).map((l: any) => {
        const todayComp = (l.personal_checklist_completions || []).find(
          (c: any) => c.reference_date === today
        );
        const items: ChecklistItem[] = (l.personal_checklist_items || [])
          .filter((it: any) => it.is_active)
          .sort((a: any, b: any) => a.sort_order - b.sort_order)
          .map((it: any) => ({
            id: it.id,
            description: it.description,
            sort_order: it.sort_order,
            is_checked: false,
            notes: null,
          }));
        return {
          scope: 'personal',
          completion_id: todayComp?.id ?? null,
          checklist_id: l.id,
          name: l.name,
          type: l.type || 'general',
          recurrence_type: l.recurrence_type || 'once',
          items,
          completed_at: todayComp?.completed_at ?? null,
          reference_date: today,
        };
      });

      return { work, personal };
    },
    staleTime: 30_000,
  });
}
```

- [ ] **Step 2: TypeScript compila**

```bash
cd web && npx tsc --noEmit
```
Expected: zero erros.

- [ ] **Step 3: Commit**

```bash
git add web/src/screens/checklists/hooks/useChecklistsHoje.ts
git commit -m "feat(checklists): hook useChecklistsHoje (work + personal)"
```

---

### Task 2.4: KpiStripe (faixa compacta)

**Files:**
- Modify: `web/src/screens/checklists/KpiStripe.tsx`

- [ ] **Step 1: Implementar KpiStripe**

```tsx
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../../lib/supabaseClient';

interface KpiData {
  feitas: number;
  total: number;
  pendentes: number;
  atrasadas: number;
  aderenciaMes: number;
}

export function KpiStripe() {
  const { data, isLoading } = useQuery<KpiData>({
    queryKey: ['checklists-kpi'],
    queryFn: async () => {
      const today = new Date().toISOString().slice(0, 10);
      const monthAgo = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Sem usuário');

      // Hoje: feitas, pendentes, atrasadas
      const { data: hoje } = await supabase
        .from('op_checklist_completions')
        .select('id, completed_at, dispatched_at, op_checklists!inner(completion_threshold)')
        .eq('collaborator_id', user.id)
        .eq('reference_date', today);

      const sixHoursAgo = new Date(Date.now() - 6 * 3600000);
      let feitas = 0;
      let pendentes = 0;
      let atrasadas = 0;
      (hoje || []).forEach((c: any) => {
        if (c.completed_at) feitas++;
        else if (c.dispatched_at && new Date(c.dispatched_at) < sixHoursAgo) atrasadas++;
        else pendentes++;
      });

      // Mês: aderência
      const { data: mes } = await supabase
        .from('op_checklist_completions')
        .select('id, completed_at')
        .eq('collaborator_id', user.id)
        .gte('reference_date', monthAgo);
      const totalMes = mes?.length || 0;
      const completedMes = (mes || []).filter((c: any) => c.completed_at).length;
      const aderenciaMes = totalMes ? Math.round((completedMes / totalMes) * 100) : 0;

      return {
        feitas,
        total: hoje?.length || 0,
        pendentes,
        atrasadas,
        aderenciaMes,
      };
    },
    staleTime: 60_000,
  });

  if (isLoading || !data) {
    return <div className="mx-6 my-3 h-12 bg-bg-surface border border-border rounded-md animate-pulse" />;
  }

  return (
    <div className="mx-6 my-3 px-4 py-3 bg-bg-surface border border-border rounded-md flex items-center gap-6 text-sm">
      <div>
        <span className="text-tom font-bold text-base">{data.feitas}/{data.total}</span>
        <span className="text-fg/60 ml-1">feitas hoje</span>
      </div>
      <div>
        <span className="font-bold text-base">{data.pendentes}</span>
        <span className="text-fg/60 ml-1">pendentes</span>
      </div>
      <div className={data.atrasadas > 0 ? 'text-danger' : 'text-fg/60'}>
        <span className="font-bold text-base">{data.atrasadas}</span>
        <span className="ml-1">atrasada{data.atrasadas !== 1 ? 's' : ''}</span>
      </div>
      <div className="ml-auto text-fg/60">
        Aderência mês: <span className="text-fg font-bold">{data.aderenciaMes}%</span>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: TypeScript compila + build OK**

```bash
cd web && npx tsc --noEmit && npx vite build
```

- [ ] **Step 3: Commit**

```bash
git add web/src/screens/checklists/KpiStripe.tsx
git commit -m "feat(checklists): KpiStripe com métricas do dia + aderência mês"
```

---

### Task 2.5: HojeTab — toggle + lista

**Files:**
- Modify: `web/src/screens/checklists/HojeTab.tsx`

- [ ] **Step 1: Implementar HojeTab**

```tsx
import { useState } from 'react';
import { useChecklistsHoje, type WorkChecklistHoje, type PersonalChecklistHoje } from './hooks/useChecklistsHoje';

type Mode = 'work' | 'personal';

export function HojeTab() {
  const [mode, setMode] = useState<Mode>('work');
  const { data, isLoading } = useChecklistsHoje();
  const [openCompletionId, setOpenCompletionId] = useState<string | null>(null);

  if (isLoading || !data) {
    return <div className="p-6 text-fg/40">Carregando…</div>;
  }

  const list = mode === 'work' ? data.work : data.personal;
  const workCount = data.work.length;
  const personalCount = data.personal.length;

  return (
    <div className="flex h-full">
      {/* Coluna esquerda — lista */}
      <div className="flex-1 min-w-0 px-6 py-4">
        <div className="flex gap-2 mb-4">
          <Chip active={mode === 'work'} onClick={() => setMode('work')}>
            💼 Trabalho ({workCount})
          </Chip>
          <Chip active={mode === 'personal'} onClick={() => setMode('personal')}>
            🏡 Pessoal ({personalCount})
          </Chip>
        </div>

        {list.length === 0 ? (
          <EmptyList mode={mode} />
        ) : (
          <ul className="space-y-1">
            {list.map((c) => (
              <ChecklistRow
                key={`${c.scope}-${c.completion_id ?? c.checklist_id}`}
                checklist={c}
                onClick={() => setOpenCompletionId(c.completion_id ?? null)}
              />
            ))}
          </ul>
        )}
      </div>

      {/* Coluna direita — drawer execução (placeholder Sprint 3) */}
      <div className="w-[480px] border-l border-border bg-bg-surface p-6 hidden lg:block">
        {openCompletionId ? (
          <div className="text-fg/60">Drawer de execução virá na Sprint 3 (completion {openCompletionId})</div>
        ) : (
          <div className="text-fg/40 text-sm">Selecione um checklist à esquerda pra executar</div>
        )}
      </div>
    </div>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
        active ? 'bg-tom text-bg-app' : 'bg-bg-surface text-fg/70 hover:text-fg border border-border'
      }`}
    >
      {children}
    </button>
  );
}

function ChecklistRow({ checklist, onClick }: { checklist: WorkChecklistHoje | PersonalChecklistHoje; onClick: () => void }) {
  const totalItems = checklist.items.length + (checklist.scope === 'work' ? checklist.extras.length : 0);
  const doneItems = checklist.items.filter((i) => i.is_checked).length
    + (checklist.scope === 'work' ? checklist.extras.filter((e) => e.is_checked).length : 0);
  const isComplete = !!checklist.completed_at;
  const time = checklist.scope === 'work'
    ? (checklist.dispatch_time ? checklist.dispatch_time.slice(0, 5) : '—')
    : '—';

  return (
    <li>
      <button
        onClick={onClick}
        className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-md text-left hover:bg-bg-surface border border-transparent hover:border-border ${
          isComplete ? 'opacity-60' : ''
        }`}
      >
        <div className={`w-4 h-4 rounded border-2 ${isComplete ? 'bg-tom border-tom' : 'border-fg/40'}`} />
        <span className="text-xs text-fg/60 w-12">{time}</span>
        <span className="flex-1 text-sm">{checklist.name}</span>
        <span className="text-xs px-2 py-0.5 rounded-full bg-bg-app text-fg/60">
          {totalItems ? `${doneItems}/${totalItems}` : '0/0'}
        </span>
      </button>
    </li>
  );
}

function EmptyList({ mode }: { mode: Mode }) {
  return (
    <div className="text-fg/40 text-sm py-8 text-center">
      {mode === 'work'
        ? 'Sem checklists de trabalho hoje. Quando o TOM disparar algum, ele aparece aqui.'
        : 'Sem checklists pessoais hoje. Crie uma lista pra acompanhar suas rotinas.'}
    </div>
  );
}
```

- [ ] **Step 2: TypeScript + build OK**

```bash
cd web && npx tsc --noEmit && npx vite build
```

- [ ] **Step 3: Smoke test via Chrome MCP**

Tools: `mcp__Claude_Preview__preview_start`, `preview_eval`, `preview_screenshot`

1. Start preview ou ir pra `http://localhost:4173/checklists`
2. Resize 1440×900 (desktop)
3. Screenshot: deve mostrar header "Checklists" + KpiStripe + tabs + toggle Trabalho/Pessoal + lista
4. Resize 375×812 (mobile)
5. Screenshot: deve mostrar a versão mobile original (ChecklistsMobile)

- [ ] **Step 4: Commit + push**

```bash
git add web/src/screens/checklists/HojeTab.tsx
git commit -m "feat(checklists): HojeTab com toggle Trabalho/Pessoal + lista"
git push origin main
```

---

### Task 2.6: Validação final Sprint 2

- [ ] **Step 1: Chrome MCP — fluxo completo**

1. Navegar pra `/checklists` desktop
2. Validar título "Checklists" visível
3. Validar KpiStripe carrega
4. Validar tabs "Hoje" e "Aderência" presentes
5. Validar engrenagem ⚙️ no canto direito
6. Trocar pra tab "Aderência" → stub aparece
7. Voltar pra "Hoje" → lista carrega
8. Trocar mode Trabalho ↔ Pessoal → lista atualiza

- [ ] **Step 2: Pedir teste real ao usuário**

"Sprint 2 deployada (Vercel). Navega em `/checklists` no desktop e me confirma se vê: header, KpiStripe com métricas, tabs Hoje/Aderência, toggle Trabalho/Pessoal funcionando, lista de checklists do dia. OK pra Sprint 3?"

---

# Sprint 3 — Drawer de Execução (todas as 6 features)

**Goal:** Implementar `ChecklistExecucaoDrawer` com marcar item, nota inline, item ad-hoc, foto/anexo, criar tarefa derivada e justificar não-execução.

### Task 3.1: Componente base do drawer + estrutura

**Files:**
- Create: `web/src/screens/checklists/ChecklistExecucaoDrawer.tsx`

- [ ] **Step 1: Implementar shell do drawer**

```tsx
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { WorkChecklistHoje, PersonalChecklistHoje, ChecklistItem } from './hooks/useChecklistsHoje';
import { ChecklistItemRow } from './ChecklistItemRow';
import { JustifyDialog } from './JustifyDialog';

interface Props {
  checklist: WorkChecklistHoje | PersonalChecklistHoje;
  onClose: () => void;
}

export function ChecklistExecucaoDrawer({ checklist, onClose }: Props) {
  const [showJustify, setShowJustify] = useState(false);
  const qc = useQueryClient();

  const totalItems = checklist.items.length + (checklist.scope === 'work' ? checklist.extras.length : 0);
  const doneItems = checklist.items.filter((i) => i.is_checked).length
    + (checklist.scope === 'work' ? checklist.extras.filter((e) => e.is_checked).length : 0);
  const pct = totalItems ? Math.round((doneItems / totalItems) * 100) : 0;

  return (
    <div className="flex flex-col h-full">
      <header className="px-4 py-3 border-b border-border flex items-center gap-3">
        <div className="flex-1 min-w-0">
          <h2 className="text-fg font-semibold truncate">{checklist.name}</h2>
          <div className="text-xs text-fg/60">{doneItems}/{totalItems} ({pct}%)</div>
        </div>
        <button onClick={onClose} className="text-fg/60 hover:text-fg" aria-label="Fechar">✕</button>
      </header>

      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-1">
        {checklist.items.map((item) => (
          <ChecklistItemRow
            key={item.id}
            scope={checklist.scope}
            completionId={checklist.completion_id}
            item={item}
            onChanged={() => qc.invalidateQueries({ queryKey: ['checklists-hoje'] })}
          />
        ))}

        {checklist.scope === 'work' && checklist.extras.map((extra) => (
          <ExtraItemRow
            key={extra.id}
            completionId={checklist.completion_id}
            extra={extra}
            onChanged={() => qc.invalidateQueries({ queryKey: ['checklists-hoje'] })}
          />
        ))}

        <AddAdHocItemButton
          scope={checklist.scope}
          completionId={checklist.completion_id}
          onAdded={() => qc.invalidateQueries({ queryKey: ['checklists-hoje'] })}
        />
      </div>

      {checklist.scope === 'work' && (
        <footer className="border-t border-border p-3 flex gap-2">
          <button
            onClick={() => setShowJustify(true)}
            className="text-xs px-3 py-1.5 rounded-md border border-border text-fg/70 hover:text-fg"
          >
            Justificar
          </button>
        </footer>
      )}

      {showJustify && checklist.scope === 'work' && checklist.completion_id && (
        <JustifyDialog
          completionId={checklist.completion_id}
          onClose={() => setShowJustify(false)}
          onJustified={() => {
            qc.invalidateQueries({ queryKey: ['checklists-hoje'] });
            setShowJustify(false);
          }}
        />
      )}
    </div>
  );
}

// Placeholder componentes — virão nas próximas tasks
function ExtraItemRow(_p: any) { return null; }
function AddAdHocItemButton(_p: any) { return null; }
```

- [ ] **Step 2: Plugar drawer no HojeTab**

Edit em `HojeTab.tsx`:
- Find: `<div className="text-fg/60">Drawer de execução virá na Sprint 3 (completion {openCompletionId})</div>`
- Replace: 
```tsx
{(() => {
  const selected = [...data.work, ...data.personal].find(c => (c.completion_id ?? c.checklist_id) === openCompletionId);
  if (!selected) return <div className="text-fg/40 text-sm">Selecione um checklist à esquerda pra executar</div>;
  return <ChecklistExecucaoDrawer checklist={selected} onClose={() => setOpenCompletionId(null)} />;
})()}
```

Adicione no topo:
```tsx
import { ChecklistExecucaoDrawer } from './ChecklistExecucaoDrawer';
```

- [ ] **Step 3: TS compila (com stubs de Item/Extra ainda vazios — esperado warning)**

```bash
cd web && npx tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
git add web/src/screens/checklists/ChecklistExecucaoDrawer.tsx web/src/screens/checklists/HojeTab.tsx
git commit -m "feat(checklists): shell do drawer de execução"
```

---

### Task 3.2: ChecklistItemRow — marcar + nota + anexo + tarefa derivada

**Files:**
- Create: `web/src/screens/checklists/ChecklistItemRow.tsx`
- Create: `web/src/screens/checklists/hooks/useToggleItem.ts`

- [ ] **Step 1: Hook useToggleItem**

```ts
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../../lib/supabaseClient';

type Scope = 'work' | 'personal';
type Params = { scope: Scope; completionId: string; itemId: string; isChecked: boolean; notes?: string | null };

export function useToggleItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ scope, completionId, itemId, isChecked, notes }: Params) => {
      const table = scope === 'work'
        ? 'op_checklist_item_completions'
        : 'personal_checklist_item_completions';
      const payload: any = {
        completion_id: completionId,
        item_id: itemId,
        is_checked: isChecked,
        checked_at: isChecked ? new Date().toISOString() : null,
      };
      if (notes !== undefined) payload.notes = notes;
      if (scope === 'work') payload.channel = 'pwa';

      const { error } = await supabase.from(table).upsert(payload, {
        onConflict: 'completion_id,item_id',
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['checklists-hoje'] });
      qc.invalidateQueries({ queryKey: ['checklists-kpi'] });
    },
  });
}
```

- [ ] **Step 2: Componente ChecklistItemRow**

```tsx
import { useState } from 'react';
import type { ChecklistItem } from './hooks/useChecklistsHoje';
import { useToggleItem } from './hooks/useToggleItem';
import { ChecklistAttachments } from './ChecklistAttachments';
import { DeriveTaskDialog } from './DeriveTaskDialog';

interface Props {
  scope: 'work' | 'personal';
  completionId: string | null;
  item: ChecklistItem;
  onChanged: () => void;
}

export function ChecklistItemRow({ scope, completionId, item, onChanged }: Props) {
  const toggle = useToggleItem();
  const [noteOpen, setNoteOpen] = useState(item.notes != null && item.notes.length > 0);
  const [noteValue, setNoteValue] = useState(item.notes ?? '');
  const [showDerive, setShowDerive] = useState(false);

  if (!completionId) {
    return (
      <div className="px-3 py-2 text-fg/40 text-sm italic">
        Esta lista ainda não foi iniciada hoje.
      </div>
    );
  }

  const handleToggle = () => {
    toggle.mutate({
      scope,
      completionId,
      itemId: item.id,
      isChecked: !item.is_checked,
    }, { onSuccess: onChanged });
  };

  const handleNoteBlur = () => {
    if (noteValue !== (item.notes ?? '')) {
      toggle.mutate({
        scope,
        completionId,
        itemId: item.id,
        isChecked: item.is_checked,
        notes: noteValue.trim() || null,
      }, { onSuccess: onChanged });
    }
  };

  return (
    <div className="border border-transparent hover:border-border rounded-md p-2">
      <div className="flex items-start gap-3">
        <button
          onClick={handleToggle}
          className={`w-5 h-5 rounded border-2 flex-shrink-0 mt-0.5 ${
            item.is_checked ? 'bg-tom border-tom' : 'border-fg/40 hover:border-tom'
          }`}
          aria-label={item.is_checked ? 'Desmarcar' : 'Marcar'}
        >
          {item.is_checked && (
            <svg viewBox="0 0 20 20" fill="currentColor" className="text-bg-app w-full h-full">
              <path fillRule="evenodd" d="M16.7 5.3a1 1 0 010 1.4l-7 7a1 1 0 01-1.4 0l-3-3a1 1 0 011.4-1.4L9 11.6l6.3-6.3a1 1 0 011.4 0z" />
            </svg>
          )}
        </button>
        <div className="flex-1 min-w-0">
          <div className={`text-sm ${item.is_checked ? 'line-through text-fg/50' : 'text-fg'}`}>
            {item.description}
          </div>

          {noteOpen ? (
            <textarea
              value={noteValue}
              onChange={(e) => setNoteValue(e.target.value)}
              onBlur={handleNoteBlur}
              placeholder="Observação…"
              rows={2}
              className="w-full mt-1 bg-bg-app border border-border rounded-md p-2 text-xs text-fg resize-none focus:outline-none focus:border-tom"
            />
          ) : (
            <button onClick={() => setNoteOpen(true)} className="text-xs text-fg/40 hover:text-tom mt-0.5">
              + nota
            </button>
          )}

          {scope === 'work' && (
            <ChecklistAttachments scope="work" itemCompletionId={`${completionId}:${item.id}`} />
          )}
        </div>
        <button
          onClick={() => setShowDerive(true)}
          className="text-xs text-fg/40 hover:text-tom p-1"
          title="Gerar tarefa a partir deste item"
        >
          🪄
        </button>
      </div>

      {showDerive && (
        <DeriveTaskDialog
          scope={scope}
          completionId={completionId}
          itemId={item.id}
          itemDescription={item.description}
          onClose={() => setShowDerive(false)}
          onCreated={() => { setShowDerive(false); onChanged(); }}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 3: Stubs vazios pra ChecklistAttachments + DeriveTaskDialog (preenchemos depois)**

`ChecklistAttachments.tsx`:
```tsx
interface Props { scope: 'work' | 'personal'; itemCompletionId: string; }
export function ChecklistAttachments(_p: Props) { return null; }
```

`DeriveTaskDialog.tsx`:
```tsx
interface Props {
  scope: 'work' | 'personal';
  completionId: string;
  itemId: string;
  itemDescription: string;
  onClose: () => void;
  onCreated: () => void;
}
export function DeriveTaskDialog(_p: Props) { return null; }
```

`JustifyDialog.tsx`:
```tsx
interface Props {
  completionId: string;
  onClose: () => void;
  onJustified: () => void;
}
export function JustifyDialog(_p: Props) { return null; }
```

- [ ] **Step 4: TS + build**

```bash
cd web && npx tsc --noEmit && npx vite build
```

- [ ] **Step 5: Commit**

```bash
git add web/src/screens/checklists/
git commit -m "feat(checklists): ChecklistItemRow com toggle, nota e gancho derive"
```

---

### Task 3.3: Item ad-hoc (adicionar/editar/remover)

**Files:**
- Modify: `web/src/screens/checklists/ChecklistExecucaoDrawer.tsx` (substituir stubs ExtraItemRow + AddAdHocItemButton)
- Create: `web/src/screens/checklists/hooks/useAdHocItem.ts`

- [ ] **Step 1: Hook useAdHocItem**

```ts
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../../lib/supabaseClient';

export function useAdHocItem() {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: ['checklists-hoje'] });

  const add = useMutation({
    mutationFn: async ({ completionId, description }: { completionId: string; description: string }) => {
      const { data: { user } } = await supabase.auth.getUser();
      const { error } = await supabase
        .from('op_checklist_completion_extra_items')
        .insert({
          completion_id: completionId,
          description,
          is_checked: false,
          created_by: user?.id,
        });
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  const toggle = useMutation({
    mutationFn: async ({ id, isChecked }: { id: string; isChecked: boolean }) => {
      const { error } = await supabase
        .from('op_checklist_completion_extra_items')
        .update({ is_checked: isChecked })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  const update = useMutation({
    mutationFn: async ({ id, description }: { id: string; description: string }) => {
      const { error } = await supabase
        .from('op_checklist_completion_extra_items')
        .update({ description })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  const remove = useMutation({
    mutationFn: async ({ id }: { id: string }) => {
      const { error } = await supabase
        .from('op_checklist_completion_extra_items')
        .delete()
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  return { add, toggle, update, remove };
}
```

- [ ] **Step 2: Implementar ExtraItemRow no `ChecklistExecucaoDrawer.tsx`**

Substituir `function ExtraItemRow(_p: any) { return null; }` por:
```tsx
function ExtraItemRow({ completionId, extra, onChanged }: { completionId: string | null; extra: any; onChanged: () => void }) {
  const { toggle, update, remove } = useAdHocItem();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(extra.description);

  if (!completionId) return null;

  return (
    <div className="border border-transparent hover:border-border rounded-md p-2 flex items-start gap-3">
      <button
        onClick={() => toggle.mutate({ id: extra.id, isChecked: !extra.is_checked }, { onSuccess: onChanged })}
        className={`w-5 h-5 rounded border-2 flex-shrink-0 mt-0.5 ${
          extra.is_checked ? 'bg-tom border-tom' : 'border-fg/40 hover:border-tom'
        }`}
      />
      <div className="flex-1 min-w-0">
        {editing ? (
          <input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onBlur={() => {
              if (value.trim() && value !== extra.description) {
                update.mutate({ id: extra.id, description: value.trim() }, { onSuccess: onChanged });
              }
              setEditing(false);
            }}
            autoFocus
            className="w-full bg-bg-app border border-border rounded-md p-1 text-sm text-fg focus:outline-none focus:border-tom"
          />
        ) : (
          <button onClick={() => setEditing(true)} className={`text-sm text-left ${extra.is_checked ? 'line-through text-fg/50' : 'text-fg'}`}>
            {extra.description}
          </button>
        )}
        <span className="text-xs text-fg/40 ml-2">(ad-hoc)</span>
      </div>
      <button
        onClick={() => {
          if (confirm('Remover este item?')) remove.mutate({ id: extra.id }, { onSuccess: onChanged });
        }}
        className="text-xs text-fg/40 hover:text-danger p-1"
        title="Remover item ad-hoc"
      >
        🗑
      </button>
    </div>
  );
}
```

- [ ] **Step 3: Implementar AddAdHocItemButton**

Substituir `function AddAdHocItemButton(_p: any) { return null; }` por:
```tsx
function AddAdHocItemButton({ scope, completionId, onAdded }: { scope: 'work' | 'personal'; completionId: string | null; onAdded: () => void }) {
  const { add } = useAdHocItem();
  const [adding, setAdding] = useState(false);
  const [value, setValue] = useState('');

  if (!completionId || scope !== 'work') return null; // ad-hoc só pra work nesta sprint

  if (!adding) {
    return (
      <button onClick={() => setAdding(true)} className="text-xs text-fg/40 hover:text-tom px-3 py-2 w-full text-left border border-dashed border-border rounded-md mt-2">
        + adicionar item ad-hoc
      </button>
    );
  }

  return (
    <div className="flex gap-2 mt-2">
      <input
        autoFocus
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && value.trim()) {
            add.mutate({ completionId, description: value.trim() }, {
              onSuccess: () => { setValue(''); onAdded(); }
            });
          }
          if (e.key === 'Escape') { setAdding(false); setValue(''); }
        }}
        placeholder="Descreva o item…"
        className="flex-1 bg-bg-app border border-border rounded-md p-2 text-sm focus:outline-none focus:border-tom"
      />
      <button
        onClick={() => { setAdding(false); setValue(''); }}
        className="text-xs text-fg/40 hover:text-fg px-2"
      >
        Cancelar
      </button>
    </div>
  );
}
```

Adicione no topo de `ChecklistExecucaoDrawer.tsx`:
```tsx
import { useAdHocItem } from './hooks/useAdHocItem';
```

- [ ] **Step 4: TS + build OK**

- [ ] **Step 5: Commit**

```bash
git add web/src/screens/checklists/
git commit -m "feat(checklists): item ad-hoc (add/edit/remove)"
```

---

### Task 3.4: ChecklistAttachments (upload + thumbnail)

**Files:**
- Modify: `web/src/screens/checklists/ChecklistAttachments.tsx` (substituir stub)
- Create: `web/src/screens/checklists/hooks/useChecklistAttachments.ts`

- [ ] **Step 1: Hook useChecklistAttachments**

```ts
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../../lib/supabaseClient';

type Scope = 'work' | 'personal';

export function useChecklistAttachments(scope: Scope, itemCompletionId: string) {
  const qc = useQueryClient();
  const queryKey = ['checklist-attachments', scope, itemCompletionId];

  // itemCompletionId format: "{completion_id}:{item_id}" — convertemos pra UUID real do item_completion
  // Pra simplificar, usamos string composta como índice no Storage path; em produção, faria SELECT pra resolver
  // mas isso exige inserir em op_checklist_item_completions ANTES de anexar.

  const list = useQuery({
    queryKey,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('checklist_attachments')
        .select('*')
        .eq('scope', scope)
        .eq('item_completion_id', itemCompletionId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data || [];
    },
  });

  const upload = useMutation({
    mutationFn: async ({ file }: { file: File }) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Sem usuário');
      const ext = file.name.split('.').pop() || 'bin';
      const path = `${scope}/${user.id}/${itemCompletionId}/${crypto.randomUUID()}.${ext}`;

      const { error: upErr } = await supabase.storage
        .from('checklist-attachments')
        .upload(path, file, { contentType: file.type, cacheControl: '3600' });
      if (upErr) throw upErr;

      const { error: insErr } = await supabase
        .from('checklist_attachments')
        .insert({
          scope,
          item_completion_id: itemCompletionId,
          storage_path: path,
          file_name: file.name,
          mime_type: file.type,
          size_bytes: file.size,
          uploaded_by: user.id,
        });
      if (insErr) throw insErr;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey }),
  });

  const remove = useMutation({
    mutationFn: async ({ id, storagePath }: { id: string; storagePath: string }) => {
      await supabase.storage.from('checklist-attachments').remove([storagePath]);
      const { error } = await supabase.from('checklist_attachments').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey }),
  });

  return { list, upload, remove };
}
```

- [ ] **Step 2: Implementar ChecklistAttachments**

```tsx
import { useRef, useState } from 'react';
import { useChecklistAttachments } from './hooks/useChecklistAttachments';
import { supabase } from '../../lib/supabaseClient';

interface Props { scope: 'work' | 'personal'; itemCompletionId: string; }

export function ChecklistAttachments({ scope, itemCompletionId }: Props) {
  const { list, upload, remove } = useChecklistAttachments(scope, itemCompletionId);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [signedUrls, setSignedUrls] = useState<Record<string, string>>({});

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (f.size > 10 * 1024 * 1024) {
      alert('Arquivo muito grande (max 10MB)');
      return;
    }
    upload.mutate({ file: f });
    e.target.value = '';
  };

  const ensureUrl = async (att: any) => {
    if (signedUrls[att.id]) return;
    const { data } = await supabase.storage
      .from('checklist-attachments')
      .createSignedUrl(att.storage_path, 300);
    if (data?.signedUrl) setSignedUrls((s) => ({ ...s, [att.id]: data.signedUrl }));
  };

  return (
    <div className="mt-2 flex flex-wrap gap-2">
      {(list.data || []).map((att: any) => {
        const isImage = att.mime_type.startsWith('image/');
        return (
          <div key={att.id} className="relative group" onMouseEnter={() => ensureUrl(att)}>
            <a
              href={signedUrls[att.id] ?? '#'}
              target="_blank"
              rel="noopener noreferrer"
              className="block w-16 h-16 bg-bg-app border border-border rounded-md overflow-hidden"
              title={att.file_name}
            >
              {isImage && signedUrls[att.id] ? (
                <img src={signedUrls[att.id]} alt={att.file_name} className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-xs text-fg/40">📎</div>
              )}
            </a>
            <button
              onClick={() => {
                if (confirm('Remover anexo?')) remove.mutate({ id: att.id, storagePath: att.storage_path });
              }}
              className="absolute -top-1 -right-1 w-4 h-4 bg-danger text-white rounded-full text-[10px] opacity-0 group-hover:opacity-100"
              aria-label="Remover anexo"
            >✕</button>
          </div>
        );
      })}
      <button
        onClick={() => fileInputRef.current?.click()}
        disabled={upload.isPending}
        className="w-16 h-16 border border-dashed border-border rounded-md text-fg/40 hover:text-tom hover:border-tom text-xs disabled:opacity-50"
        title="Anexar foto/PDF"
      >
        {upload.isPending ? '...' : '+ 📎'}
      </button>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,application/pdf"
        onChange={handleFile}
        className="hidden"
      />
    </div>
  );
}
```

⚠️ **Limitação conhecida:** `itemCompletionId` aqui usa string composta (`completion_id:item_id`). Em produção, isso causaria mismatch com o UUID da row `op_checklist_item_completions`. Solução: garantir que a row de `item_completions` exista (criar com `is_checked=false` quando a tela abre) e usar o UUID real. Vamos adicionar isso na próxima task.

- [ ] **Step 3: Garantir row item_completion existe antes de anexar**

Modificar `useChecklistsHoje` pra retornar o ID real da row `op_checklist_item_completions` (e equivalente personal) — quando não existir, criar UPSERT com `is_checked=false`.

Editar `useChecklistsHoje.ts`:
- Adicionar campo `item_completion_id` no tipo `ChecklistItem`
- Mapear `it.op_checklist_item_completions.id` se existir, ou null

```ts
export interface ChecklistItem {
  id: string;
  description: string;
  sort_order: number;
  is_checked: boolean;
  notes: string | null;
  item_completion_id: string | null;
}
```

E no map:
```ts
return {
  id: it.id,
  description: it.description,
  sort_order: it.sort_order,
  is_checked: !!ic?.is_checked,
  notes: ic?.notes ?? null,
  item_completion_id: ic?.id ?? null,
};
```

Modificar `useToggleItem` pra retornar o ID da row inserida/atualizada e invalidar.

Modificar `ChecklistItemRow`: passar `item.item_completion_id` (criando uma row vazia primeiro se for null) pra `ChecklistAttachments`. Lógica:
- Se `item.item_completion_id` é null, ao tentar anexar, faz upsert que retorna ID, depois usa.
- Pra simplificar nesta sprint: só permite anexar depois que o usuário marca/desmarca o item ao menos uma vez (row já existe).

Atualizar `ChecklistItemRow.tsx`:
```tsx
{scope === 'work' && item.item_completion_id && (
  <ChecklistAttachments scope="work" itemCompletionId={item.item_completion_id} />
)}
```

- [ ] **Step 4: TS + build**

- [ ] **Step 5: Commit**

```bash
git add web/src/screens/checklists/
git commit -m "feat(checklists): upload + thumbnail de anexos por item"
```

---

### Task 3.5: DeriveTaskDialog (criar tarefa derivada)

**Files:**
- Modify: `web/src/screens/checklists/DeriveTaskDialog.tsx` (substituir stub)
- Create: `web/src/screens/checklists/hooks/useDeriveTask.ts`

- [ ] **Step 1: Hook**

```ts
import { useMutation } from '@tanstack/react-query';
import { supabase } from '../../../lib/supabaseClient';

type Scope = 'work' | 'personal';

interface Params {
  scope: Scope;
  completionId: string;
  itemId: string;
  itemDescription: string;
  title: string;
  description: string;
}

export function useDeriveTask() {
  return useMutation({
    mutationFn: async (p: Params) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Sem usuário');

      const { data: task, error: tErr } = await supabase
        .from('tasks')
        .insert({
          owner_id: user.id,
          title: p.title,
          description: p.description || null,
          status: 'open',
          context: 'work',
          created_via: 'checklist_derive',
        })
        .select('id')
        .single();
      if (tErr) throw tErr;

      // Link na row de item_completion
      const table = p.scope === 'work'
        ? 'op_checklist_item_completions'
        : 'personal_checklist_item_completions';

      const { error: linkErr } = await supabase
        .from(table)
        .upsert({
          completion_id: p.completionId,
          item_id: p.itemId,
          derived_task_id: task.id,
        }, { onConflict: 'completion_id,item_id' });
      if (linkErr) throw linkErr;

      return task;
    },
  });
}
```

- [ ] **Step 2: Componente**

```tsx
import { useState } from 'react';
import { useDeriveTask } from './hooks/useDeriveTask';

interface Props {
  scope: 'work' | 'personal';
  completionId: string;
  itemId: string;
  itemDescription: string;
  onClose: () => void;
  onCreated: () => void;
}

export function DeriveTaskDialog({ scope, completionId, itemId, itemDescription, onClose, onCreated }: Props) {
  const derive = useDeriveTask();
  const [title, setTitle] = useState(`Resolver: ${itemDescription}`);
  const [description, setDescription] = useState('');

  const handleSubmit = () => {
    derive.mutate({ scope, completionId, itemId, itemDescription, title: title.trim(), description: description.trim() }, {
      onSuccess: onCreated,
      onError: (e: any) => alert(`Erro ao criar tarefa: ${e.message}`),
    });
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-bg-surface border border-border rounded-lg max-w-md w-full p-4">
        <h3 className="font-semibold text-fg mb-3">Gerar tarefa</h3>
        <p className="text-xs text-fg/60 mb-3">Item: <span className="text-fg/80">{itemDescription}</span></p>

        <label className="block text-xs text-fg/60 mb-1">Título da tarefa</label>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="w-full bg-bg-app border border-border rounded-md p-2 text-sm text-fg focus:outline-none focus:border-tom mb-3"
        />

        <label className="block text-xs text-fg/60 mb-1">Descrição (opcional)</label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
          placeholder="Detalhes adicionais…"
          className="w-full bg-bg-app border border-border rounded-md p-2 text-sm text-fg resize-none focus:outline-none focus:border-tom mb-4"
        />

        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="text-xs px-3 py-2 text-fg/60 hover:text-fg">Cancelar</button>
          <button
            onClick={handleSubmit}
            disabled={!title.trim() || derive.isPending}
            className="text-xs px-4 py-2 bg-tom text-bg-app rounded-md font-semibold disabled:opacity-50"
          >
            {derive.isPending ? 'Criando…' : 'Criar tarefa'}
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: TS + build**

- [ ] **Step 4: Commit**

```bash
git add web/src/screens/checklists/
git commit -m "feat(checklists): DeriveTaskDialog cria tarefa derivada de item"
```

---

### Task 3.6: JustifyDialog (justificar não-execução)

**Files:**
- Modify: `web/src/screens/checklists/JustifyDialog.tsx` (substituir stub)

- [ ] **Step 1: Implementar**

```tsx
import { useState } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { useMutation } from '@tanstack/react-query';

interface Props {
  completionId: string;
  onClose: () => void;
  onJustified: () => void;
}

export function JustifyDialog({ completionId, onClose, onJustified }: Props) {
  const [text, setText] = useState('');
  const mut = useMutation({
    mutationFn: async (justification: string) => {
      const { data: { user } } = await supabase.auth.getUser();
      const { error } = await supabase
        .from('op_checklist_completions')
        .update({
          justification,
          justified_at: new Date().toISOString(),
          justified_by_id: user?.id,
        })
        .eq('id', completionId);
      if (error) throw error;
    },
    onSuccess: onJustified,
    onError: (e: any) => alert(`Erro: ${e.message}`),
  });

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-bg-surface border border-border rounded-lg max-w-md w-full p-4">
        <h3 className="font-semibold text-fg mb-3">Justificar não-execução</h3>
        <p className="text-xs text-fg/60 mb-3">
          A justificativa fica registrada no histórico do checklist.
        </p>
        <textarea
          autoFocus
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={4}
          placeholder="Ex: escola fechou hoje pelo feriado; aula remarcada…"
          className="w-full bg-bg-app border border-border rounded-md p-2 text-sm text-fg resize-none focus:outline-none focus:border-tom mb-4"
        />
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="text-xs px-3 py-2 text-fg/60 hover:text-fg">Cancelar</button>
          <button
            onClick={() => mut.mutate(text.trim())}
            disabled={!text.trim() || mut.isPending}
            className="text-xs px-4 py-2 bg-tom text-bg-app rounded-md font-semibold disabled:opacity-50"
          >
            {mut.isPending ? 'Salvando…' : 'Justificar'}
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: TS + build**

- [ ] **Step 3: Commit**

```bash
git add web/src/screens/checklists/JustifyDialog.tsx
git commit -m "feat(checklists): JustifyDialog persiste justificativa em op_checklist_completions"
```

---

### Task 3.7: Validação Sprint 3 (Chrome MCP + smoke test real)

- [ ] **Step 1: Chrome MCP — testar todo o fluxo**

1. Abrir `/checklists` desktop
2. Selecionar um checklist do dia (work)
3. Validar drawer abre à direita
4. Marcar 2 itens → screenshot mostra checked + KPI atualiza
5. Adicionar nota num item → blur → atualiza no banco (query SELECT)
6. Adicionar item ad-hoc → aparece na lista
7. Anexar foto → thumbnail aparece
8. Clicar 🪄 num item → modal aparece, criar tarefa → fechar
9. Clicar "Justificar" → modal aparece, salvar
10. Validar persistência via SQL:
    ```sql
    SELECT justification, justified_at FROM op_checklist_completions
    WHERE id = '<id usado no teste>';
    ```

- [ ] **Step 2: Push final + esperar OK do user**

```bash
git push origin main
```

"Sprint 3 deployada. Drawer de execução completo. Por favor abre `/checklists`, executa um checklist e testa: marcar, nota, ad-hoc, anexar foto, gerar tarefa, justificar. OK pra Sprint 4?"

---

# Sprint 4 — Aderência (Cards + Tabela)

**Goal:** Sub-aba Aderência com toggle Cards/Tabela, filtros Hoje/Semana/Mês, mostrando dados reais agregados.

### Task 4.1: Hook useAderencia

**Files:**
- Create: `web/src/screens/checklists/hooks/useAderencia.ts`

- [ ] **Step 1: Implementar hook**

```ts
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../../../lib/supabaseClient';

export type Range = 'today' | 'week' | 'month';

export interface TemplateAderencia {
  template_id: string;
  template_name: string;
  dispatch_time: string | null;
  function_role: string | null;
  totalInstancias: number;
  completas: number;
  atrasadas: number;
  pendentes: number;
  pctCompletion: number;
  responsaveis: Array<{ id: string; name: string; status: 'done' | 'late' | 'pending' }>;
  monthSpark: number[]; // 30 dias, 0-100
}

export interface AderenciaInstance {
  template_id: string;
  template_name: string;
  collaborator_id: string;
  collaborator_name: string;
  dispatch_time: string | null;
  reference_date: string;
  status: 'done' | 'late' | 'pending';
  done_items: number;
  total_items: number;
}

function rangeDates(range: Range): { from: string; to: string } {
  const today = new Date();
  const to = today.toISOString().slice(0, 10);
  if (range === 'today') return { from: to, to };
  if (range === 'week') {
    const d = new Date(today); d.setDate(d.getDate() - 6);
    return { from: d.toISOString().slice(0, 10), to };
  }
  const d = new Date(today); d.setDate(d.getDate() - 29);
  return { from: d.toISOString().slice(0, 10), to };
}

export function useAderencia(range: Range) {
  return useQuery<{ byTemplate: TemplateAderencia[]; instances: AderenciaInstance[] }>({
    queryKey: ['aderencia', range],
    queryFn: async () => {
      const { from, to } = rangeDates(range);

      const { data: comps, error } = await supabase
        .from('op_checklist_completions')
        .select(`
          id, reference_date, completed_at, dispatched_at, collaborator_id,
          op_checklists!inner ( id, name, dispatch_time, function_role, completion_threshold ),
          collaborators ( id, full_name, preferred_name )
        `)
        .gte('reference_date', from)
        .lte('reference_date', to);
      if (error) throw error;

      const sixHoursAgo = Date.now() - 6 * 3600000;
      const instances: AderenciaInstance[] = (comps || []).map((c: any) => {
        let status: 'done' | 'late' | 'pending';
        if (c.completed_at) status = 'done';
        else if (c.dispatched_at && new Date(c.dispatched_at).getTime() < sixHoursAgo) status = 'late';
        else status = 'pending';
        return {
          template_id: c.op_checklists.id,
          template_name: c.op_checklists.name,
          collaborator_id: c.collaborator_id,
          collaborator_name: c.collaborators?.preferred_name || c.collaborators?.full_name || '?',
          dispatch_time: c.op_checklists.dispatch_time,
          reference_date: c.reference_date,
          status,
          done_items: 0,
          total_items: 0,
        };
      });

      // Agregação por template (só pro range atual)
      const byTplMap = new Map<string, TemplateAderencia>();
      for (const inst of instances) {
        if (!byTplMap.has(inst.template_id)) {
          byTplMap.set(inst.template_id, {
            template_id: inst.template_id,
            template_name: inst.template_name,
            dispatch_time: inst.dispatch_time,
            function_role: null,
            totalInstancias: 0,
            completas: 0,
            atrasadas: 0,
            pendentes: 0,
            pctCompletion: 0,
            responsaveis: [],
            monthSpark: [],
          });
        }
        const t = byTplMap.get(inst.template_id)!;
        t.totalInstancias++;
        if (inst.status === 'done') t.completas++;
        else if (inst.status === 'late') t.atrasadas++;
        else t.pendentes++;
        t.responsaveis.push({
          id: inst.collaborator_id,
          name: inst.collaborator_name,
          status: inst.status,
        });
      }
      const byTemplate = Array.from(byTplMap.values()).map((t) => ({
        ...t,
        pctCompletion: t.totalInstancias ? Math.round((t.completas / t.totalInstancias) * 100) : 0,
        monthSpark: [], // preenchemos abaixo só pra range=today (sparkline tipicamente é histórico)
      }));

      return { byTemplate, instances };
    },
    staleTime: 30_000,
  });
}
```

- [ ] **Step 2: TS compila**

```bash
cd web && npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add web/src/screens/checklists/hooks/useAderencia.ts
git commit -m "feat(checklists): hook useAderencia agregação por template"
```

---

### Task 4.2: AderenciaCards (visão padrão)

**Files:**
- Create: `web/src/screens/checklists/AderenciaCards.tsx`

- [ ] **Step 1: Implementar**

```tsx
import type { TemplateAderencia } from './hooks/useAderencia';

export function AderenciaCards({ data }: { data: TemplateAderencia[] }) {
  if (data.length === 0) {
    return <div className="text-fg/40 text-sm py-8 text-center">Sem dados pra este período.</div>;
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
      {data.map((t) => (
        <TemplateCard key={t.template_id} t={t} />
      ))}
    </div>
  );
}

function TemplateCard({ t }: { t: TemplateAderencia }) {
  return (
    <div className="bg-bg-surface border border-border rounded-md p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="font-semibold text-fg text-sm truncate">{t.template_name}</div>
          <div className="text-xs text-fg/60">
            {t.dispatch_time ? t.dispatch_time.slice(0, 5) : '—'} · {t.totalInstancias} instância{t.totalInstancias !== 1 ? 's' : ''}
          </div>
        </div>
        <Donut pct={t.pctCompletion} />
      </div>
      <div className="mt-2 flex items-center gap-1 flex-wrap">
        {t.responsaveis.slice(0, 5).map((r) => (
          <Avatar key={r.id + r.status} name={r.name} status={r.status} />
        ))}
        {t.responsaveis.length > 5 && (
          <span className="text-xs text-fg/40 ml-1">+{t.responsaveis.length - 5}</span>
        )}
      </div>
    </div>
  );
}

function Donut({ pct }: { pct: number }) {
  const r = 14;
  const c = 2 * Math.PI * r;
  const offset = c - (pct / 100) * c;
  const color = pct === 100 ? '#d6f76d' : pct < 50 ? '#ff8a8a' : '#ffc26d';
  return (
    <div className="relative w-10 h-10 flex-shrink-0">
      <svg viewBox="0 0 36 36" className="w-full h-full -rotate-90">
        <circle cx="18" cy="18" r={r} fill="none" stroke="#2a2f3a" strokeWidth="3" />
        <circle
          cx="18" cy="18" r={r} fill="none"
          stroke={color} strokeWidth="3"
          strokeDasharray={c} strokeDashoffset={offset}
          strokeLinecap="round"
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center text-[10px] font-bold text-fg">
        {pct}%
      </div>
    </div>
  );
}

function Avatar({ name, status }: { name: string; status: 'done' | 'late' | 'pending' }) {
  const initial = name.charAt(0).toUpperCase();
  const bg = status === 'done' ? 'bg-tom text-bg-app'
    : status === 'late' ? 'bg-danger text-white'
    : 'bg-bg-app text-fg/60 border border-border';
  return (
    <div
      className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold ${bg}`}
      title={`${name} (${status === 'done' ? 'feito' : status === 'late' ? 'atrasou' : 'pendente'})`}
    >
      {initial}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add web/src/screens/checklists/AderenciaCards.tsx
git commit -m "feat(checklists): AderenciaCards com donut + avatares"
```

---

### Task 4.3: AderenciaTabela (visão tabular)

**Files:**
- Create: `web/src/screens/checklists/AderenciaTabela.tsx`

- [ ] **Step 1: Implementar**

```tsx
import type { AderenciaInstance } from './hooks/useAderencia';

export function AderenciaTabela({ data }: { data: AderenciaInstance[] }) {
  if (data.length === 0) {
    return <div className="text-fg/40 text-sm py-8 text-center">Sem dados pra este período.</div>;
  }

  return (
    <div className="overflow-x-auto border border-border rounded-md">
      <table className="min-w-full text-sm">
        <thead className="bg-bg-app">
          <tr>
            <th className="text-left px-3 py-2 text-xs uppercase tracking-wider text-fg/60 font-medium">Template</th>
            <th className="text-left px-3 py-2 text-xs uppercase tracking-wider text-fg/60 font-medium">Colaborador</th>
            <th className="text-left px-3 py-2 text-xs uppercase tracking-wider text-fg/60 font-medium">Data</th>
            <th className="text-left px-3 py-2 text-xs uppercase tracking-wider text-fg/60 font-medium">Horário</th>
            <th className="text-left px-3 py-2 text-xs uppercase tracking-wider text-fg/60 font-medium">Status</th>
          </tr>
        </thead>
        <tbody>
          {data.map((inst, idx) => (
            <tr key={`${inst.template_id}-${inst.collaborator_id}-${inst.reference_date}-${idx}`} className="border-t border-border">
              <td className="px-3 py-2">{inst.template_name}</td>
              <td className="px-3 py-2">{inst.collaborator_name}</td>
              <td className="px-3 py-2 text-fg/60">{inst.reference_date}</td>
              <td className="px-3 py-2 text-fg/60">{inst.dispatch_time?.slice(0, 5) ?? '—'}</td>
              <td className="px-3 py-2">
                <StatusBadge status={inst.status} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function StatusBadge({ status }: { status: 'done' | 'late' | 'pending' }) {
  const map = {
    done: { label: 'Feita', cls: 'bg-tom/20 text-tom' },
    late: { label: 'Atrasada', cls: 'bg-danger/20 text-danger' },
    pending: { label: 'Pendente', cls: 'bg-bg-app text-fg/60 border border-border' },
  };
  const m = map[status];
  return <span className={`inline-block px-2 py-0.5 rounded-md text-xs font-semibold ${m.cls}`}>{m.label}</span>;
}
```

- [ ] **Step 2: Commit**

```bash
git add web/src/screens/checklists/AderenciaTabela.tsx
git commit -m "feat(checklists): AderenciaTabela visão densa"
```

---

### Task 4.4: AderenciaTab — view toggle + filtros

**Files:**
- Modify: `web/src/screens/checklists/AderenciaTab.tsx`

- [ ] **Step 1: Implementar**

```tsx
import { useState } from 'react';
import { useAderencia, type Range } from './hooks/useAderencia';
import { AderenciaCards } from './AderenciaCards';
import { AderenciaTabela } from './AderenciaTabela';

type View = 'cards' | 'tabela';

export function AderenciaTab() {
  const [range, setRange] = useState<Range>('today');
  const [view, setView] = useState<View>('cards');
  const { data, isLoading } = useAderencia(range);

  return (
    <div className="px-6 py-4">
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <Chip active={range === 'today'} onClick={() => setRange('today')}>Hoje</Chip>
        <Chip active={range === 'week'} onClick={() => setRange('week')}>Semana</Chip>
        <Chip active={range === 'month'} onClick={() => setRange('month')}>Mês</Chip>

        <div className="ml-auto inline-flex rounded-md border border-border overflow-hidden">
          <button
            onClick={() => setView('cards')}
            className={`px-3 py-1.5 text-xs font-medium ${view === 'cards' ? 'bg-tom text-bg-app' : 'text-fg/70 hover:text-fg'}`}
          >
            ◧ Cards
          </button>
          <button
            onClick={() => setView('tabela')}
            className={`px-3 py-1.5 text-xs font-medium border-l border-border ${view === 'tabela' ? 'bg-tom text-bg-app' : 'text-fg/70 hover:text-fg'}`}
          >
            ☰ Tabela
          </button>
        </div>
      </div>

      {isLoading || !data ? (
        <div className="text-fg/40 text-sm">Carregando…</div>
      ) : view === 'cards' ? (
        <AderenciaCards data={data.byTemplate} />
      ) : (
        <AderenciaTabela data={data.instances} />
      )}
    </div>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1.5 rounded-full text-xs font-medium ${
        active ? 'bg-tom text-bg-app' : 'bg-bg-surface text-fg/70 hover:text-fg border border-border'
      }`}
    >
      {children}
    </button>
  );
}
```

- [ ] **Step 2: TS + build**

```bash
cd web && npx tsc --noEmit && npx vite build
```

- [ ] **Step 3: Smoke test Chrome MCP**

1. Abrir `/checklists` → trocar pra tab "Aderência"
2. Validar Cards aparecem
3. Trocar pra "Tabela" → linhas aparecem
4. Trocar filtro Hoje → Semana → Mês — dados mudam

- [ ] **Step 4: Commit + push**

```bash
git add web/src/screens/checklists/AderenciaTab.tsx
git commit -m "feat(checklists): AderenciaTab com toggle Cards/Tabela + filtros"
git push origin main
```

- [ ] **Step 5: Pedir teste real**

"Sprint 4 deployada. Aderência tem agora Cards + Tabela com filtros Hoje/Semana/Mês. OK pra Sprint 5?"

---

# Sprint 5 — Templates (admin)

**Goal:** Rota `/checklists/templates` com lista + drawer de edição (nome, horário, dias, função, unidade, itens DnD, threshold, responsável, líder).

### Task 5.1: Rota + hook useTemplates

**Files:**
- Modify: `web/src/App.tsx` (adicionar rota)
- Create: `web/src/screens/checklists/hooks/useTemplates.ts`

- [ ] **Step 1: Hook useTemplates**

```ts
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../../lib/supabaseClient';

export interface OpChecklist {
  id: string;
  name: string;
  function_role: string | null;
  checklist_type: string | null;
  shift: string | null;
  unit: string | null;
  is_active: boolean;
  completion_threshold: number;
  dispatch_time: string | null;
  days_of_week: number[] | null;
  responsible_id: string | null;
  leader_id: string | null;
}

export interface OpChecklistItem {
  id: string;
  checklist_id: string;
  description: string;
  sort_order: number;
  is_active: boolean;
}

export function useTemplates() {
  const qc = useQueryClient();

  const list = useQuery<OpChecklist[]>({
    queryKey: ['templates'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('op_checklists')
        .select('*')
        .order('name');
      if (error) throw error;
      return data || [];
    },
  });

  const create = useMutation({
    mutationFn: async (payload: Partial<OpChecklist>) => {
      const { data: { user } } = await supabase.auth.getUser();
      const { data, error } = await supabase
        .from('op_checklists')
        .insert({ ...payload, created_by: user?.id, is_active: false })
        .select('*')
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['templates'] }),
  });

  const update = useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Partial<OpChecklist> }) => {
      const { data: { user } } = await supabase.auth.getUser();
      const { error } = await supabase
        .from('op_checklists')
        .update({ ...patch, updated_by: user?.id, updated_at: new Date().toISOString() })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['templates'] }),
  });

  const toggleActive = useMutation({
    mutationFn: async ({ id, isActive }: { id: string; isActive: boolean }) => {
      const { error } = await supabase
        .from('op_checklists')
        .update({ is_active: isActive })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['templates'] }),
  });

  return { list, create, update, toggleActive };
}

export function useTemplateItems(templateId: string | null) {
  const qc = useQueryClient();
  const queryKey = ['template-items', templateId];

  const list = useQuery<OpChecklistItem[]>({
    queryKey,
    queryFn: async () => {
      if (!templateId) return [];
      const { data, error } = await supabase
        .from('op_checklist_items')
        .select('*')
        .eq('checklist_id', templateId)
        .eq('is_active', true)
        .order('sort_order');
      if (error) throw error;
      return data || [];
    },
    enabled: !!templateId,
  });

  const addItem = useMutation({
    mutationFn: async (description: string) => {
      if (!templateId) throw new Error('Sem templateId');
      const { data: { user } } = await supabase.auth.getUser();
      const current = list.data || [];
      const sort_order = (current.length ? Math.max(...current.map(i => i.sort_order)) : 0) + 1;
      const { error } = await supabase
        .from('op_checklist_items')
        .insert({ checklist_id: templateId, description, sort_order, is_active: true, updated_by: user?.id });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey }),
  });

  const updateItem = useMutation({
    mutationFn: async ({ id, description }: { id: string; description: string }) => {
      const { error } = await supabase.from('op_checklist_items').update({ description }).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey }),
  });

  const deleteItem = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('op_checklist_items').update({ is_active: false }).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey }),
  });

  const reorder = useMutation({
    mutationFn: async (newOrder: Array<{ id: string; sort_order: number }>) => {
      // Atualiza em paralelo
      const updates = await Promise.all(
        newOrder.map(({ id, sort_order }) =>
          supabase.from('op_checklist_items').update({ sort_order }).eq('id', id)
        )
      );
      const firstError = updates.find((u) => u.error);
      if (firstError?.error) throw firstError.error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey }),
  });

  return { list, addItem, updateItem, deleteItem, reorder };
}
```

- [ ] **Step 2: Adicionar rota em App.tsx**

Encontrar onde está a rota `/checklists` (provavelmente em `App.tsx` ou roteador). Adicionar logo após:

```tsx
<Route path="/checklists/templates" element={<TemplatesPage />} />
```

Import:
```tsx
import { TemplatesPage } from './screens/checklists/TemplatesPage';
```

(Se a rota `/checklists` está em outro arquivo, ajustar localmente.)

- [ ] **Step 3: Commit**

```bash
git add web/src/screens/checklists/hooks/useTemplates.ts web/src/App.tsx
git commit -m "feat(checklists): hook useTemplates + rota /checklists/templates"
```

---

### Task 5.2: TemplatesPage (lista + drawer)

**Files:**
- Create: `web/src/screens/checklists/TemplatesPage.tsx`

- [ ] **Step 1: Implementar**

```tsx
import { useState } from 'react';
import { PageShell } from '../../design/shell/PageShell';
import { useTemplates, type OpChecklist } from './hooks/useTemplates';
import { TemplateEditDrawer } from './TemplateEditDrawer';

export function TemplatesPage() {
  const { list, create, toggleActive } = useTemplates();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const handleCreate = () => {
    create.mutate(
      { name: 'Novo template', completion_threshold: 100, days_of_week: [1,2,3,4,5] },
      { onSuccess: (tpl: OpChecklist) => setSelectedId(tpl.id) }
    );
  };

  return (
    <PageShell>
      <div className="flex flex-col h-full">
        <header className="px-6 pt-6 pb-2">
          <div className="text-xs text-fg/60">
            <a href="/checklists" className="hover:text-tom">Checklists</a> › Templates
          </div>
          <h1 className="text-fg text-2xl font-bold">Templates</h1>
        </header>

        <div className="flex h-full">
          <div className="w-1/3 min-w-[280px] max-w-md border-r border-border overflow-y-auto">
            <div className="p-3 flex items-center gap-2">
              <span className="text-xs text-fg/60">{(list.data || []).length} template{(list.data || []).length !== 1 ? 's' : ''}</span>
              <button
                onClick={handleCreate}
                disabled={create.isPending}
                className="ml-auto text-xs px-3 py-1.5 bg-tom text-bg-app rounded-md font-semibold disabled:opacity-50"
              >
                + Novo
              </button>
            </div>
            <ul>
              {(list.data || []).map((tpl) => (
                <li key={tpl.id}>
                  <button
                    onClick={() => setSelectedId(tpl.id)}
                    className={`w-full flex items-start gap-2 px-3 py-2 text-left hover:bg-bg-surface ${
                      selectedId === tpl.id ? 'bg-bg-surface border-l-2 border-tom' : ''
                    }`}
                  >
                    <ToggleSwitch
                      checked={tpl.is_active}
                      onChange={(v) => toggleActive.mutate({ id: tpl.id, isActive: v })}
                    />
                    <div className="flex-1 min-w-0">
                      <div className={`text-sm font-medium ${tpl.is_active ? 'text-fg' : 'text-fg/50'}`}>
                        {tpl.name}
                      </div>
                      <div className="text-xs text-fg/60 truncate">
                        {tpl.dispatch_time?.slice(0, 5) ?? '—'}
                        {tpl.function_role ? ` · ${tpl.function_role}` : ''}
                      </div>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          </div>
          <div className="flex-1 min-w-0">
            {selectedId ? (
              <TemplateEditDrawer templateId={selectedId} onClose={() => setSelectedId(null)} />
            ) : (
              <div className="p-8 text-fg/40 text-sm">Selecione um template ou crie um novo.</div>
            )}
          </div>
        </div>
      </div>
    </PageShell>
  );
}

function ToggleSwitch({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={(e) => { e.stopPropagation(); onChange(!checked); }}
      className={`relative w-9 h-5 rounded-full transition-colors flex-shrink-0 mt-0.5 ${checked ? 'bg-tom' : 'bg-bg-app border border-border'}`}
      aria-pressed={checked}
    >
      <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full transition-transform ${checked ? 'translate-x-4 bg-bg-app' : 'bg-fg/40'}`} />
    </button>
  );
}
```

- [ ] **Step 2: TS compila (vai dar erro de TemplateEditDrawer ainda) — esperado**

- [ ] **Step 3: Commit**

```bash
git add web/src/screens/checklists/TemplatesPage.tsx
git commit -m "feat(checklists): TemplatesPage shell + lista"
```

---

### Task 5.3: TemplateEditDrawer (form completo, sem DnD nesta sprint)

> **Nota:** DnD de itens entra como melhoria fora desta sprint. Por ora, edição inline + ordem fixa por `sort_order` numérica. Botão "↑↓" se houver tempo.

**Files:**
- Create: `web/src/screens/checklists/TemplateEditDrawer.tsx`

- [ ] **Step 1: Implementar (sem DnD primeiro)**

```tsx
import { useState, useEffect } from 'react';
import { useTemplates, useTemplateItems, type OpChecklist } from './hooks/useTemplates';

interface Props { templateId: string; onClose: () => void; }

const DAYS = [
  { v: 1, label: 'Dom' },
  { v: 2, label: 'Seg' },
  { v: 3, label: 'Ter' },
  { v: 4, label: 'Qua' },
  { v: 5, label: 'Qui' },
  { v: 6, label: 'Sex' },
  { v: 7, label: 'Sáb' },
];

export function TemplateEditDrawer({ templateId, onClose }: Props) {
  const { list, update } = useTemplates();
  const tpl = (list.data || []).find((t) => t.id === templateId);
  const { list: items, addItem, updateItem, deleteItem, reorder } = useTemplateItems(templateId);

  const [form, setForm] = useState<Partial<OpChecklist>>({});
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (tpl) {
      setForm({
        name: tpl.name,
        dispatch_time: tpl.dispatch_time,
        function_role: tpl.function_role,
        unit: tpl.unit,
        completion_threshold: tpl.completion_threshold,
        days_of_week: tpl.days_of_week ?? [],
      });
      setDirty(false);
    }
  }, [tpl?.id, tpl?.name, tpl?.dispatch_time, tpl?.function_role, tpl?.unit, tpl?.completion_threshold]);

  if (!tpl) return <div className="p-8 text-fg/40">Template não encontrado.</div>;

  const setField = <K extends keyof OpChecklist>(k: K, v: OpChecklist[K]) => {
    setForm((f) => ({ ...f, [k]: v }));
    setDirty(true);
  };

  const handleSave = () => {
    update.mutate({ id: templateId, patch: form }, {
      onSuccess: () => setDirty(false),
      onError: (e: any) => alert(`Erro: ${e.message}`),
    });
  };

  const toggleDay = (d: number) => {
    const days = form.days_of_week ?? [];
    const next = days.includes(d) ? days.filter((x: number) => x !== d) : [...days, d].sort();
    setField('days_of_week', next);
  };

  const handleAddItem = () => {
    const txt = prompt('Descrição do item:');
    if (txt?.trim()) addItem.mutate(txt.trim());
  };

  return (
    <div className="flex flex-col h-full">
      <header className="px-4 py-3 border-b border-border flex items-center justify-between">
        <h2 className="text-fg font-semibold truncate">Editar template</h2>
        <button onClick={onClose} className="text-fg/60 hover:text-fg">✕</button>
      </header>

      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        <Field label="Nome">
          <input
            value={form.name ?? ''}
            onChange={(e) => setField('name', e.target.value)}
            className="w-full bg-bg-app border border-border rounded-md p-2 text-sm focus:outline-none focus:border-tom"
          />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Horário">
            <input
              type="time"
              value={form.dispatch_time?.slice(0, 5) ?? ''}
              onChange={(e) => setField('dispatch_time', e.target.value || null)}
              className="w-full bg-bg-app border border-border rounded-md p-2 text-sm focus:outline-none focus:border-tom"
            />
          </Field>
          <Field label="Threshold (%)">
            <input
              type="number" min={1} max={100}
              value={form.completion_threshold ?? 100}
              onChange={(e) => setField('completion_threshold', parseInt(e.target.value, 10))}
              className="w-full bg-bg-app border border-border rounded-md p-2 text-sm focus:outline-none focus:border-tom"
            />
          </Field>
        </div>

        <Field label="Dias da semana">
          <div className="flex flex-wrap gap-1">
            {DAYS.map((d) => (
              <button
                key={d.v}
                onClick={() => toggleDay(d.v)}
                className={`px-3 py-1.5 rounded-md text-xs font-medium ${
                  (form.days_of_week ?? []).includes(d.v)
                    ? 'bg-tom text-bg-app'
                    : 'bg-bg-app text-fg/60 border border-border hover:text-fg'
                }`}
              >
                {d.label}
              </button>
            ))}
          </div>
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Função">
            <input
              value={form.function_role ?? ''}
              onChange={(e) => setField('function_role', e.target.value)}
              placeholder="ex: secretary_morning"
              className="w-full bg-bg-app border border-border rounded-md p-2 text-sm focus:outline-none focus:border-tom"
            />
          </Field>
          <Field label="Unidade">
            <input
              value={form.unit ?? ''}
              onChange={(e) => setField('unit', e.target.value)}
              placeholder="all | campo_grande | recreio"
              className="w-full bg-bg-app border border-border rounded-md p-2 text-sm focus:outline-none focus:border-tom"
            />
          </Field>
        </div>

        <div>
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-medium text-fg/60 uppercase tracking-wider">Itens ({(items.data || []).length})</span>
            <button onClick={handleAddItem} className="text-xs text-tom hover:underline">+ Item</button>
          </div>
          <ul className="space-y-1">
            {(items.data || []).map((it) => (
              <li key={it.id} className="flex items-center gap-2 bg-bg-app border border-border rounded-md p-2">
                <span className="text-fg/40 text-xs">{it.sort_order}.</span>
                <input
                  defaultValue={it.description}
                  onBlur={(e) => {
                    if (e.target.value !== it.description) {
                      updateItem.mutate({ id: it.id, description: e.target.value });
                    }
                  }}
                  className="flex-1 bg-transparent text-sm text-fg focus:outline-none"
                />
                <button
                  onClick={() => { if (confirm('Remover item?')) deleteItem.mutate(it.id); }}
                  className="text-fg/40 hover:text-danger text-xs px-1"
                >🗑</button>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <footer className="border-t border-border p-3 flex items-center gap-2">
        {dirty && <span className="text-xs text-fg/60">Não salvo</span>}
        <button
          onClick={handleSave}
          disabled={!dirty || update.isPending}
          className="ml-auto text-xs px-4 py-2 bg-tom text-bg-app rounded-md font-semibold disabled:opacity-50"
        >
          {update.isPending ? 'Salvando…' : 'Salvar alterações'}
        </button>
      </footer>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-medium text-fg/60 uppercase tracking-wider mb-1">{label}</label>
      {children}
    </div>
  );
}
```

- [ ] **Step 2: TS + build**

```bash
cd web && npx tsc --noEmit && npx vite build
```

- [ ] **Step 3: Smoke test Chrome MCP**

1. Navegar pra `/checklists/templates`
2. Validar lista carrega
3. Clicar num template → drawer abre
4. Editar nome → "Não salvo" aparece → clicar Salvar
5. Toggle ativo/inativo na lista
6. + Novo → cria template novo

- [ ] **Step 4: Commit + push**

```bash
git add web/src/screens/checklists/TemplateEditDrawer.tsx
git commit -m "feat(checklists): TemplateEditDrawer com form completo"
git push origin main
```

- [ ] **Step 5: Pedir teste real**

"Sprint 5 deployada. Templates editáveis em `/checklists/templates`. Cria um teste, ativa, edita, adiciona itens. OK pra Sprint 6?"

---

# Sprint 6 — Cron Recorrência Pessoal + RecurrenceField

**Goal:** Criar cron `dispatchPersonalRecurrentes()` em rituals + componente `RecurrenceField` no editor de listas pessoais. Sem WhatsApp pra listas pessoais.

### Task 6.1: Função `dispatchPersonalRecurrentes` em rituals

**Files:**
- Modify: `src/rituals/dispatcher.js`

- [ ] **Step 1: Adicionar função**

Encontrar onde `dispatchChecklists` é definida em `src/rituals/dispatcher.js` e adicionar logo depois:

```js
async function dispatchPersonalRecurrentes() {
  const today = new Date();
  const refDate = today.toISOString().slice(0, 10);
  const dow = today.getDay() + 1; // JS getDay 0-6 (Dom-Sáb) → app 1-7
  const dom = today.getDate();

  console.log(`[Rituals] dispatchPersonalRecurrentes ref=${refDate} dow=${dow} dom=${dom}`);

  // Busca todas as listas recorrentes ativas
  const { data: lists, error } = await supabase
    .from('personal_checklists')
    .select('id, user_id, recurrence_type, days_of_week, day_of_month, name')
    .neq('recurrence_type', 'once')
    .is('archived_at', null);

  if (error) {
    console.error('[Rituals] dispatchPersonalRecurrentes erro select:', error.message);
    return { created: 0, errors: 1 };
  }

  let created = 0;
  let errors = 0;

  for (const l of lists || []) {
    let shouldDispatch = false;
    if (l.recurrence_type === 'daily') shouldDispatch = true;
    else if (l.recurrence_type === 'weekly' && Array.isArray(l.days_of_week) && l.days_of_week.includes(dow)) shouldDispatch = true;
    else if (l.recurrence_type === 'monthly' && l.day_of_month === dom) shouldDispatch = true;

    if (!shouldDispatch) continue;

    // Idempotente: UNIQUE (checklist_id, user_id, reference_date)
    const { error: insErr } = await supabase
      .from('personal_checklist_completions')
      .insert({
        checklist_id: l.id,
        user_id: l.user_id,
        reference_date: refDate,
        channel: 'cron',
      });

    if (insErr) {
      if (insErr.code === '23505') {
        // duplicate, ignora
      } else {
        console.error(`[Rituals] erro insert pcc list=${l.id}:`, insErr.message);
        errors++;
      }
    } else {
      created++;
    }
  }

  console.log(`[Rituals] dispatchPersonalRecurrentes done: created=${created} errors=${errors}`);
  return { created, errors };
}

module.exports.dispatchPersonalRecurrentes = dispatchPersonalRecurrentes;
```

- [ ] **Step 2: Agendar no scheduler do dispatcher**

Encontrar onde o cron está sendo executado (provavelmente um setInterval ou agendamento em `dispatcher.js`). Adicionar trigger pra rodar 1×/dia às 00:30 BRT:

```js
// Já existe algo tipo cron.schedule(...). Adicionar:
cron.schedule('30 0 * * *', () => dispatchPersonalRecurrentes(), { timezone: 'America/Sao_Paulo' });
```

(Se a infraestrutura de cron usa node-cron, este é o formato. Se usa setInterval, adicionar lógica equivalente.)

- [ ] **Step 3: Sintaxe OK**

```bash
node --check src/rituals/dispatcher.js
```

- [ ] **Step 4: SCP + restart**

```bash
scp D:/la-organizer/_remote/src/rituals/dispatcher.js tom:/opt/LA-Organizer/src/rituals/dispatcher.js
ssh tom "pm2 restart tom"
```

- [ ] **Step 5: Validar logs**

```bash
ssh tom "pm2 logs tom --lines 30 --nostream"
```

Expected: ver `[Rituals] dispatchPersonalRecurrentes ref=... dow=... dom=...` quando o cron rodar (forçar manualmente se necessário com um teste extra na VPS).

- [ ] **Step 6: Commit**

```bash
git add src/rituals/dispatcher.js
git commit -m "feat(tom): cron dispatchPersonalRecurrentes (sem WhatsApp)"
```

---

### Task 6.2: Componente RecurrenceField (PWA)

**Files:**
- Create: `web/src/screens/checklists/RecurrenceField.tsx`

- [ ] **Step 1: Implementar**

```tsx
interface Value {
  recurrence_type: 'once' | 'daily' | 'weekly' | 'monthly';
  days_of_week?: number[];
  day_of_month?: number;
}

interface Props {
  value: Value;
  onChange: (v: Value) => void;
}

const TYPES: Array<{ v: Value['recurrence_type']; label: string }> = [
  { v: 'once', label: 'Uma vez' },
  { v: 'daily', label: 'Diária' },
  { v: 'weekly', label: 'Semanal' },
  { v: 'monthly', label: 'Mensal' },
];

const WEEK = [
  { v: 1, label: 'Dom' }, { v: 2, label: 'Seg' }, { v: 3, label: 'Ter' },
  { v: 4, label: 'Qua' }, { v: 5, label: 'Qui' }, { v: 6, label: 'Sex' }, { v: 7, label: 'Sáb' },
];

export function RecurrenceField({ value, onChange }: Props) {
  const setType = (t: Value['recurrence_type']) => {
    onChange({ recurrence_type: t, days_of_week: t === 'weekly' ? [] : undefined, day_of_month: t === 'monthly' ? 1 : undefined });
  };
  const toggleDay = (d: number) => {
    const days = value.days_of_week ?? [];
    onChange({ ...value, days_of_week: days.includes(d) ? days.filter((x) => x !== d) : [...days, d].sort() });
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1">
        {TYPES.map((t) => (
          <button
            key={t.v}
            onClick={() => setType(t.v)}
            className={`px-3 py-1.5 rounded-full text-xs font-medium ${
              value.recurrence_type === t.v ? 'bg-tom text-bg-app' : 'bg-bg-app text-fg/60 border border-border hover:text-fg'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      {value.recurrence_type === 'weekly' && (
        <div className="flex flex-wrap gap-1 pt-1">
          {WEEK.map((d) => (
            <button
              key={d.v}
              onClick={() => toggleDay(d.v)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium ${
                (value.days_of_week ?? []).includes(d.v) ? 'bg-tom text-bg-app' : 'bg-bg-app text-fg/60 border border-border'
              }`}
            >
              {d.label}
            </button>
          ))}
        </div>
      )}
      {value.recurrence_type === 'monthly' && (
        <input
          type="number" min={1} max={31}
          value={value.day_of_month ?? 1}
          onChange={(e) => onChange({ ...value, day_of_month: parseInt(e.target.value, 10) })}
          className="w-24 bg-bg-app border border-border rounded-md p-2 text-sm focus:outline-none focus:border-tom"
        />
      )}
    </div>
  );
}
```

- [ ] **Step 2: Plugar no PersonalChecklistSheet**

Encontrar `web/src/components/PersonalChecklistSheet.tsx` (criação/edição de lista pessoal mobile) e adicionar antes do botão Salvar:

```tsx
import { RecurrenceField } from '../screens/checklists/RecurrenceField';
// ...

<div className="mt-3">
  <label className="block text-xs font-medium text-fg/60 mb-1 uppercase tracking-wider">Recorrência</label>
  <RecurrenceField
    value={{
      recurrence_type: form.recurrence_type ?? 'once',
      days_of_week: form.days_of_week,
      day_of_month: form.day_of_month,
    }}
    onChange={(v) => setForm({ ...form, ...v })}
  />
</div>
```

E garantir que ao salvar, esses campos vão pro INSERT em `personal_checklists`.

- [ ] **Step 3: TS + build**

- [ ] **Step 4: Commit + push**

```bash
git add web/src/screens/checklists/RecurrenceField.tsx web/src/components/PersonalChecklistSheet.tsx
git commit -m "feat(checklists): RecurrenceField em lista pessoal"
git push origin main
```

- [ ] **Step 5: Pedir teste real**

"Sprint 6 deployada + TOM com cron novo. Cria uma lista pessoal recorrente (ex: 'Remédios manhã' diária). Amanhã deve aparecer no /checklists Pessoal automaticamente. OK pra Sprint 7?"

---

# Sprint 7 — TOM Skills (Anexo, Tarefa Derivada, Justificar)

**Goal:** 3 skills novas + parsers em engine.js pra fluxos via WhatsApp.

### Task 7.1: Skill checklists-anexo

**Files:**
- Create: `skills/checklists-anexo.md`

- [ ] **Step 1: Escrever skill**

```markdown
# Skill: Anexo em Checklist (foto/PDF)

## Quando usar
Colaborador envia uma foto/imagem após receber checklist do dia OU mencionando um item.

## Como agir
1. Detectar mensagem de mídia (image/jpeg, image/png, image/webp, application/pdf)
2. Se contexto recente é um checklist (últimas mensagens contém `<<CHECKLIST_ACTION>>` ou nome de template), perguntar: "Pra qual item? (responde o número)"
3. Esperar resposta com número do item
4. Emitir marker:

`<<CHECKLIST_ATTACHMENT>>{"completion_id":"<uuid>","item_id":"<uuid>","mime_type":"image/jpeg","file_name":"foto.jpg","media_id":"<uazapi_media_id>"}<<END>>`

5. Engine baixa a mídia da UAZAPI, faz upload pro bucket `checklist-attachments` e insere row em `checklist_attachments`.

## Limites
- Tamanho máximo: 10MB
- Tipos permitidos: image/jpeg, image/png, image/webp, application/pdf
- Anexo só funciona se item_completion existe (item já foi tocado ao menos uma vez no checklist do dia)
```

- [ ] **Step 2: Commit**

```bash
git add skills/checklists-anexo.md
git commit -m "feat(tom): skill checklists-anexo"
```

---

### Task 7.2: Skill checklists-tarefa-derivada

**Files:**
- Create: `skills/checklists-tarefa-derivada.md`

- [ ] **Step 1: Escrever skill**

```markdown
# Skill: Tarefa derivada de checklist

## Quando usar
Colaborador menciona problema/pendência durante checklist (ex: "lâmpada queimada", "porta com defeito", "sala suja"). TOM oferece criar tarefa de manutenção.

## Como agir
1. Detectar palavras-chave de problema em mensagem dentro de contexto checklist:
   - "queimou", "quebrou", "vazou", "sumiu", "estragou", "faltou", "trocar", "consertar"
2. Perguntar: "Quer que eu abra uma tarefa pra resolver isso?"
3. Se sim, capturar:
   - Título sugerido (gerar a partir da fala, ex: "Trocar lâmpada sala 5")
   - Item de checklist relacionado (pedir número se ambíguo)
4. Emitir:

`<<DERIVE_TASK>>{"completion_id":"<uuid>","item_id":"<uuid>","title":"<titulo>","description":"<contexto>"}<<END>>`

5. Engine cria task + linka via `op_checklist_item_completions.derived_task_id`.

## Boa prática
- Sempre confirmar título antes de criar
- Se item_id ambíguo, pedir número (1, 2, 3…)
- Mencionar prazo padrão: "vai pra sua agenda como aberta, sem prazo"
```

- [ ] **Step 2: Commit**

```bash
git add skills/checklists-tarefa-derivada.md
git commit -m "feat(tom): skill checklists-tarefa-derivada"
```

---

### Task 7.3: Skill checklists-justificar

**Files:**
- Create: `skills/checklists-justificar.md`

- [ ] **Step 1: Escrever skill**

```markdown
# Skill: Justificar não-execução de checklist

## Quando usar
Colaborador diz que não fez o checklist do dia OU dá motivo de descumprimento (ex: "hoje não consegui porque a escola fechou", "não vou conseguir hoje, tô doente").

## Como agir
1. Detectar gatilho em resposta a cobrança de checklist:
   - "não vou conseguir", "não vou fazer", "não consegui", "deixei de fazer porque…"
2. Perguntar (se motivo curto): "Anota essa justificativa pra você?"
3. Capturar texto completo
4. Emitir:

`<<CHECKLIST_JUSTIFY>>{"completion_id":"<uuid>","justification":"<texto>"}<<END>>`

5. Engine salva em `op_checklist_completions.justification` + `justified_at` + `justified_by_id`.

## Após justificar
- Não cobrar mais o checklist do dia
- Avisar líder via push opcional: "Gabi justificou Abertura Escola — 'escola fechou hoje'"
```

- [ ] **Step 2: Commit**

```bash
git add skills/checklists-justificar.md
git commit -m "feat(tom): skill checklists-justificar"
```

---

### Task 7.4: Parsers no engine.js

**Files:**
- Modify: `src/engine.js`

- [ ] **Step 1: Adicionar parsers + apply functions**

Localizar funções `parseChecklistActionMarker` e `applyChecklistAction` em `src/engine.js` (no entorno das linhas 449-608 conforme auditoria). Adicionar 3 parsers + 3 apply functions logo depois:

```js
// ============== CHECKLIST_ATTACHMENT ==============

function parseChecklistAttachmentMarker(text) {
  const match = text.match(/<<CHECKLIST_ATTACHMENT>>([\s\S]*?)<<END>>/);
  if (!match) return null;
  try {
    const json = JSON.parse(match[1].trim());
    if (!json.completion_id || !json.item_id || !json.media_id || !json.mime_type) return null;
    return json;
  } catch { return null; }
}

async function applyChecklistAttachment({ completion_id, item_id, mime_type, file_name, media_id, collab }) {
  // 1. Baixa mídia do UAZAPI
  const mediaUrl = `${process.env.UAZAPI_URL}/media/${media_id}`;
  const resp = await fetch(mediaUrl, { headers: { token: process.env.UAZAPI_TOKEN } });
  if (!resp.ok) throw new Error(`UAZAPI media fetch falhou: ${resp.status}`);
  const buf = await resp.arrayBuffer();

  // 2. Resolve item_completion_id real
  const { data: ic } = await supabase
    .from('op_checklist_item_completions')
    .select('id')
    .eq('completion_id', completion_id)
    .eq('item_id', item_id)
    .maybeSingle();
  if (!ic) throw new Error('item_completion não existe — peça pro colab marcar/desmarcar o item primeiro');

  // 3. Upload pro bucket
  const ext = mime_type.split('/')[1] || 'bin';
  const path = `work/${collab.id}/${ic.id}/${crypto.randomUUID()}.${ext}`;
  const { error: upErr } = await supabase.storage
    .from('checklist-attachments')
    .upload(path, buf, { contentType: mime_type, cacheControl: '3600' });
  if (upErr) throw upErr;

  // 4. Insere row
  const { error: insErr } = await supabase.from('checklist_attachments').insert({
    scope: 'work',
    item_completion_id: ic.id,
    storage_path: path,
    file_name: file_name || `anexo.${ext}`,
    mime_type,
    size_bytes: buf.byteLength,
    uploaded_by: collab.id,
  });
  if (insErr) throw insErr;

  return { ok: true };
}

// ============== DERIVE_TASK ==============

function parseDeriveTaskMarker(text) {
  const match = text.match(/<<DERIVE_TASK>>([\s\S]*?)<<END>>/);
  if (!match) return null;
  try {
    const json = JSON.parse(match[1].trim());
    if (!json.completion_id || !json.item_id || !json.title) return null;
    return json;
  } catch { return null; }
}

async function applyDeriveTask({ completion_id, item_id, title, description, collab }) {
  // 1. Cria task
  const { data: task, error: tErr } = await supabase
    .from('tasks')
    .insert({
      owner_id: collab.id,
      title,
      description: description || null,
      status: 'open',
      context: 'work',
      created_via: 'tom_checklist_derive',
    })
    .select('id')
    .single();
  if (tErr) throw tErr;

  // 2. Linka na row item_completion (upsert)
  const { error: linkErr } = await supabase
    .from('op_checklist_item_completions')
    .upsert({
      completion_id,
      item_id,
      derived_task_id: task.id,
    }, { onConflict: 'completion_id,item_id' });
  if (linkErr) throw linkErr;

  return { ok: true, task_id: task.id };
}

// ============== CHECKLIST_JUSTIFY ==============

function parseChecklistJustifyMarker(text) {
  const match = text.match(/<<CHECKLIST_JUSTIFY>>([\s\S]*?)<<END>>/);
  if (!match) return null;
  try {
    const json = JSON.parse(match[1].trim());
    if (!json.completion_id || !json.justification) return null;
    return json;
  } catch { return null; }
}

async function applyChecklistJustify({ completion_id, justification, collab }) {
  const { error } = await supabase
    .from('op_checklist_completions')
    .update({
      justification,
      justified_at: new Date().toISOString(),
      justified_by_id: collab.id,
    })
    .eq('id', completion_id);
  if (error) throw error;
  return { ok: true };
}
```

- [ ] **Step 2: Plugar no fluxo principal de processamento de markers**

Encontrar o local em `engine.js` onde markers são processados em sequência (depois de `parseChecklistActionMarker`). Adicionar:

```js
// Após o processamento de <<CHECKLIST_ACTION>>:

const attachmentMarker = parseChecklistAttachmentMarker(responseText);
if (attachmentMarker) {
  try {
    await applyChecklistAttachment({ ...attachmentMarker, collab });
    console.log('[Engine] CHECKLIST_ATTACHMENT applied');
  } catch (e) {
    console.error('[Engine] CHECKLIST_ATTACHMENT failed:', e.message);
  }
}

const deriveMarker = parseDeriveTaskMarker(responseText);
if (deriveMarker) {
  try {
    const result = await applyDeriveTask({ ...deriveMarker, collab });
    console.log('[Engine] DERIVE_TASK applied:', result.task_id);
  } catch (e) {
    console.error('[Engine] DERIVE_TASK failed:', e.message);
  }
}

const justifyMarker = parseChecklistJustifyMarker(responseText);
if (justifyMarker) {
  try {
    await applyChecklistJustify({ ...justifyMarker, collab });
    console.log('[Engine] CHECKLIST_JUSTIFY applied');
  } catch (e) {
    console.error('[Engine] CHECKLIST_JUSTIFY failed:', e.message);
  }
}
```

- [ ] **Step 3: Sintaxe OK**

```bash
node --check src/engine.js
```

- [ ] **Step 4: SCP + restart**

```bash
scp D:/la-organizer/_remote/src/engine.js tom:/opt/LA-Organizer/src/engine.js
scp D:/la-organizer/_remote/skills/checklists-anexo.md tom:/opt/LA-Organizer/skills/
scp D:/la-organizer/_remote/skills/checklists-tarefa-derivada.md tom:/opt/LA-Organizer/skills/
scp D:/la-organizer/_remote/skills/checklists-justificar.md tom:/opt/LA-Organizer/skills/
ssh tom "pm2 restart tom"
```

- [ ] **Step 5: Validar logs**

```bash
ssh tom "pm2 logs tom --lines 20 --nostream"
```

Expected: TOM rebootou sem erros.

- [ ] **Step 6: Commit + push**

```bash
git add src/engine.js skills/checklists-anexo.md skills/checklists-tarefa-derivada.md skills/checklists-justificar.md
git commit -m "feat(tom): 3 skills novas + parsers (anexo, tarefa derivada, justificar)"
git push origin main
```

- [ ] **Step 7: Smoke test WhatsApp**

Pedir pro user:
1. Manda foto pro TOM em contexto de checklist do dia
2. Manda "lâmpada queimada na sala 5" → TOM deve oferecer criar tarefa
3. Manda "hoje não vou fazer porque a escola fechou" → TOM deve oferecer justificar

Validar via SELECT:
```sql
SELECT id, justification, justified_at FROM op_checklist_completions WHERE justification IS NOT NULL ORDER BY justified_at DESC LIMIT 5;
SELECT id, title, created_via FROM tasks WHERE created_via='tom_checklist_derive' ORDER BY created_at DESC LIMIT 5;
SELECT id, file_name, scope FROM checklist_attachments ORDER BY created_at DESC LIMIT 5;
```

---

# Sprint 8 — Realtime sync TOM ↔ PWA

**Goal:** Subscriber em item_completions (work + personal) + attachments, broadcasting via Realtime pro PWA.

### Task 8.1: Estender subscriber em `tom-realtime.js`

**Files:**
- Modify: `src/realtime/tom-realtime.js`

- [ ] **Step 1: Adicionar subscriptions**

Encontrar o local onde `op_checklist_completions` já está subscrito e adicionar:

```js
// Sprint 23.7 — broadcast de item completions + attachments

const itemCompletionsChannel = supabase
  .channel('checklist_item_completions')
  .on('postgres_changes', { event: '*', schema: 'public', table: 'op_checklist_item_completions' }, (payload) => {
    console.log('[Realtime] op_checklist_item_completions', payload.eventType, payload.new?.id || payload.old?.id);
  })
  .on('postgres_changes', { event: '*', schema: 'public', table: 'personal_checklist_item_completions' }, (payload) => {
    console.log('[Realtime] personal_checklist_item_completions', payload.eventType);
  })
  .on('postgres_changes', { event: '*', schema: 'public', table: 'checklist_attachments' }, (payload) => {
    console.log('[Realtime] checklist_attachments', payload.eventType);
  })
  .subscribe();
```

- [ ] **Step 2: Cliente PWA — adicionar listeners de realtime**

Em `web/src/screens/checklists/hooks/useChecklistsHoje.ts`, adicionar dentro de `useChecklistsHoje`:

```ts
import { useEffect } from 'react';

// dentro do hook, após o useQuery:
const qc = useQueryClient();
useEffect(() => {
  const ch = supabase
    .channel('checklists-hoje-realtime')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'op_checklist_item_completions' }, () => {
      qc.invalidateQueries({ queryKey: ['checklists-hoje'] });
      qc.invalidateQueries({ queryKey: ['checklists-kpi'] });
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'personal_checklist_item_completions' }, () => {
      qc.invalidateQueries({ queryKey: ['checklists-hoje'] });
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'op_checklist_completions' }, () => {
      qc.invalidateQueries({ queryKey: ['checklists-hoje'] });
      qc.invalidateQueries({ queryKey: ['checklists-kpi'] });
    })
    .subscribe();
  return () => { supabase.removeChannel(ch); };
}, [qc]);
```

(Precisa importar `useQueryClient` e `useEffect`)

- [ ] **Step 3: Sintaxe + TS + build**

```bash
node --check src/realtime/tom-realtime.js
cd web && npx tsc --noEmit && npx vite build
```

- [ ] **Step 4: SCP + restart**

```bash
scp D:/la-organizer/_remote/src/realtime/tom-realtime.js tom:/opt/LA-Organizer/src/realtime/tom-realtime.js
ssh tom "pm2 restart tom"
```

- [ ] **Step 5: Commit + push**

```bash
git add src/realtime/tom-realtime.js web/src/screens/checklists/hooks/useChecklistsHoje.ts
git commit -m "feat(realtime): broadcast item_completions + attachments + cliente subscribe"
git push origin main
```

- [ ] **Step 6: Smoke test bidirecional**

1. Abrir `/checklists` no desktop
2. Marcar um item via WhatsApp (TOM)
3. Validar checkbox no PWA atualiza em < 3s sem refresh
4. Inverso: marcar item no PWA
5. Pedir TOM mostrar status no WhatsApp — deve refletir a marcação

---

# Sprint 9 — Polimento Mobile

**Goal:** Garantir que mobile não quebrou + portar Cards de Aderência pro mobile (sem tabela).

### Task 9.1: Validar mobile não quebrou

- [ ] **Step 1: Chrome MCP em 375px**

1. Resize pra 375×812
2. Abrir `/checklists`
3. Validar tela mobile original (ChecklistsMobile) carrega
4. Trocar tabs Trabalho/Pessoal funciona
5. Abrir um checklist → expansão inline funciona
6. Screenshot pra confirmar

- [ ] **Step 2: Validar mobile de Templates**

Em mobile, `/checklists/templates` deve ser acessível (mesmo que com layout simples — cabe na sprint futura). Se quebrar, esconder rota em mobile e mostrar mensagem "Templates só desktop".

---

### Task 9.2: Portar Aderência (só cards) pro mobile

**Files:**
- Modify: `web/src/screens/checklists/ChecklistsMobile.tsx`

- [ ] **Step 1: Adicionar 3a tab "Aderência" no mobile**

Encontrar no `ChecklistsMobile.tsx` o tab switcher (atualmente Trabalho/Pessoal) e adicionar nova tab "Aderência" depois.

Quando ativa, renderizar `AderenciaCards` (não tabela, não filtros — só hoje, fixo).

```tsx
{activeTab === 'aderencia' && (
  <AderenciaCards data={(useAderencia('today').data?.byTemplate) || []} />
)}
```

- [ ] **Step 2: TS + build**

```bash
cd web && npx tsc --noEmit && npx vite build
```

- [ ] **Step 3: Smoke test mobile**

1. Chrome MCP em 375×812
2. Trocar pra tab Aderência
3. Validar cards renderizam corretamente (responsivo)

- [ ] **Step 4: Commit + push**

```bash
git add web/src/screens/checklists/ChecklistsMobile.tsx
git commit -m "feat(checklists): porta AderenciaCards pro mobile"
git push origin main
```

---

### Task 9.3: Validação final do projeto

- [ ] **Step 1: Rodar checklist de qualidade**

```bash
cd web && npx tsc --noEmit
cd web && npx vite build
node --check src/engine.js
node --check src/rituals/dispatcher.js
node --check src/realtime/tom-realtime.js
```
Todos devem retornar zero erros.

- [ ] **Step 2: Chrome MCP — smoke test final completo**

- Desktop 1440×900: `/checklists` → tabs Hoje + Aderência (Cards + Tabela) + ⚙️ → `/checklists/templates`
- Mobile 375×812: ChecklistsMobile original + nova tab Aderência
- Bidirecional TOM ↔ PWA via realtime

- [ ] **Step 3: Reportar fechamento**

"Projeto Checklists Desktop fechado. 9 sprints concluídas. Mobile intocado + Desktop completo + TOM com 3 skills novas + bidirecional realtime. Plano salvo em `docs/superpowers/plans/2026-05-27-checklists-desktop.md`."
