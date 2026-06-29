# Delegação "Em cópia" — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir delegar uma tarefa a 1 executor e pôr N pessoas "em cópia" (acompanham e cobram, não concluem), no app e pelo TOM no zap.

**Architecture:** Camada aditiva. `tasks.assigned_to` continua o executor único (zero regressão). Uma tabela nova `task_watchers` (many-to-many) guarda quem está em cópia. A cobrança (dispatcher) faz fan-out pros watchers reusando o claim atômico existente (`notifications_alert_daily_uq`, que já é por-colaborador → não colide). A visão "Em cópia" é uma leitura separada, sem tocar na `.or()` central de `useAgendaTasks`.

**Tech Stack:** Node.js (CommonJS) no engine; React+TS+Tailwind+react-query no PWA; Supabase Postgres (projeto `cesnbnrynvxvgdhfmaua`); vitest (PWA) e `node --test` (backend).

## Global Constraints

- **Migration pré-autorizada** (tabela `task_watchers`). Migrations no Supabase nunca pedem OK.
- **Zero-regressão:** NÃO alterar a `.or()` central de `_remote/web/src/screens/agenda/hooks/useAgendaTasks.ts`. A visão "Em cópia" é leitura separada.
- **Voz do TOM sagrada:** só muda destinatário/enquadramento factual da cobrança, nunca o jeito/tom.
- **RLS via `current_collab_id()`** — NUNCA `auth.uid()` (collaborator.id ≠ auth.uid()).
- **Engine escreve via service_role** (ignora RLS); `collaborator_id`/`added_by` resolvidos no backend a partir do remetente, nunca de marker cru do LLM.
- **`.deploy-hold` na raiz** (`D:\la-organizer\.deploy-hold`) ANTES de editar qualquer arquivo em `src/` (Tasks 8–12). Remover ao terminar a fatia backend.
- **Deploy do engine** (scp + `pm2 restart tom`) só no checkpoint final (Task 13), com OK do Alf. PWA via auto-deploy (Stop hook).
- **Sem WhatsApp real** na validação: E2E com ficha descartável + soft-cancel.
- **TDD/catraca:** lógica pura primeiro, com teste que falha antes de passar.
- **Não commitar entre tasks** (regra do `_remote/CLAUDE.md`): trabalha local; 1 bundle no deploy final. Migrations SQL podem ir separadas.

**Convenções de tipo cravadas (usadas em várias tasks):**
- Tabela: `task_watchers(id uuid, task_id uuid, collaborator_id uuid, added_by uuid, created_at timestamptz)`.
- Pura PWA (`web/src/lib/taskWatchers.ts`): `diffWatchers(current: string[], next: string[]): { add: string[]; remove: string[] }`.
- Hook PWA (`web/src/hooks/useTaskWatchers.ts`): `useTaskWatchers(taskId, enabled)` → `{ data: string[] }`; `useReplaceWatchers()` → mutation `({taskId, next, addedBy})`.
- Hook PWA (`web/src/hooks/useActiveCollaborators.ts`): `useActiveCollaborators(enabled)` → `{ data: {id, full_name, role}[] }`.
- Backend puro (`src/services/watcher-cobranca.js`): `buildWatcherReminderText(executorFirstName, title, kind)` com `kind ∈ {'deadline','overdue1','overdueN','overdueOld'}`.
- Endpoint novo: `POST /internal/watchers-added` body `{ task_id, watcher_ids }`.
- Cliente PWA (`web/src/lib/tomEngine.ts`): `notifyWatchersAdded(taskId, watcherIds): Promise<NotifyResult>`.

---

### Task 1: Migration `task_watchers` + RLS + índices

**Files:**
- Create: `_remote/supabase/migrations/2026-06-29_task_watchers.sql` (registro; aplicação via MCP `apply_migration`)

**Interfaces:**
- Produces: tabela `public.task_watchers` e políticas RLS consumidas por todas as tasks seguintes.

- [ ] **Step 1: Aplicar a migration** (MCP `apply_migration`, name `task_watchers`, projeto `cesnbnrynvxvgdhfmaua`), e salvar o mesmo SQL no arquivo acima:

```sql
create table if not exists public.task_watchers (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  collaborator_id uuid not null,
  added_by uuid,
  created_at timestamptz not null default now(),
  unique (task_id, collaborator_id)
);
create index if not exists task_watchers_collab_idx on public.task_watchers (collaborator_id);
create index if not exists task_watchers_task_idx on public.task_watchers (task_id);

alter table public.task_watchers enable row level security;

-- Observador lê suas cópias; dono/criador da tarefa lê e gerencia as cópias dela.
create policy task_watchers_select on public.task_watchers
  for select using (
    collaborator_id = public.current_collab_id()
    or exists (
      select 1 from public.tasks t
      where t.id = task_watchers.task_id and t.created_by = public.current_collab_id()
    )
  );
create policy task_watchers_insert on public.task_watchers
  for insert with check (
    exists (
      select 1 from public.tasks t
      where t.id = task_watchers.task_id and t.created_by = public.current_collab_id()
    )
  );
create policy task_watchers_delete on public.task_watchers
  for delete using (
    exists (
      select 1 from public.tasks t
      where t.id = task_watchers.task_id and t.created_by = public.current_collab_id()
    )
  );
```

- [ ] **Step 2: Verificar no banco** (MCP `execute_sql`):

```sql
select table_name from information_schema.tables where table_name = 'task_watchers';
select polname from pg_policies where tablename = 'task_watchers';
```
Expected: 1 linha `task_watchers`; 3 políticas (`task_watchers_select/insert/delete`).

- [ ] **Step 3: Provar a constraint de unicidade** (MCP `execute_sql`):

```sql
-- usa duas tarefas/colab reais quaisquer só pra exercitar; rollback no fim
begin;
insert into public.task_watchers (task_id, collaborator_id)
  select id, created_by from public.tasks where created_by is not null limit 1;
-- repetir o mesmo par deve violar unique
insert into public.task_watchers (task_id, collaborator_id)
  select id, created_by from public.tasks where created_by is not null limit 1;
rollback;
```
Expected: a 2ª inserção falha com `23505` (unique_violation). (O `rollback` desfaz tudo — zero dado deixado.)

