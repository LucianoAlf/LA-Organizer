# Modelos de tarefa pessoais (task_templates) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cada usuário salva o formulário do "Novo" (QuickCreateSheet) como modelo nomeado privado, reutilizável nas 4 abas (Tarefa/Compromisso/Delegar/Grupo), com CRUD completo.

**Architecture:** Tabela `task_templates` (kind + payload jsonb, RLS 100% dono) + lib pura `taskTemplates.ts` (snapshot→payload whitelist por kind; payload→patch com validação de ids envelhecidos) + `TaskTemplatePicker` abaixo das abas + `TaskTemplatesSheet` de gestão. QuickCreateSheet fornece `buildSnapshot()`/`applyPatch()`. Espelha o padrão recém-entregue dos modelos de checklist.

**Tech Stack:** React+TS+Vite, Tailwind DS (CustomSelect/AdaptiveSheet/Button/ConfirmDialog), react-query, Supabase (RLS `current_collab_id()`), vitest.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-07-task-templates-design.md` (aprovada pelo Alf 07/07).
- **NUNCA salvar data nem recurrenceRule no payload** (whitelist por kind é o guardrail).
- RLS e UI: só o dono (`created_by = current_collab_id()`); nem coordenação vê modelo alheio.
- DS obrigatório; sem `<select>` nativo. Testar 375px e 1440px.
- Zero mudança em engine.js / system.js / TOM.
- **Sem commits entre tasks** (CLAUDE.md: auto-deploy no fim do turno). Migration aplicada via MCP Supabase (`cesnbnrynvxvgdhfmaua`).
- Validação: `npx tsc --noEmit`, `npx vite build`, `npx vitest run` em `_remote/web`; E2E no preview `localhost:4173` conferindo o BANCO.

---

### Task 1: Migration `task_templates` + RLS

**Files:**
- Create: `_remote/supabase/migrations/20260707_task_templates.sql`

**Interfaces:**
- Produces: tabela `task_templates(id, name, kind, payload, created_by, created_at, updated_at)`; índice único `(created_by, lower(btrim(name)))`.

- [ ] **Step 1: Escrever a migration**

```sql
-- Modelos de tarefa PESSOAIS (demanda Jonathan ADM 07/07).
-- Diferente de checklist_templates (time): aqui RLS = só o dono, em TODAS as operações.
-- Spec: docs/superpowers/specs/2026-07-07-task-templates-design.md
create table task_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 2 and 80),
  kind text not null check (kind in ('task','event','delegated','group')),
  payload jsonb not null default '{}'::jsonb,
  created_by uuid not null references collaborators(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index task_templates_owner_name_uq
  on task_templates (created_by, lower(btrim(name)));

alter table task_templates enable row level security;

create policy task_templates_select on task_templates
  for select to authenticated using (created_by = current_collab_id());
create policy task_templates_insert on task_templates
  for insert to authenticated with check (created_by = current_collab_id());
create policy task_templates_update on task_templates
  for update to authenticated using (created_by = current_collab_id())
  with check (created_by = current_collab_id());
create policy task_templates_delete on task_templates
  for delete to authenticated using (created_by = current_collab_id());
```

- [ ] **Step 2: Aplicar via MCP** `apply_migration(project cesnbnrynvxvgdhfmaua, name task_templates)`.
- [ ] **Step 3: Verificar** com `execute_sql`: `select policyname from pg_policies where tablename='task_templates'` → 4 policies; insert de teste com service role setando created_by + delete.

### Task 2: Lib pura `taskTemplates.ts` (TDD)

**Files:**
- Create: `_remote/web/src/lib/taskTemplates.ts`
- Test: `_remote/web/src/lib/taskTemplates.test.ts`

**Interfaces:**
- Consumes: `normalizeTemplateName`, `isDupName` reexportados de `./checklistTemplates` (DRY).
- Produces:
  - `type TemplateKind = 'task' | 'event' | 'delegated' | 'group'`
  - `interface TaskTemplate { id: string; name: string; kind: TemplateKind; payload: Record<string, unknown>; created_by: string }`
  - `payloadFromSnapshot(kind, snap: Record<string, unknown>): Record<string, unknown>` — whitelist por kind; NUNCA deixa passar `due`/datas/`recurrence`.
  - `isSnapshotEmpty(payload): boolean` — sem título e sem conteúdo relevante.
  - `formPatchFromPayload(kind, payload, refs: { collabIds: Set<string>; categoryIds: Set<string>; groupIds: Set<string> }): { patch: Record<string, unknown>; warnings: string[] }` — limpa ids envelhecidos com aviso.
  - I/O: `listMyTemplates(): Promise<TaskTemplate[]>`, `createTaskTemplate(name, kind, payload, collabId)`, `updateTaskTemplate(id, patch)`, `deleteTaskTemplate(id)`.

- [ ] **Step 1: Testes falhando** (vitest) — casos: whitelist por kind (snapshot com `due`/`recurrenceRule` extra → payload SEM eles); `delegated` mantém `delegate_to`/`cc_ids`, `task` não; `isSnapshotEmpty` (título vazio + checklist vazio = true; só checklist preenchido = false); `formPatchFromPayload` com delegado inexistente → patch sem `delegate_to` + 1 warning; `cc_ids`/`participant_ids` parcialmente inválidos → filtra + warning; `category_id` inválido → null sem warning fatal (warning suave); `group_id` inválido → `group_mode:false` + warning; payload antigo com campo desconhecido → ignorado sem erro.
- [ ] **Step 2: Rodar e ver falhar** (`npx vitest run src/lib/taskTemplates.test.ts`).
- [ ] **Step 3: Implementar**

```ts
import { supabase } from './supabase';
export { normalizeTemplateName, isDupName } from './checklistTemplates';

export type TemplateKind = 'task' | 'event' | 'delegated' | 'group';
export interface TaskTemplate {
  id: string; name: string; kind: TemplateKind;
  payload: Record<string, unknown>; created_by: string;
}

// Whitelist POR KIND — o guardrail que impede data/recorrência de entrar no modelo.
const KEYS: Record<TemplateKind, readonly string[]> = {
  task: ['title', 'description', 'ctx', 'group_mode', 'group_id', 'time', 'reminders', 'quadrant', 'checklist'],
  delegated: ['title', 'description', 'ctx', 'delegate_to', 'cc_ids', 'time', 'reminders', 'quadrant', 'checklist'],
  event: ['title', 'description', 'category_id', 'start_time', 'end_time', 'modality',
    'location_text', 'meeting_url', 'quadrant', 'reminders', 'participant_ids'],
  group: ['title', 'description', 'group_id', 'monthly', 'due_day', 'children'],
};

export function payloadFromSnapshot(kind: TemplateKind, snap: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of KEYS[kind]) if (snap[k] !== undefined && snap[k] !== '' && snap[k] !== null) out[k] = snap[k];
  return out;
}