---

### Task 2: Função pura `taskWatchers.ts` (PWA, TDD)

**Files:**
- Create: `_remote/web/src/lib/taskWatchers.ts`
- Test: `_remote/web/src/lib/taskWatchers.test.ts`

**Interfaces:**
- Produces: `diffWatchers(current: string[], next: string[]): { add: string[]; remove: string[] }` — consumido por `useReplaceWatchers` (Task 3) pra só inserir/remover o delta.

- [ ] **Step 1: Escrever o teste que falha**

```ts
import { describe, it, expect } from 'vitest';
import { diffWatchers } from './taskWatchers';

describe('diffWatchers', () => {
  it('detecta adições e remoções', () => {
    expect(diffWatchers(['a', 'b'], ['b', 'c'])).toEqual({ add: ['c'], remove: ['a'] });
  });
  it('sem mudança → vazio', () => {
    expect(diffWatchers(['a', 'b'], ['b', 'a'])).toEqual({ add: [], remove: [] });
  });
  it('lista atual vazia → tudo é add', () => {
    expect(diffWatchers([], ['x', 'y'])).toEqual({ add: ['x', 'y'], remove: [] });
  });
  it('próxima vazia → tudo é remove', () => {
    expect(diffWatchers(['x'], [])).toEqual({ add: [], remove: ['x'] });
  });
  it('ignora duplicatas', () => {
    expect(diffWatchers(['a'], ['a', 'a', 'b'])).toEqual({ add: ['b'], remove: [] });
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd _remote/web && npx vitest run src/lib/taskWatchers.test.ts`
Expected: FAIL ("diffWatchers is not a function" / módulo não encontrado).

- [ ] **Step 3: Implementar**

```ts
// web/src/lib/taskWatchers.ts
// Quem está "em cópia" de uma tarefa (acompanha e cobra, não conclui).
// Função PURA — testável sem rede. O IO fica em hooks/useTaskWatchers.ts.

/** Delta entre a lista atual de watchers e a próxima. Idempotente e sem duplicatas. */
export function diffWatchers(current: string[], next: string[]): { add: string[]; remove: string[] } {
  const cur = new Set(current);
  const nxt = new Set(next);
  const add = [...nxt].filter(id => !cur.has(id));
  const remove = [...cur].filter(id => !nxt.has(id));
  return { add, remove };
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `cd _remote/web && npx vitest run src/lib/taskWatchers.test.ts`
Expected: PASS (5/5).

---

### Task 3: IO + hooks de watchers (PWA)

**Files:**
- Create: `_remote/web/src/hooks/useTaskWatchers.ts`
- Create: `_remote/web/src/hooks/useActiveCollaborators.ts`

**Interfaces:**
- Consumes: `diffWatchers` (Task 2); `supabase` de `../lib/supabase`; `useAuth` de `../contexts/AuthContext`.
- Produces:
  - `useTaskWatchers(taskId: string | null, enabled: boolean)` → react-query `{ data: string[] }` (ids dos watchers).
  - `useReplaceWatchers()` → mutation `mutateAsync({ taskId, next }: { taskId: string; next: string[] })`.
  - `useActiveCollaborators(enabled: boolean)` → `{ data: { id: string; full_name: string; role: string }[] }`.

- [ ] **Step 1: Implementar `useTaskWatchers` + `useReplaceWatchers`**

```ts
// web/src/hooks/useTaskWatchers.ts
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { diffWatchers } from '../lib/taskWatchers';

export function useTaskWatchers(taskId: string | null, enabled: boolean) {
  return useQuery({
    queryKey: ['task-watchers', taskId],
    enabled: enabled && Boolean(taskId),
    staleTime: 60_000,
    queryFn: async (): Promise<string[]> => {
      const { data, error } = await supabase
        .from('task_watchers')
        .select('collaborator_id')
        .eq('task_id', taskId!);
      if (error) throw error;
      return (data ?? []).map(r => r.collaborator_id as string);
    },
  });
}

export function useReplaceWatchers() {
  const { collaborator } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ taskId, next }: { taskId: string; next: string[] }) => {
      const { data: cur, error: e0 } = await supabase
        .from('task_watchers').select('collaborator_id').eq('task_id', taskId);
      if (e0) throw e0;
      const current = (cur ?? []).map(r => r.collaborator_id as string);
      const { add, remove } = diffWatchers(current, next);
      if (remove.length) {
        const { error } = await supabase
          .from('task_watchers').delete().eq('task_id', taskId).in('collaborator_id', remove);
        if (error) throw error;
      }
      if (add.length) {
        const rows = add.map(cid => ({ task_id: taskId, collaborator_id: cid, added_by: collaborator?.id ?? null }));
        const { error } = await supabase.from('task_watchers').insert(rows);
        if (error) throw error;
      }
      return { added: add };
    },
    onSuccess: (_r, vars) => {
      qc.invalidateQueries({ queryKey: ['task-watchers', vars.taskId] });
      qc.invalidateQueries({ queryKey: ['watched-tasks'] });
    },
  });
}
```

- [ ] **Step 2: Implementar `useActiveCollaborators`** (fonte do picker — QUALQUER ativo, distinto de `delegableMembers`)

```ts
// web/src/hooks/useActiveCollaborators.ts
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';

export interface ActiveCollab { id: string; full_name: string; role: string; }

export function useActiveCollaborators(enabled: boolean) {
  return useQuery({
    queryKey: ['active-collaborators'],
    enabled,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<ActiveCollab[]> => {
      const { data, error } = await supabase
        .from('collaborators')
        .select('id, full_name, role')
        .eq('is_active', true)
        .order('full_name', { ascending: true });
      if (error) throw error;
      return (data ?? []) as ActiveCollab[];
    },
  });
}
```

- [ ] **Step 3: Validar tipos**

Run: `cd _remote/web && npx tsc --noEmit`
Expected: sem erros novos.

---

### Task 4: Componente `WatchersPicker` (multi-seleção com chips)

**Files:**
- Create: `_remote/web/src/components/WatchersPicker.tsx`

**Interfaces:**
- Consumes: `useActiveCollaborators` (Task 3); `CustomSelect` de `./CustomSelect`.
- Produces: `<WatchersPicker value={string[]} onChange={(ids:string[])=>void} excludeIds={string[]} enabled={boolean} />`. `excludeIds` = executor escolhido + usuário atual.

- [ ] **Step 1: Implementar o componente** (DS: usa `CustomSelect` pra adicionar; chips pra remover)

```tsx
// web/src/components/WatchersPicker.tsx
// Multi-seleção de pessoas "em cópia". Fonte: TODOS os ativos (não a equipe).
// Adicionar via CustomSelect; remover clicando no X do chip.
import { useMemo } from 'react';
import { useActiveCollaborators } from '../hooks/useActiveCollaborators';
import { CustomSelect } from './CustomSelect';

interface Props {
  value: string[];
  onChange: (ids: string[]) => void;
  excludeIds?: string[];
  enabled?: boolean;
}

export function WatchersPicker({ value, onChange, excludeIds = [], enabled = true }: Props) {
  const q = useActiveCollaborators(enabled);
  const all = q.data ?? [];
  const nameById = useMemo(() => new Map(all.map(c => [c.id, c.full_name])), [all]);
  const excluded = new Set([...excludeIds, ...value]);
  const options = all
    .filter(c => !excluded.has(c.id))
    .map(c => ({ value: c.id, label: c.full_name, sublabel: c.role }));

  return (
    <div>
      <CustomSelect
        value=""
        placeholder={q.isLoading ? 'Carregando…' : '— Adicionar quem fica em cópia —'}
        onChange={(id) => { if (id && !value.includes(id)) onChange([...value, id]); }}
        options={options}
      />
      {value.length > 0 && (
        <div className="flex flex-wrap gap-2 mt-2">
          {value.map(id => (
            <span key={id} className="inline-flex items-center gap-1 rounded-full bg-bg-elevated border border-border px-2.5 py-1 text-body-sm text-fg">
              {nameById.get(id) ?? 'Pessoa'}
              <button type="button" aria-label="Remover"
                className="text-fg-muted hover:text-danger leading-none"
                onClick={() => onChange(value.filter(v => v !== id))}>×</button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Validar tipos/build**

Run: `cd _remote/web && npx tsc --noEmit`
Expected: sem erros novos.

---

### Task 5: Campo "Em cópia" no `DelegateTaskSheet` (tarefa existente)

**Files:**
- Modify: `_remote/web/src/components/DelegateTaskSheet.tsx`

**Interfaces:**
- Consumes: `WatchersPicker` (Task 4); `useTaskWatchers`/`useReplaceWatchers` (Task 3); `notifyWatchersAdded` (Task 10).

- [ ] **Step 1: Importar e ler watchers atuais.** Após os imports existentes, adicionar:

```tsx
import { WatchersPicker } from './WatchersPicker';
import { useTaskWatchers, useReplaceWatchers } from '../hooks/useTaskWatchers';
import { notifyWatchersAdded } from '../lib/tomEngine';
```

Dentro do componente, após `const membersQ = useDelegableMembers(open);`:

```tsx
  const watchersQ = useTaskWatchers(task?.id ?? null, open);
  const replaceWatchers = useReplaceWatchers();
  const [cc, setCc] = useState<string[]>([]);
```

No `useEffect` de reset (após `setError(null);`):

```tsx
    setCc(watchersQ.data ?? []);
```
E adicionar `watchersQ.data` às deps do effect.

- [ ] **Step 2: Persistir watchers no `mutationFn`** do `delegate`, logo após o `notifyTaskDelegated(task.id)` atual (antes do `return r;`):

```tsx
      await replaceWatchers.mutateAsync({ taskId: task.id, next: cc });
      if (cc.length) { void notifyWatchersAdded(task.id, cc); }
```

- [ ] **Step 3: Renderizar o picker.** Logo após o bloco do "Prazo (opcional)" (a `<div>` do `DateInput`), inserir:

```tsx
          <div>
            <div className="text-label uppercase tracking-wide text-fg-muted mb-1.5">Em cópia (opcional)</div>
            <WatchersPicker
              value={cc}
              onChange={setCc}
              excludeIds={[assignee, collaborator?.id ?? ''].filter(Boolean)}
              enabled={open}
            />
            <p className="text-body-sm text-fg-muted mt-1">Acompanham e recebem a cobrança junto — sem precisar concluir.</p>
          </div>
```

- [ ] **Step 4: Validar tipos/build**

Run: `cd _remote/web && npx tsc --noEmit && npx vite build`
Expected: sem erros.

---

### Task 6: Campo "Em cópia" no `QuickCreateSheet` (Novo → Delegar)

**Files:**
- Modify: `_remote/web/src/components/QuickCreateSheet.tsx`

**Interfaces:**
- Consumes: `WatchersPicker` (Task 4); `supabase` (já importado); `notifyWatchersAdded` (Task 10).

- [ ] **Step 1: Ler o arquivo** pra localizar `const [delegateTo, setDelegateTo] = useState<string>('')` (linha ~88), o `createDelegated` (linha ~278) e o bloco JSX do seletor "PRA QUEM" (`value={delegateTo}`, linha ~834).

- [ ] **Step 2: Adicionar imports + state.** Junto aos imports:

```tsx
import { WatchersPicker } from './WatchersPicker';
import { notifyWatchersAdded } from '../lib/tomEngine';
```
Após `const [delegateTo, setDelegateTo] = useState<string>('');`:

```tsx
  const [ccIds, setCcIds] = useState<string[]>([]);
```

- [ ] **Step 3: Persistir watchers em `createDelegated`.** O `createDelegated.mutationFn` faz INSERT em `tasks` com `assigned_to: delegateTo` e retorna a task criada. Capturar o `id` da task criada (o `.insert(...).select('id').single()` já existe ou adicionar `.select('id').single()`), e após o INSERT bem-sucedido inserir os watchers e notificar:

```tsx
      // após obter `created` (a task delegada recém-criada, com .id):
      if (ccIds.length && created?.id) {
        await supabase.from('task_watchers').insert(
          ccIds.map(cid => ({ task_id: created.id, collaborator_id: cid, added_by: collab.id })),
        );
        void notifyWatchersAdded(created.id, ccIds);
      }
```
(Se o `mutationFn` atual não capturava o id retornado, ajustar o `.insert(...)` da task pra `.select('id').single()` e nomear `created`.)

- [ ] **Step 4: Resetar `ccIds`** onde os outros campos do form são limpos (no `onSuccess`/reset do sheet): adicionar `setCcIds([]);`.

- [ ] **Step 5: Renderizar o picker.** Logo após o bloco do `<CustomSelect value={delegateTo} …>` (o "PRA QUEM"), inserir:

```tsx
          <div className="mt-md">
            <div className="text-label uppercase tracking-wide text-fg-muted mb-1.5">Em cópia (opcional)</div>
            <WatchersPicker
              value={ccIds}
              onChange={setCcIds}
              excludeIds={[delegateTo, collab.id].filter(Boolean)}
              enabled={open}
            />
            <p className="text-body-sm text-fg-muted mt-1">Acompanham e cobram junto — não precisam concluir.</p>
          </div>
```
(Usar o nome real do colaborador atual no escopo — `collab.id` — conforme já usado no `createDelegated`.)

- [ ] **Step 6: Validar tipos/build**

Run: `cd _remote/web && npx tsc --noEmit && npx vite build`
Expected: sem erros.

---

### Task 7: Visão "Em cópia" (leitura separada) + seção na Hoje

**Files:**
- Create: `_remote/web/src/hooks/useWatchedTasks.ts`
- Create: `_remote/web/src/components/WatchedTasksSection.tsx`
- Modify: `_remote/web/src/screens/Hoje.tsx` (montar a seção)

**Interfaces:**
- Consumes: `supabase`; `useAuth`.
- Produces: `useWatchedTasks(enabled)` → `{ data: { id, title, due_date, status, assigned_to, executor_name }[] }`; `<WatchedTasksSection />` auto-contido.
- **NÃO toca** na `.or()` de `useAgendaTasks` (constraint global).

- [ ] **Step 1: Implementar `useWatchedTasks`** (2 passos: ids das tarefas em que sou watcher → tarefas)

```ts
// web/src/hooks/useWatchedTasks.ts
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';

export interface WatchedTask {
  id: string; title: string; due_date: string | null;
  status: string; assigned_to: string | null; executor_name: string | null;
}

export function useWatchedTasks(enabled: boolean) {
  const { collaborator } = useAuth();
  const meId = collaborator?.id;
  return useQuery({
    queryKey: ['watched-tasks', meId],
    enabled: enabled && Boolean(meId),
    staleTime: 60_000,
    queryFn: async (): Promise<WatchedTask[]> => {
      const { data: wr, error: e0 } = await supabase
        .from('task_watchers').select('task_id').eq('collaborator_id', meId!);
      if (e0) throw e0;
      const ids = (wr ?? []).map(r => r.task_id as string);
      if (!ids.length) return [];
      const { data, error } = await supabase
        .from('tasks')
        .select('id, title, due_date, status, assigned_to, executor:collaborators!tasks_assigned_to_fkey(preferred_name, full_name)')
        .in('id', ids)
        .not('status', 'in', '(done,cancelled)')
        .order('due_date', { ascending: true });
      if (error) throw error;
      return (data ?? []).map((t: any) => ({
        id: t.id, title: t.title, due_date: t.due_date, status: t.status,
        assigned_to: t.assigned_to,
        executor_name: t.executor?.preferred_name ?? t.executor?.full_name ?? null,
      }));
    },
  });
}
```

- [ ] **Step 2: Implementar `WatchedTasksSection`** (auto-contido; só renderiza se houver itens)

```tsx
// web/src/components/WatchedTasksSection.tsx
// Tarefas em que estou "em cópia" (acompanho e cobro, não concluo).
import { useWatchedTasks } from '../hooks/useWatchedTasks';

function fmtDay(ymd: string | null): string {
  if (!ymd) return 'sem prazo';
  const [, m, d] = ymd.split('-');
  return `${d}/${m}`;
}

export function WatchedTasksSection() {
  const q = useWatchedTasks(true);
  const items = q.data ?? [];
  if (!items.length) return null;
  return (
    <section className="space-y-2">
      <h2 className="text-label uppercase tracking-wide text-fg-muted">Em cópia · acompanhando</h2>
      <ul className="space-y-1.5">
        {items.map(t => (
          <li key={t.id} className="rounded-md border border-border bg-bg-elevated px-3 py-2">
            <div className="text-body text-fg font-medium">{t.title}</div>
            <div className="text-body-sm text-fg-muted">
              {t.executor_name ? `${t.executor_name} · ` : ''}{fmtDay(t.due_date)} · em cópia
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
```

- [ ] **Step 3: Montar na Hoje.** Ler `_remote/web/src/screens/Hoje.tsx`, importar `WatchedTasksSection` e renderizar `<WatchedTasksSection />` no fluxo principal da tela (abaixo das tarefas do dia, antes do rodapé). Edit de 2 linhas (import + uso).

- [ ] **Step 4: Validar tipos/build**

Run: `cd _remote/web && npx tsc --noEmit && npx vite build`
Expected: sem erros.

---

### Task 8: Helper puro de cobrança ao observador (backend, TDD)

> **`.deploy-hold` na raiz ANTES desta task** (primeira que toca `src/`):
> `echo hold > D:\la-organizer\.deploy-hold` (ou criar o arquivo).

**Files:**
- Create: `_remote/src/services/watcher-cobranca.js`
- Test: `_remote/src/services/watcher-cobranca.test.js`

**Interfaces:**
- Produces: `buildWatcherReminderText(executorFirstName, title, kind)` — `kind ∈ {'deadline','overdue1','overdueN','overdueOld'}`. Consumido pelo dispatcher (Task 9).

- [ ] **Step 1: Escrever o teste que falha**

```js
const test = require('node:test');
const assert = require('node:assert');
const { buildWatcherReminderText } = require('./watcher-cobranca');

test('deadline: cobra o executor, sem mandar o observador fazer', () => {
  const m = buildWatcherReminderText('Gabi', 'Aluno faltoso', 'deadline');
  assert.match(m, /Gabi/);
  assert.match(m, /Aluno faltoso/);
  assert.match(m, /cópia/i);
  assert.doesNotMatch(m, /vc precisa fazer|faça você/i);
});

test('overdue1 escala suave', () => {
  const m = buildWatcherReminderText('Gabi', 'X', 'overdue1');
  assert.match(m, /1 dia/);
});

test('kind desconhecido cai no deadline', () => {
  const m = buildWatcherReminderText('Gabi', 'X', 'zzz');
  assert.match(m, /cópia/i);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd _remote && node --test src/services/watcher-cobranca.test.js`
Expected: FAIL (módulo não encontrado).

- [ ] **Step 3: Implementar** (voz factual; enquadra "cobra o executor", nunca "faça")

```js
'use strict';
// Mensagem de cobrança pra quem está EM CÓPIA de uma tarefa. O observador
// acompanha e cobra o executor — NUNCA é instruído a executar. Função pura.

function buildWatcherReminderText(executorFirstName, title, kind) {
  const who = executorFirstName || 'a pessoa';
  switch (kind) {
    case 'overdue1':
      return `👀 Você está em cópia: *${title}* (de ${who}) atrasou 1 dia. Dá um toque em ${who}?`;
    case 'overdueN':
      return `👀 Em cópia: *${title}* (de ${who}) está parada há alguns dias. Vale cobrar ${who}.`;
    case 'overdueOld':
      return `👀 Em cópia: *${title}* (de ${who}) está há vários dias sem mexer. Bom puxar ${who}.`;
    case 'deadline':
    default:
      return `👀 Você está em cópia: *${title}* (de ${who}) vence amanhã. Fica de olho e, se puder, lembra ${who}.`;
  }
}

module.exports = { buildWatcherReminderText };
```

- [ ] **Step 4: Rodar e ver passar**

Run: `cd _remote && node --test src/services/watcher-cobranca.test.js`
Expected: PASS (3/3).

---

### Task 9: Fan-out da cobrança pros observadores (dispatcher)

**Files:**
- Modify: `_remote/src/rituals/dispatcher.js` (`checkDeadlineAlerts` ~4532; `checkOverdueAlerts` ~4726)

**Interfaces:**
- Consumes: `buildWatcherReminderText` (Task 8); helpers já no arquivo (`getDndState`, `isQuietNow`, `nowSaoPaulo`, `logRitualEvent`).
- Reusa o claim atômico `notifications` (`notifications_alert_daily_uq` é por `collaborator_id` → o observador é outro colab, linha distinta, **sem colisão** com a executora).

- [ ] **Step 1: Helper interno de fan-out.** No topo de `dispatcher.js` (junto dos outros `require`), adicionar:

```js
const { buildWatcherReminderText } = require('../services/watcher-cobranca');
```

E uma função auxiliar (perto de `checkDeadlineAlerts`):

```js
// #em-copia (Fabi 29/06): dispara a cobrança pros observadores (task_watchers) de UMA tarefa.
// Reusa o claim atômico de `notifications` (uq por collaborator_id → não colide com a executora).
// notifType: 'deadline_alert' | 'overdue_alert'. kind passado pro texto.
async function fanoutWatcherAlerts(task, executorFullName, notifType, kind, ymdToday) {
  const { data: watchers } = await supabase
    .from('task_watchers')
    .select('collaborator_id')
    .eq('task_id', task.id);
  if (!watchers || !watchers.length) return 0;
  const wIds = [...new Set(watchers.map(w => w.collaborator_id))].filter(id => id !== task.assigned_to);
  if (!wIds.length) return 0;
  const { data: wCollabs } = await supabase
    .from('collaborators')
    .select('id, phone, full_name, is_active, user_preferences(*)')
    .in('id', wIds).eq('is_active', true);
  const whatsapp = require('../services/whatsapp');
  const execFirst = (executorFullName || '').split(' ')[0] || 'a pessoa';
  let sent = 0;
  for (const w of (wCollabs || [])) {
    if (!w.phone) continue;
    const dnd = await getDndState(w.id);
    if (dnd.active) { await logRitualEvent(w.id, 'cobranca_copia', 'skipped', `dnd:${String(task.id).slice(0,8)}`, ymdToday); continue; }
    const q = await isQuietNow(w.user_preferences, nowSaoPaulo());
    if (q.quiet) { await logRitualEvent(w.id, 'cobranca_copia', 'skipped', q.reason, ymdToday); continue; }
    // CLAIM ATÔMICO por observador (mesmo índice uq; collaborator_id distinto = linha distinta).
    const { data: claim, error: claimErr } = await supabase.from('notifications').insert({
      collaborator_id: w.id,
      notification_type: notifType,
      title: `[cópia] ${task.title}`,
      body: '(em cópia)',
      reference_type: 'task',
      reference_id: task.id,
      channel: 'whatsapp',
      status: 'sent',
      sent_at: new Date().toISOString(),
      alert_day: ymdToday,
    }).select('id').single();
    if (claimErr) {
      const reason = (claimErr.code === '23505' ? 'ja_copia:' : `claim_err(${claimErr.code}):`) + String(task.id).slice(0,8);
      await logRitualEvent(w.id, 'cobranca_copia', 'skipped', reason, ymdToday);
      continue;
    }
    const text = buildWatcherReminderText(execFirst, task.title, kind);
    try {
      await whatsapp.sendMessage(w.phone, text);
      await supabase.from('conversation_history').insert({
        collaborator_id: w.id, direction: 'outbound', message_type: 'text', content: text,
      });
      await logRitualEvent(w.id, 'cobranca_copia', 'sent', `task:${String(task.id).slice(0,8)}`, ymdToday);
      sent++;
    } catch (err) {
      if (claim && claim.id) await supabase.from('notifications').delete().eq('id', claim.id);
      await logRitualEvent(w.id, 'cobranca_copia', 'error', `${String(task.id).slice(0,8)}:${err.message}`, ymdToday);
    }
  }
  return sent;
}
```

- [ ] **Step 2: Chamar no `checkDeadlineAlerts`.** Dentro do `for (const t of tasks)`, ao final do bloco `try` de envio bem-sucedido ao executor (após `sent++;`, antes do `catch`), adicionar:

```js
      try {
        await fanoutWatcherAlerts(t, collab.full_name, 'deadline_alert', 'deadline', ymdToday);
      } catch (e) { console.error('[DeadlineAlert] watcher fanout err:', e.message); }
```
> Nota: o fan-out roda **independente** do gate `shouldRemindEve` do executor — o observador recebe a cobrança de véspera mesmo que o executor tenha `reminder_lead='same_day'`? **NÃO**: posicionar a chamada DENTRO do mesmo fluxo (após o claim do executor vencer) garante que só dispara quando a tarefa de fato entrou na rodada de véspera. Manter como acima (dentro do `try` de sucesso do executor).

- [ ] **Step 3: Chamar no `checkOverdueAlerts`.** Ler o restante de `checkOverdueAlerts` (4726→~4820) pra achar o ponto após o envio bem-sucedido ao executor e o cálculo de `n = daysLate(...)`. Logo após o `sent++` do executor, adicionar:

```js
      try {
        const kind = n === 1 ? 'overdue1' : (n <= 3 ? 'overdueN' : 'overdueOld');
        await fanoutWatcherAlerts(t, collab.full_name, 'overdue_alert', kind, ymdToday);
      } catch (e) { console.error('[OverdueAlert] watcher fanout err:', e.message); }
```
(Usar os nomes reais das variáveis locais do loop: `t`, `collab`, `n`.)

- [ ] **Step 4: Checar sintaxe**

Run: `cd _remote && node --check src/rituals/dispatcher.js`
Expected: sem saída (OK).

---

### Task 10: Endpoint `/internal/watchers-added` + cliente PWA

**Files:**
- Modify: `_remote/src/internal-api.js` (após o handler `/internal/task-delegated`, ~731)
- Modify: `_remote/web/src/lib/tomEngine.ts` (nova função `notifyWatchersAdded`)

**Interfaces:**
- Consumes: `buildWatcherReminderText` não (é aviso de entrada, texto próprio); `supabase`, `whatsapp` já no arquivo.
- Produces: `POST /internal/watchers-added` `{ task_id, watcher_ids }`; `notifyWatchersAdded(taskId, watcherIds): Promise<NotifyResult>`.

- [ ] **Step 1: Handler no engine** (idempotente por `(task, watcher)` via `marker_logs`):

```js
// #em-copia (Fabi 29/06): avisa cada pessoa recém-posta em cópia de uma tarefa.
router.post('/internal/watchers-added', requireInternalSecret, async (req, res) => {
  const taskId = String(req.body?.task_id || '').trim();
  const watcherIds = Array.isArray(req.body?.watcher_ids) ? req.body.watcher_ids.map(String) : [];
  if (!taskId || !watcherIds.length) return res.status(400).json({ error: 'missing_task_or_watchers' });

  const { data: task } = await supabase
    .from('tasks').select('id, title, due_date, created_by, assigned_to').eq('id', taskId).single();
  if (!task) return res.status(404).json({ error: 'task_not_found' });

  const { data: execColl } = await supabase
    .from('collaborators').select('full_name').eq('id', task.assigned_to).maybeSingle();
  const execFirst = (execColl?.full_name || '').split(' ')[0] || 'a pessoa';

  const { data: ws } = await supabase
    .from('collaborators').select('id, full_name, phone, is_active').in('id', watcherIds);
  const whatsapp = require('./services/whatsapp');
  function fmtDay(ymd) { if (!ymd) return null; const [, m, d] = ymd.split('-'); return `${d}/${m}`; }
  const dayStr = fmtDay(task.due_date);
  let sent = 0;
  for (const w of (ws || [])) {
    if (!w.phone || !w.is_active) continue;
    const dedupeKey = `watchers-added:${taskId}:${w.id}`;
    const { data: prior } = await supabase
      .from('marker_logs').select('id').eq('marker_type', 'WATCHER_ADDED').eq('raw_excerpt', dedupeKey).limit(1);
    if (prior && prior.length) continue;
    const body =
      `👀 Você entrou em *cópia* de uma tarefa de *${execFirst}*:\n\n*${task.title}*` +
      (dayStr ? `\n\nPrazo: ${dayStr}.` : '') +
      `\n\nVocê acompanha e pode cobrar — não precisa concluir. Vou te lembrar junto com ${execFirst}.`;
    try {
      await whatsapp.sendMessage(w.phone, body);
      await supabase.from('conversation_history').insert({
        collaborator_id: w.id, direction: 'outbound', message_type: 'text', content: body,
      });
      sent++;
    } catch (e) { console.error(`[InternalAPI] watchers-added WA err ${w.id}: ${e.message}`); }
    await supabase.from('marker_logs').insert({
      marker_type: 'WATCHER_ADDED', result: 'executed', reason: `cc ${w.full_name}`, raw_excerpt: dedupeKey,
    });
  }
  console.log(`[InternalAPI] watchers-added ${taskId} → ${sent}/${watcherIds.length}`);
  return res.json({ status: 'ok', sent });
});
```

- [ ] **Step 2: Cliente no PWA.** Em `tomEngine.ts`, após `notifyTaskDelegated`:

```ts
// #em-copia — avisa cada pessoa posta em cópia (entrada). Fire-and-forget.
export async function notifyWatchersAdded(taskId: string, watcherIds: string[]): Promise<NotifyResult> {
  if (!INTERNAL_SECRET) return { ok: false, reason: 'no_secret' };
  if (!watcherIds.length) return { ok: true, status: 200, sent: 0 };
  try {
    const r = await fetch(`${TOM_BASE}/internal/watchers-added`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-internal-secret': INTERNAL_SECRET },
      body: JSON.stringify({ task_id: taskId, watcher_ids: watcherIds }),
    });
    if (!r.ok) return { ok: false, reason: `http_${r.status}` };
    const json = await r.json().catch(() => ({}));
    return { ok: true, status: r.status, sent: typeof json.sent === 'number' ? json.sent : undefined };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(`[tomEngine] watchers-added notify falhou: ${msg}`);
    return { ok: false, reason: msg };
  }
}
```

- [ ] **Step 3: Checar sintaxe + tipos**

Run: `cd _remote && node --check src/internal-api.js`
Run: `cd _remote/web && npx tsc --noEmit`
Expected: ambos OK.

---

### Task 11: TOM no zap — `cc` na delegação + ação "pôr em cópia"

**Files:**
- Modify: `_remote/src/engine.js` (bloco `a.action === 'delegate'` ~5361; adicionar `a.action === 'add_watchers'`)

**Interfaces:**
- Consumes: `resolveCollaboratorByName`, `findCollaboratorByPhone`, `resolveTaskByShortId`, `nameForCollab`, `whatsapp`, `supabase` (todos já no escopo).
- Produces: persistência em `task_watchers` quando o marker de delegação traz `cc` e quando vem `action: 'add_watchers'`.

- [ ] **Step 1: `cc` no `delegate`.** No bloco `a.action === 'delegate'`, após o UPDATE bem-sucedido de `assigned_to` (após o `if (error) {…continue;}` do update, antes da notificação ao recipient), adicionar a resolução + inserção dos watchers:

```js
        // #em-copia: campo opcional cc = nomes/telefones a pôr em cópia (acompanham, não executam).
        if (Array.isArray(a.cc) && a.cc.length) {
          const ccResolved = [];
          for (const entry of a.cc) {
            let c = null;
            if (typeof entry === 'string' && /\d{8,}/.test(entry)) {
              c = await findCollaboratorByPhone(entry);
            } else {
              const _r = await resolveCollaboratorByName(String(entry), { requester: collaborator });
              c = _r.status === 'resolved' ? _r.collaborator : null;
            }
            if (c && c.is_active && c.id !== recipient.id && c.id !== collaborator.id) ccResolved.push(c.id);
          }
          if (ccResolved.length) {
            await supabase.from('task_watchers').upsert(
              [...new Set(ccResolved)].map(cid => ({ task_id: t.id, collaborator_id: cid, added_by: collaborator.id })),
              { onConflict: 'task_id,collaborator_id', ignoreDuplicates: true },
            );
          }
        }
```

- [ ] **Step 2: Nova ação `add_watchers`** (pôr em cópia em tarefa existente). Após o fechamento do bloco `delegate` (`}` antes de `} else if (a.action === 'governance_reassign')`), inserir:

```js
      } else if (a.action === 'add_watchers') {
        // #em-copia: "põe o Jereh em cópia nessa tarefa". Resolve a tarefa (própria) + watchers.
        const t = await resolveTaskByShortId(collaborator.id, a.id);
        if (!t) { failCount++; continue; }
        const entries = Array.isArray(a.cc) ? a.cc : (Array.isArray(a.to_names) ? a.to_names : []);
        const ccResolved = [];
        for (const entry of entries) {
          let c = null;
          if (typeof entry === 'string' && /\d{8,}/.test(entry)) c = await findCollaboratorByPhone(entry);
          else { const _r = await resolveCollaboratorByName(String(entry), { requester: collaborator }); c = _r.status === 'resolved' ? _r.collaborator : null; }
          if (c && c.is_active && c.id !== t.assigned_to && c.id !== collaborator.id) ccResolved.push(c.id);
        }
        if (!ccResolved.length) { failCount++; continue; }
        const ids = [...new Set(ccResolved)];
        await supabase.from('task_watchers').upsert(
          ids.map(cid => ({ task_id: t.id, collaborator_id: cid, added_by: collaborator.id })),
          { onConflict: 'task_id,collaborator_id', ignoreDuplicates: true },
        );
        // aviso de entrada em cópia (reusa o endpoint interno via require direto do helper de WA)
        const { data: ws } = await supabase.from('collaborators').select('id, phone, full_name, is_active').in('id', ids);
        const execColl = await supabase.from('collaborators').select('full_name').eq('id', t.assigned_to).maybeSingle();
        const execFirst = (execColl.data?.full_name || '').split(' ')[0] || 'a pessoa';
        for (const w of (ws || [])) {
          if (!w.phone || !w.is_active) continue;
          const body = `👀 Você entrou em *cópia* de *${t.title}* (de ${execFirst}). Acompanha e pode cobrar — não precisa concluir.`;
          try {
            await whatsapp.sendMessage(w.phone, body);
            await supabase.from('conversation_history').insert({ collaborator_id: w.id, direction: 'outbound', message_type: 'text', content: body });
          } catch (e) { console.error('[Task] add_watchers WA err:', e.message); }
        }
        console.log(`[Task] add_watchers ${a.id} → ${ids.length} em cópia`);
        okCount++;
```

- [ ] **Step 3: Checar sintaxe**

Run: `cd _remote && node --check src/engine.js`
Expected: sem saída (OK).

---

### Task 12: Skill `delegar` + system prompt expõem a capacidade

**Files:**
- Modify: skill de delegação em `_remote/skills/` (localizar com grep `delegate`/`delegar` em `skills/`)
- Modify: `_remote/src/prompts/system.js` (bloco que descreve a ação de delegar)

**Interfaces:**
- Consumes: o parser do engine (Task 11) que aceita `cc` e `action: 'add_watchers'`.

- [ ] **Step 1: Localizar a skill.** `grep -ril "delegar" _remote/skills/`. Abrir a skill que documenta o marker de delegação.

- [ ] **Step 2: Documentar `cc` e `add_watchers` na skill** (sem mexer na VOZ — só a mecânica do marker). Adicionar à tabela/exemplos:

```md
### Pôr alguém em cópia (acompanha e cobra, não executa)
- "delega pra Gabi e põe o gerente em cópia" → delegate com `cc: ["gerente da unidade"]`
- "põe o Jereh em cópia nessa tarefa" (tarefa já existente) → `action: "add_watchers"`, `id: <short_id>`, `cc: ["Jereh"]`

Quem está em cópia recebe a tarefa e a cobrança junto, mas NÃO conclui. Use quando o pedido for "em cópia", "manda cópia pro gerente", "deixa fulano acompanhando".
Ambíguo/não encontrado → pergunta, não chuta.
```

Exemplo de marker (formato existente do delegate + `cc`):
```
<<TASK>>
{ "action": "delegate", "id": "<short_id>", "to_name": "Gabi", "cc": ["gerente da unidade"] }
<<END>>
```

- [ ] **Step 3: System prompt.** Em `system.js`, no bloco que lista o que o TOM pode fazer com tarefas (delegar), acrescentar uma linha factual curta — **sem alterar o tom**: "Posso pôr alguém em cópia ao delegar (`cc`) ou em tarefa existente (pôr em cópia): a pessoa acompanha e recebe a cobrança junto, sem concluir."

- [ ] **Step 4: Checar sintaxe**

Run: `cd _remote && node --check src/prompts/system.js`
Expected: sem saída (OK).

---

### Task 13: Validação E2E + deploy + registro

**Files:**
- Modify: `tom_known_issues` (INSERT do registro)
- Deploy: PWA via auto-deploy (Stop hook); engine via scp + `pm2 restart tom`

**Interfaces:** nenhuma nova.

- [ ] **Step 1: Rodar TODOS os testes locais**

Run: `cd _remote/web && npx vitest run src/lib/taskWatchers.test.ts && npx tsc --noEmit && npx vite build`
Run: `cd _remote && node --test src/services/watcher-cobranca.test.js && node --check src/rituals/dispatcher.js && node --check src/internal-api.js && node --check src/engine.js && node --check src/prompts/system.js`
Expected: tudo verde.

- [ ] **Step 2: Preview do app** (localhost:4173, limpar SW caches). Abrir Novo→Delegar e DelegateTaskSheet: confirmar o campo "Em cópia", adicionar/remover chips. Confirmar a seção "Em cópia" na Hoje quando há watcher. `preview_eval` + screenshot. **Não mutar dado real** (usar ficha descartável / só visual). Anexar screenshot como prova.

- [ ] **Step 3: Deploy do engine (checkpoint com OK do Alf).** Remover `.deploy-hold` da raiz. SCP os arquivos backend tocados e restart:

```bash
scp D:/la-organizer/_remote/src/services/watcher-cobranca.js tom:/opt/LA-Organizer/src/services/watcher-cobranca.js
scp D:/la-organizer/_remote/src/rituals/dispatcher.js tom:/opt/LA-Organizer/src/rituals/dispatcher.js
scp D:/la-organizer/_remote/src/internal-api.js tom:/opt/LA-Organizer/src/internal-api.js
scp D:/la-organizer/_remote/src/engine.js tom:/opt/LA-Organizer/src/engine.js
scp D:/la-organizer/_remote/src/prompts/system.js tom:/opt/LA-Organizer/src/prompts/system.js
scp D:/la-organizer/_remote/skills/<skill-delegar>.md tom:/opt/LA-Organizer/skills/<skill-delegar>.md
ssh tom "pm2 restart tom"
```

- [ ] **Step 4: E2E na VPS com ficha descartável** (sem WhatsApp real — soft-cancel). Criar uma tarefa de teste com `data_classification` de teste, delegar com `cc`, conferir `task_watchers` gravado e o `marker_logs WATCHER_ADDED`; forçar a pré-condição de `checkDeadlineAlerts` e conferir **no banco** que o claim do observador entrou como linha distinta (mesmo `reference_id`, `collaborator_id` diferente) sem colidir com a executora. Limpar o lixo no fim.

```sql
-- conferir watchers e dedup do dia (substituir <task_id>)
select collaborator_id, notification_type, reference_id, alert_day
from notifications where reference_id = '<task_id>' and notification_type in ('deadline_alert','overdue_alert');
select * from task_watchers where task_id = '<task_id>';
```

- [ ] **Step 5: Registrar known-issue/feature** em `tom_known_issues`:

```sql
INSERT INTO tom_known_issues
  (codigo, titulo, area, severidade, status, causa_raiz, fix_resumo, sinal_tipo, sinal_padrao,
   colaboradores_afetados, primeira_vez, ultima_vez, ocorrencias, corrigido_em)
VALUES ('DELEGACAO-EM-COPIA', 'Delegar com pessoas em cópia (acompanham e cobram)', 'marker', 'baixo', 'corrigido',
   'Delegação era 1-pra-1 (assigned_to único); não dava pra pôr o gerente em cópia.',
   'Tabela task_watchers (aditiva); fan-out de cobrança no dispatcher (claim por-colab, sem colisão); campo cc + action add_watchers no engine; campo Em cópia nos modais; visão Em cópia na Hoje.',
   'manual', 'pedido de pôr alguém em cópia / cobrança a observador', ARRAY['Fabíola'],
   now(), now(), 1, now());
```

- [ ] **Step 6: Atualizar memória.** Criar/atualizar `project_delegacao_em_copia.md` + pointer no `MEMORY.md` (modelo executor+cópia, tabela `task_watchers`, fan-out de cobrança, escopo fora).

---

## Self-Review (preenchido)

**1. Spec coverage:**
- §3.1 tabela `task_watchers` + RLS → Task 1 ✓
- §3.2 visão "Em cópia" leitura separada → Task 7 ✓ (não toca `.or()` central)
- §3.3 cobrança fan-out + dedup → Tasks 8, 9 ✓
- §3.4 UI modais (QuickCreate + DelegateTaskSheet) + fonte "qualquer ativo" → Tasks 3,4,5,6 ✓
- §3.5 TOM no zap (`cc` + `add_watchers` + skill + prompt) → Tasks 11, 12 ✓
- Aviso de entrada em cópia → Task 10 ✓
- §5 validação (TDD, RLS no banco, dedup no banco, preview, E2E VPS, deploy) → Task 13 ✓
- §4 fora de escopo respeitado (sem notificar "concluiu", sem sugestão automática, sem grupo/evento) ✓

**2. Placeholder scan:** sem TBD/"add error handling" genérico; cada step backend/PWA traz código real. Pontos onde o implementador precisa LER o arquivo antes de editar (QuickCreateSheet ~grande, Hoje.tsx, skill de delegar, ponto exato do `checkOverdueAlerts`) estão marcados com o anchor e o código a inserir — não são placeholders.

**3. Type consistency:** `diffWatchers` (Task 2) ↔ usado em `useReplaceWatchers` (Task 3) ✓. `buildWatcherReminderText(execFirst, title, kind)` (Task 8) ↔ chamado no dispatcher (Task 9) com os mesmos kinds ✓. `notifyWatchersAdded(taskId, ids)` (Task 10) ↔ chamado em Tasks 5 e 6 ✓. Endpoint `/internal/watchers-added` body `{task_id, watcher_ids}` ↔ cliente envia os mesmos campos ✓.