export function isSnapshotEmpty(payload: Record<string, unknown>): boolean {
  const title = typeof payload.title === 'string' ? payload.title.trim() : '';
  if (title) return false;
  const checklist = Array.isArray(payload.checklist) ? payload.checklist : [];
  const children = Array.isArray(payload.children) ? payload.children : [];
  return checklist.length === 0 && children.length === 0;
}

export function formPatchFromPayload(
  kind: TemplateKind, payload: Record<string, unknown>,
  refs: { collabIds: Set<string>; categoryIds: Set<string>; groupIds: Set<string> },
): { patch: Record<string, unknown>; warnings: string[] } {
  const patch = payloadFromSnapshot(kind, payload); // re-whitelist: payload antigo/desconhecido cai fora
  const warnings: string[] = [];
  if (typeof patch.delegate_to === 'string' && !refs.collabIds.has(patch.delegate_to)) {
    delete patch.delegate_to; warnings.push('O responsável salvo no modelo saiu do time — escolhe outro.');
  }
  for (const key of ['cc_ids', 'participant_ids'] as const) {
    if (Array.isArray(patch[key])) {
      const ok = (patch[key] as string[]).filter((id) => refs.collabIds.has(id));
      if (ok.length < (patch[key] as string[]).length) warnings.push('Removi do modelo pessoas que saíram do time.');
      patch[key] = ok;
    }
  }
  if (typeof patch.category_id === 'string' && !refs.categoryIds.has(patch.category_id)) {
    delete patch.category_id; warnings.push('A categoria do modelo não existe mais.');
  }
  if (typeof patch.group_id === 'string' && !refs.groupIds.has(patch.group_id)) {
    delete patch.group_id; patch.group_mode = false;
    warnings.push('O grupo do modelo não existe mais — voltei o responsável pra você.');
  }
  return { patch, warnings };
}

export async function listMyTemplates(): Promise<TaskTemplate[]> {
  const { data, error } = await supabase
    .from('task_templates').select('id, name, kind, payload, created_by').order('name');
  if (error) throw error;
  return (data ?? []) as TaskTemplate[];
}
export async function createTaskTemplate(
  name: string, kind: TemplateKind, payload: Record<string, unknown>, collabId: string,
): Promise<void> {
  const { error } = await supabase.from('task_templates').insert({ name, kind, payload, created_by: collabId });
  if (error) throw error;
}
export async function updateTaskTemplate(
  id: string, patch: { name?: string; payload?: Record<string, unknown> },
): Promise<void> {
  const { error } = await supabase.from('task_templates')
    .update({ ...patch, updated_at: new Date().toISOString() }).eq('id', id);
  if (error) throw error;
}
export async function deleteTaskTemplate(id: string): Promise<void> {
  const { error } = await supabase.from('task_templates').delete().eq('id', id);
  if (error) throw error;
}
```

- [ ] **Step 4: Rodar e ver passar**; depois `npx vitest run` completo (suite ~312+ verde).

### Task 3: `TaskTemplatesSheet` (gestão CRUD)

**Files:**
- Create: `_remote/web/src/components/TaskTemplatesSheet.tsx`

**Interfaces:**
- Consumes: Task 2 (`listMyTemplates`, `updateTaskTemplate`, `deleteTaskTemplate`, `normalizeTemplateName`, `isDupName`, `payloadFromSnapshot`, `isSnapshotEmpty`, `TaskTemplate`, `TemplateKind`).
- Produces: `<TaskTemplatesSheet open onClose activeKind getSnapshot />` — `getSnapshot(): Record<string, unknown>` é o snapshot cru da aba ativa do QuickCreateSheet.

- [ ] **Step 1: Implementar.** AdaptiveSheet `size="sm"`, título "Meus modelos". Lista `listMyTemplates()` (query key `['task-templates']`) com: nome, badge do kind (`Tarefa/Compromisso/Delegar/Grupo` — map local `KIND_LABEL`), resumo (`payload.title`). Ações por linha: renomear (input inline, Enter salva via `updateTaskTemplate(id, { name })`, erro 23505 → toast duplicado), **"Atualizar com o formulário atual"** (ícone RefreshCw; só habilitado quando `t.kind === activeKind`; confirma via ConfirmDialog "Sobrescrever '<nome>' com o que está no formulário agora?" → `updateTaskTemplate(id, { payload: payloadFromSnapshot(activeKind, getSnapshot()) })`, bloqueando com toast se `isSnapshotEmpty`), excluir (ConfirmDialog "Tarefas já criadas não mudam. Não dá pra desfazer."). Estado vazio: "Nenhum modelo seu ainda — salva um pelo formulário." Sem editor campo-a-campo (decisão da spec).
- [ ] **Step 2: `npx tsc --noEmit`** limpo.

### Task 4: `TaskTemplatePicker` + integração no QuickCreateSheet

**Files:**
- Create: `_remote/web/src/components/TaskTemplatePicker.tsx`
- Modify: `_remote/web/src/components/QuickCreateSheet.tsx` (picker após o grid de abas ~l.765; helpers `buildSnapshot`/`applyPatch` junto dos handlers ~l.600)

**Interfaces:**
- Consumes: Tasks 2–3.
- Produces: `<TaskTemplatePicker kind getSnapshot onPick />` onde `onPick(t: TaskTemplate)` é resolvido pelo QuickCreateSheet.

- [ ] **Step 1: Picker.** Mesmo esqueleto do ChecklistTemplatePicker: CustomSelect `placeholder="Meus modelos…"` `size="sm"`, options = `listMyTemplates()` filtrado por `t.kind === kind` (sublabel = `payload.title`), + sentinel `__manage__` "⚙️ Gerenciar meus modelos…". Link "salvar como modelo" (sempre visível; input inline de nome, Enter salva `createTaskTemplate(n, kind, payloadFromSnapshot(kind, getSnapshot()), collaborator.id)`; bloqueia com toast "Preenche o formulário antes de salvar como modelo." se `isSnapshotEmpty`; 23505 → "Já existe um modelo seu com esse nome."). Toast de sucesso: "Modelo salvo — só você vê." Monta `<TaskTemplatesSheet activeKind={kind} getSnapshot={getSnapshot} />`.
- [ ] **Step 2: QuickCreateSheet — `buildSnapshot()`** (switch no `kind` lendo o estado atual):

```ts
function buildSnapshot(): Record<string, unknown> {
  if (kind === 'task') return { title, description, ctx: taskCtx, group_mode: taskGroupMode, group_id: taskGroupId || null, time: taskTime || null, reminders: taskReminderTimes, quadrant: taskQuadrant, checklist: checklistDraft };
  if (kind === 'delegated') return { title, description, ctx: taskCtx, delegate_to: delegateTo || null, cc_ids: ccIds, time: taskTime || null, reminders: taskReminderTimes, quadrant: taskQuadrant, checklist: checklistDraft };
  if (kind === 'event') return { title, description, category_id: categoryId || null, start_time: startAt.slice(11, 16), end_time: endAt.slice(11, 16), modality, location_text: locationText, meeting_url: meetingUrl, quadrant: eventQuadrant, reminders: eventReminderTimes, participant_ids: participantIds };
  return { title, description, group_id: taskGroupId || null, monthly: groupMonthly, due_day: groupDueDay, children: groupChildren };
}
```

- [ ] **Step 3: QuickCreateSheet — `applyTemplate(t)`** chama `formPatchFromPayload(kind, t.payload, refs)` (refs: `collabIds` da query de colaboradores, `categoryIds` da query de categorias, `groupIds` da query de grupos — Sets memoizados) e seta os estados correspondentes por kind (title/description sempre; task: ctx/group_mode/group_id/time/reminders/quadrant/checklist; delegated: + delegate_to/cc_ids; event: category/start-end sobre `today`/modality/location/url/eventQuadrant/eventReminders/participants; group: monthly/due_day/children). `warnings` viram um toast `kind:'info'` por aplicação (mensagens concatenadas). Data (`due`, dia de startAt/endAt) NÃO é tocada.
- [ ] **Step 4: Render** logo após o grid das 4 abas: `<TaskTemplatePicker kind={kind} getSnapshot={buildSnapshot} onPick={applyTemplate} />`.
- [ ] **Step 5: Validar** `npx tsc --noEmit` + `npx vite build` + `npx vitest run`.

### Task 5: E2E no preview (contra o banco) + visual

- [ ] **Step 1:** Preview 4173: aba Delegar → preencher (título "Novo Lead", delegado, checklist 2 itens, prioridade) → "salvar como modelo" → conferir linha em `task_templates` no banco (kind='delegated', payload sem `due`).
- [ ] **Step 2:** Recarregar → aba Delegar → "Meus modelos…" → aplicar → conferir formulário preenchido e data = hoje → Criar → conferir em `tasks` (assigned + filhas do checklist).
- [ ] **Step 3:** RLS: `execute_sql` como outro colaborador (ou conferir policy) — modelo não visível a terceiros.
- [ ] **Step 4:** Gestão: renomear, atualizar-com-formulário, excluir (ConfirmDialog) — e badge de kind na lista.
- [ ] **Step 5:** 375px + 1440px screenshot; registrar feature; mensagem pro Jonathan/Alf.
