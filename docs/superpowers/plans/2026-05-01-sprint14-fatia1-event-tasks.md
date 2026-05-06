# Sprint 14 Fatia 1 — Tarefas de Eventos (PWA) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adicionar CRUD de tasks de evento, agrupadas por setor, em uma nova tela `/mais/eventos/:id` da PWA.

**Architecture:** Estende a tabela `tasks` existente com 5 colunas opcionais (`school_event_id`, `event_sector`, `notes`, `support_team`) + adiciona status `awaiting_confirmation`. Tela nova consome `tasks` filtrando por `school_event_id`. Sem TOM, sem engine, sem skills nesta fatia.

**Tech Stack:** Supabase MCP (migration), React + TypeScript + TanStack Query (PWA), Tailwind tokens existentes (`bg-bg-surface`, `text-fg`, `text-fg-muted`, `focus-ring`, etc.).

**Spec:** `docs/superpowers/specs/2026-05-01-sprint14-fatia1-event-tasks-design.md`

**Note:** Este projeto não tem git local — sem `git commit` ao fim de cada task. Validação é estática (leitura) + `npm run build` + smoke test manual via browser. Artefatos vão para a VPS via scp no Task 7.

---

## Codebase Context

**`web/src/types.ts`** (linhas 19, 73-90): interface `Task` existente, `TaskStatus` type. Padrão: usar `category?: Category | null` para campos opcionais.

**`web/src/components/BottomSheet.tsx`**: componente reutilizável com props `open`, `onClose`, `title`, `children`. Estilo: `bg-bg-surface`, `rounded-t-lg md:rounded-lg`.

**`web/src/components/EventoSheet.tsx`**: padrão canônico de form sheet com `useMutation`, `useState`, `set_config` RPC, validação `canSave`. Estilo dos inputs:
```tsx
className="mt-1 w-full rounded-lg border border-border bg-bg-surface px-3 py-2 text-body text-fg focus:outline-none focus:border-brand"
```

**`web/src/components/QuickTaskSheet.tsx`** (linhas 41-52): INSERT canônico em `tasks`:
```tsx
await supabase.from('tasks').insert({
  title: title.trim().slice(0, 200),
  assigned_to: collaborator.id,
  created_by: collaborator.id,
  source: 'manual',
  status: 'pending',
  context: 'work',
  priority: 'medium',
  due_date: due,
});
```

**`web/src/screens/AgendaEscolar.tsx`** (linhas 105-145): card de evento. Onde inserir o link "Tarefas".

**`web/src/screens/Mais.tsx`** (linhas 27, 29): padrão de role-check usando `const { role } = useAuth()` e `role === 'coordinator' || role === 'director'`.

**`web/src/App.tsx`** (linhas 42-43): bloco onde adicionar `<Route path="mais/eventos/:id" element={<EventoDetalhe />} />`.

**DB existente verificado:**
- `tasks_status_check` valores atuais: `pending|in_progress|done|overdue|delegated|cancelled`
- `tasks.due_date` é `NOT NULL` (date) → para event tasks, default para `event.event_date`
- `tasks.category` é `NOT NULL DEFAULT 'operational'`
- `tasks.context` é `NOT NULL DEFAULT 'work'`
- `tasks.priority` é `NOT NULL DEFAULT 'medium'`
- `tasks.source` é `NOT NULL DEFAULT 'manual'`

**Supabase project:** `cesnbnrynvxvgdhfmaua`. Use `mcp__4c04bb52-f946-4fe8-85f6-b01d200f8c20__apply_migration` e `execute_sql`.

---

## File Structure

**Modified:**
- `supabase` — migration nova (via MCP)
- `D:\la-organizer\_remote\web\src\types.ts` — interface `Task`, `TaskStatus`, novo `EventSector`
- `D:\la-organizer\_remote\web\src\App.tsx` — rota nova
- `D:\la-organizer\_remote\web\src\screens\AgendaEscolar.tsx` — link "Tarefas" no card

**Created:**
- `D:\la-organizer\_remote\web\src\screens\EventoDetalhe.tsx` — tela nova
- `D:\la-organizer\_remote\web\src\components\EventTaskSheet.tsx` — form sheet de task

---

## Task 1: DB Migration

- [ ] **Step 1: Aplicar migration**

Use `mcp__4c04bb52-f946-4fe8-85f6-b01d200f8c20__apply_migration` com project_id `cesnbnrynvxvgdhfmaua`, name `sprint14_fatia1_event_tasks`:

```sql
-- 1. Colunas novas em tasks (todas NULL — não afeta tasks existentes)
ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS school_event_id uuid REFERENCES school_events(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS event_sector text CHECK (event_sector IN ('logistica','tecnica','pedagogico','comunicacao','producao')),
  ADD COLUMN IF NOT EXISTS notes text,
  ADD COLUMN IF NOT EXISTS support_team uuid[];

-- 2. Status novo (awaiting_confirmation) — preserva valores existentes
ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_status_check;
ALTER TABLE tasks
  ADD CONSTRAINT tasks_status_check
    CHECK (status IN ('pending','in_progress','done','overdue','delegated','cancelled','awaiting_confirmation'));

-- 3. Índice para listar tasks por evento eficientemente
CREATE INDEX IF NOT EXISTS tasks_school_event_id_idx ON tasks(school_event_id)
  WHERE school_event_id IS NOT NULL;
```

- [ ] **Step 2: Verificar colunas novas**

Use `mcp__4c04bb52-f946-4fe8-85f6-b01d200f8c20__execute_sql`:

```sql
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'tasks'
  AND column_name IN ('school_event_id','event_sector','notes','support_team')
ORDER BY column_name;
```

Expected: 4 rows, todas com `is_nullable = YES`. `school_event_id` é `uuid`, `event_sector` é `text`, `notes` é `text`, `support_team` é `ARRAY`.

- [ ] **Step 3: Verificar status novo**

```sql
SELECT pg_get_constraintdef(con.oid) AS def
FROM pg_constraint con
JOIN pg_class rel ON rel.oid = con.conrelid
WHERE rel.relname = 'tasks' AND con.conname = 'tasks_status_check';
```

Expected: o CHECK inclui todos os valores antigos (`pending|in_progress|done|overdue|delegated|cancelled`) + `awaiting_confirmation`.

- [ ] **Step 4: Verificar índice**

```sql
SELECT indexname FROM pg_indexes WHERE tablename = 'tasks' AND indexname = 'tasks_school_event_id_idx';
```

Expected: 1 row.

---

## Task 2: Types — extender `Task` + adicionar `EventSector`

**Files:** Modify `D:\la-organizer\_remote\web\src\types.ts`

- [ ] **Step 1: Adicionar `awaiting_confirmation` ao `TaskStatus`**

Encontre a linha 19:
```ts
export type TaskStatus = 'pending' | 'in_progress' | 'done' | 'cancelled' | 'overdue' | 'delegated';
```

Substitua por:
```ts
export type TaskStatus = 'pending' | 'in_progress' | 'done' | 'cancelled' | 'overdue' | 'delegated' | 'awaiting_confirmation';
```

- [ ] **Step 2: Adicionar `EventSector` type + `SECTOR_LABELS` logo após `TaskStatus`**

Insira após a linha do `TaskStatus` (e antes do `TaskContext`):
```ts
export type EventSector = 'logistica' | 'tecnica' | 'pedagogico' | 'comunicacao' | 'producao';

export const SECTOR_LABELS: Record<EventSector, string> = {
  logistica: 'Logística',
  tecnica: 'Técnica',
  pedagogico: 'Pedagógico',
  comunicacao: 'Comunicação',
  producao: 'Produção',
};

export const SECTORS: EventSector[] = ['logistica', 'tecnica', 'pedagogico', 'comunicacao', 'producao'];
```

- [ ] **Step 3: Adicionar campos novos na interface `Task`**

Encontre a interface `Task` (linhas 73-90). Adicione 4 campos opcionais antes do fechamento (`}`), logo após `projects?: { name: string } | null;`:

```ts
  // Sprint 14 Fatia 1 — campos de tasks de evento (todos opcionais)
  school_event_id?: string | null;
  event_sector?: EventSector | null;
  notes?: string | null;
  support_team?: string[] | null;
```

- [ ] **Step 4: Adicionar `STATUS_LABELS` para uso no UI**

Logo após o `SECTORS` array do Step 2, adicione:
```ts
export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  pending: 'Pendente',
  in_progress: 'Em andamento',
  done: 'Concluída',
  cancelled: 'Cancelada',
  overdue: 'Atrasada',
  delegated: 'Delegada',
  awaiting_confirmation: 'Aguardando confirmação',
};
```

- [ ] **Step 5: Verificar tsc**

```bash
cd D:\la-organizer\_remote\web && npx tsc --noEmit
```

Expected: sem erros. Se houver erro em um consumer existente do `Task` que esperava algum campo obrigatório, esse campo já é opcional na interface — o erro provavelmente vai ser em `TaskStatus` (algum switch/match). Caso apareça erro `'awaiting_confirmation' is not handled`, adicione o case correspondente no consumer (geralmente fallback `default`).

---

## Task 3: `EventoDetalhe` — esqueleto + query principal

**Files:** Create `D:\la-organizer\_remote\web\src\screens\EventoDetalhe.tsx`

- [ ] **Step 1: Criar arquivo com esqueleto e query do evento + tasks**

Crie o arquivo com o conteúdo a seguir. A tela:
- Carrega o evento via `school_events` (header read-only)
- Carrega as tasks filtrando por `school_event_id`
- Lista tasks agrupadas por setor (acordeões)
- Setores com tasks abertos por padrão; setores vazios colapsados

```tsx
import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, ChevronRight, Plus, Trash2, Pencil } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { EventTaskSheet } from '../components/EventTaskSheet';
import {
  SECTORS,
  SECTOR_LABELS,
  TASK_STATUS_LABELS,
  formatEventDate,
  unitLabel,
} from '../types';
import type { EventSector, SchoolEvent, Task } from '../types';

interface EventTask extends Task {
  assigned_collab?: { id: string; full_name: string } | null;
}

export function EventoDetalhe() {
  const { id: eventId } = useParams<{ id: string }>();
  const { collaborator } = useAuth();
  const queryClient = useQueryClient();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<EventTask | null>(null);
  const [defaultSector, setDefaultSector] = useState<EventSector | null>(null);
  const [collapsed, setCollapsed] = useState<Set<EventSector>>(new Set());
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const { data: event, isLoading: evLoading, error: evError } = useQuery({
    queryKey: ['event', eventId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('school_events')
        .select('*')
        .eq('id', eventId)
        .single();
      if (error) throw error;
      return data as SchoolEvent;
    },
    enabled: !!eventId,
  });

  const { data: tasks = [], isLoading: tLoading } = useQuery({
    queryKey: ['event-tasks', eventId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('tasks')
        .select('*, assigned_collab:assigned_to(id, full_name)')
        .eq('school_event_id', eventId)
        .order('created_at', { ascending: true });
      if (error) throw error;
      return (data ?? []) as EventTask[];
    },
    enabled: !!eventId,
  });

  const toggleStatus = useMutation({
    mutationFn: async (task: EventTask) => {
      const next = task.status === 'done' ? 'pending' : 'done';
      await supabase.rpc('set_config', {
        key: 'app.current_user_id',
        value: collaborator!.id,
      });
      const { error } = await supabase
        .from('tasks')
        .update({
          status: next,
          completed_at: next === 'done' ? new Date().toISOString() : null,
          completed_by: next === 'done' ? collaborator!.id : null,
        })
        .eq('id', task.id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['event-tasks', eventId] }),
  });

  const deleteTask = useMutation({
    mutationFn: async (taskId: string) => {
      await supabase.rpc('set_config', {
        key: 'app.current_user_id',
        value: collaborator!.id,
      });
      const { error } = await supabase.from('tasks').delete().eq('id', taskId);
      if (error) throw error;
    },
    onSuccess: () => {
      setConfirmDelete(null);
      queryClient.invalidateQueries({ queryKey: ['event-tasks', eventId] });
    },
  });

  const tasksBySector: Record<EventSector, EventTask[]> = {
    logistica: [], tecnica: [], pedagogico: [], comunicacao: [], producao: [],
  };
  for (const t of tasks) {
    if (t.event_sector && SECTORS.includes(t.event_sector)) {
      tasksBySector[t.event_sector].push(t);
    }
  }

  const toggleCollapsed = (sector: EventSector) => {
    setCollapsed(prev => {
      const next = new Set(prev);
      if (next.has(sector)) next.delete(sector);
      else next.add(sector);
      return next;
    });
  };

  const openCreate = (sector: EventSector) => {
    setEditingTask(null);
    setDefaultSector(sector);
    setSheetOpen(true);
  };

  const openEdit = (task: EventTask) => {
    setEditingTask(task);
    setDefaultSector(null);
    setSheetOpen(true);
  };

  if (evLoading) return <p className="text-body-sm text-fg-muted">Carregando...</p>;
  if (evError || !event) return <p className="text-danger text-body-sm">Evento não encontrado.</p>;

  return (
    <div className="space-y-4">
      <header className="space-y-1">
        <Link to="/mais/agenda-escolar" className="text-caption text-fg-muted underline">
          ← Voltar
        </Link>
        <h2 className="text-title text-fg">{event.title}</h2>
        <p className="text-body-sm text-fg-muted">
          {formatEventDate(event.event_date, event.start_time)}
          {event.location ? ` · ${event.location}` : ''}
          {' · '}{unitLabel(event.unit)}
        </p>
      </header>

      {tLoading && <p className="text-body-sm text-fg-muted">Carregando tarefas...</p>}

      {!tLoading && SECTORS.map(sector => {
        const sectorTasks = tasksBySector[sector];
        const isCollapsed = collapsed.has(sector) || (sectorTasks.length === 0 && !collapsed.has(sector));
        // Default: open if has tasks, collapsed if empty (unless user toggled)
        const shouldShow = sectorTasks.length > 0 ? !collapsed.has(sector) : collapsed.has(sector) ? true : false;
        return (
          <section key={sector} className="bg-bg-surface rounded-xl border border-border">
            <button
              type="button"
              onClick={() => toggleCollapsed(sector)}
              className="w-full flex items-center justify-between p-3 focus-ring"
            >
              <div className="flex items-center gap-2">
                {shouldShow ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                <span className="text-body font-medium">{SECTOR_LABELS[sector]}</span>
                <span className="text-caption text-fg-muted">({sectorTasks.length})</span>
              </div>
            </button>

            {shouldShow && (
              <div className="px-3 pb-3 space-y-2">
                {sectorTasks.map(task => (
                  <div key={task.id} className="flex items-start gap-2 py-2 border-t border-border">
                    <input
                      type="checkbox"
                      checked={task.status === 'done'}
                      onChange={() => toggleStatus.mutate(task)}
                      className="mt-1 focus-ring"
                      aria-label={`Marcar ${task.title} como concluída`}
                    />
                    <div className="flex-1 min-w-0">
                      <p className={`text-body ${task.status === 'done' ? 'line-through text-fg-muted' : 'text-fg'}`}>
                        {task.title}
                      </p>
                      <p className="text-caption text-fg-muted">
                        {task.assigned_collab?.full_name ?? '—'}
                        {task.due_date ? ` · ${task.due_date.slice(8, 10)}/${task.due_date.slice(5, 7)}` : ''}
                        {task.status !== 'pending' && task.status !== 'done'
                          ? ` · ${TASK_STATUS_LABELS[task.status]}`
                          : ''}
                      </p>
                      {task.notes && (
                        <p className="text-caption text-fg-muted mt-1 italic">{task.notes}</p>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => openEdit(task)}
                      className="h-8 w-8 grid place-items-center text-fg-muted hover:text-fg focus-ring rounded"
                      aria-label="Editar"
                    >
                      <Pencil size={14} />
                    </button>
                    {confirmDelete === task.id ? (
                      <button
                        type="button"
                        onClick={() => deleteTask.mutate(task.id)}
                        className="text-caption text-danger px-2 focus-ring rounded"
                      >
                        Confirmar?
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => {
                          setConfirmDelete(task.id);
                          setTimeout(() => setConfirmDelete(prev => (prev === task.id ? null : prev)), 3000);
                        }}
                        className="h-8 w-8 grid place-items-center text-fg-muted hover:text-danger focus-ring rounded"
                        aria-label="Excluir"
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() => openCreate(sector)}
                  className="w-full mt-2 py-2 flex items-center justify-center gap-1 text-caption text-fg-muted hover:text-brand border border-dashed border-border rounded-lg focus-ring"
                >
                  <Plus size={14} /> Adicionar tarefa
                </button>
              </div>
            )}
          </section>
        );
      })}

      {sheetOpen && event && (
        <EventTaskSheet
          open={sheetOpen}
          onClose={() => setSheetOpen(false)}
          event={event}
          task={editingTask}
          defaultSector={defaultSector}
        />
      )}
    </div>
  );
}
```

**Nota sobre o estado de collapsed:** O acordeão usa o invariante "setor com tasks → aberto; sem tasks → colapsado", e o `Set<EventSector> collapsed` armazena os toggles do usuário (override). A linha `const shouldShow = sectorTasks.length > 0 ? !collapsed.has(sector) : collapsed.has(sector) ? true : false;` implementa isso: se tem tasks, abre por padrão e fecha se o usuário toggou; se não tem, fica fechado por padrão e abre se o usuário toggou.

- [ ] **Step 2: Verificar tsc**

```bash
cd D:\la-organizer\_remote\web && npx tsc --noEmit
```

Expected: erro `Cannot find module '../components/EventTaskSheet'` — esperado, esse arquivo é criado no Task 4. Outros erros não devem aparecer. Se aparecerem, corrija antes de seguir.

---

## Task 4: `EventTaskSheet` — form sheet de criar/editar task

**Files:** Create `D:\la-organizer\_remote\web\src\components\EventTaskSheet.tsx`

- [ ] **Step 1: Criar o componente**

```tsx
import { useState, useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { BottomSheet } from './BottomSheet';
import { SECTORS, SECTOR_LABELS } from '../types';
import type { EventSector, SchoolEvent, Task, TaskStatus } from '../types';

interface CollabOption {
  id: string;
  full_name: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  event: SchoolEvent;
  task: Task | null;          // null = create, Task = edit
  defaultSector: EventSector | null;
}

const STATUS_OPTIONS: { value: TaskStatus; label: string }[] = [
  { value: 'pending', label: 'Pendente' },
  { value: 'in_progress', label: 'Em andamento' },
  { value: 'awaiting_confirmation', label: 'Aguardando confirmação' },
  { value: 'done', label: 'Concluída' },
  { value: 'cancelled', label: 'Cancelada' },
];

export function EventTaskSheet({ open, onClose, event, task, defaultSector }: Props) {
  const { collaborator } = useAuth();
  const queryClient = useQueryClient();

  const isEdit = !!task;

  const [title, setTitle] = useState('');
  const [sector, setSector] = useState<EventSector>('logistica');
  const [assignedTo, setAssignedTo] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [notes, setNotes] = useState('');
  const [supportTeam, setSupportTeam] = useState<string[]>([]);
  const [status, setStatus] = useState<TaskStatus>('pending');
  const [error, setError] = useState('');

  // Sync state when sheet opens or task changes
  useEffect(() => {
    if (!open) return;
    if (task) {
      setTitle(task.title);
      setSector((task.event_sector as EventSector) ?? 'logistica');
      setAssignedTo(task.assigned_to);
      setDueDate(task.due_date ?? event.event_date);
      setNotes(task.notes ?? '');
      setSupportTeam(task.support_team ?? []);
      setStatus(task.status);
    } else {
      setTitle('');
      setSector(defaultSector ?? 'logistica');
      setAssignedTo(collaborator?.id ?? '');
      setDueDate(event.event_date);
      setNotes('');
      setSupportTeam([]);
      setStatus('pending');
    }
    setError('');
  }, [open, task, defaultSector, event.event_date, collaborator?.id]);

  // Load collaborators (filtered by event unit if set)
  const { data: collabs = [] } = useQuery({
    queryKey: ['collaborators-for-event', event.unit],
    queryFn: async () => {
      let q = supabase
        .from('collaborators')
        .select('id, full_name')
        .eq('is_active', true)
        .order('full_name', { ascending: true });
      if (event.unit) q = q.or(`unit.eq.${event.unit},unit.is.null`);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as CollabOption[];
    },
    enabled: open,
  });

  const canSave = title.trim().length > 0 && !!assignedTo && !!dueDate;

  const { mutate, isPending } = useMutation({
    mutationFn: async () => {
      setError('');
      if (!collaborator) throw new Error('no_session');

      await supabase.rpc('set_config', {
        key: 'app.current_user_id',
        value: collaborator.id,
      });

      const payload = {
        title: title.trim().slice(0, 200),
        assigned_to: assignedTo,
        due_date: dueDate,
        status,
        event_sector: sector,
        notes: notes.trim() || null,
        support_team: supportTeam.length > 0 ? supportTeam : null,
        school_event_id: event.id,
      };

      if (isEdit && task) {
        const { error: upErr } = await supabase
          .from('tasks')
          .update(payload)
          .eq('id', task.id);
        if (upErr) throw upErr;
      } else {
        const { error: insErr } = await supabase.from('tasks').insert({
          ...payload,
          created_by: collaborator.id,
          source: 'manual',
          context: 'work',
          priority: 'medium',
        });
        if (insErr) throw insErr;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['event-tasks', event.id] });
      onClose();
    },
    onError: (err: Error) => setError(err.message),
  });

  return (
    <BottomSheet open={open} onClose={onClose} title={isEdit ? 'Editar tarefa' : 'Nova tarefa'}>
      <div className="space-y-4 pb-4">
        <div>
          <label className="text-caption text-fg-muted block mb-1">Título *</label>
          <input
            type="text"
            maxLength={200}
            className="mt-1 w-full rounded-lg border border-border bg-bg-surface px-3 py-2 text-body text-fg focus:outline-none focus:border-brand"
            placeholder="Ex.: Montar palco"
            value={title}
            onChange={e => setTitle(e.target.value)}
          />
        </div>

        <div>
          <label className="text-caption text-fg-muted block mb-1">Setor *</label>
          <select
            className="mt-1 w-full rounded-lg border border-border bg-bg-surface px-3 py-2 text-body text-fg focus:outline-none focus:border-brand"
            value={sector}
            onChange={e => setSector(e.target.value as EventSector)}
          >
            {SECTORS.map(s => (
              <option key={s} value={s}>{SECTOR_LABELS[s]}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="text-caption text-fg-muted block mb-1">Responsável *</label>
          <select
            className="mt-1 w-full rounded-lg border border-border bg-bg-surface px-3 py-2 text-body text-fg focus:outline-none focus:border-brand"
            value={assignedTo}
            onChange={e => setAssignedTo(e.target.value)}
          >
            <option value="">Selecione…</option>
            {collabs.map(c => (
              <option key={c.id} value={c.id}>{c.full_name}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="text-caption text-fg-muted block mb-1">Apoio (opcional)</label>
          <select
            multiple
            size={Math.min(5, Math.max(2, collabs.length))}
            className="mt-1 w-full rounded-lg border border-border bg-bg-surface px-3 py-2 text-body text-fg focus:outline-none focus:border-brand"
            value={supportTeam}
            onChange={e => {
              const opts = Array.from(e.target.selectedOptions).map(o => o.value);
              setSupportTeam(opts);
            }}
          >
            {collabs
              .filter(c => c.id !== assignedTo)
              .map(c => (
                <option key={c.id} value={c.id}>{c.full_name}</option>
              ))}
          </select>
          <p className="text-caption text-fg-muted mt-1">Segure Ctrl/Cmd para selecionar múltiplos.</p>
        </div>

        <div>
          <label className="text-caption text-fg-muted block mb-1">Prazo *</label>
          <input
            type="date"
            className="mt-1 w-full rounded-lg border border-border bg-bg-surface px-3 py-2 text-body text-fg focus:outline-none focus:border-brand"
            value={dueDate}
            onChange={e => setDueDate(e.target.value)}
          />
          <p className="text-caption text-fg-muted mt-1">Padrão: dia do evento ({event.event_date}).</p>
        </div>

        <div>
          <label className="text-caption text-fg-muted block mb-1">Observações (opcional)</label>
          <textarea
            rows={3}
            className="mt-1 w-full rounded-lg border border-border bg-bg-surface px-3 py-2 text-body text-fg focus:outline-none focus:border-brand"
            placeholder="Detalhes, links, instruções…"
            value={notes}
            onChange={e => setNotes(e.target.value)}
          />
        </div>

        <div>
          <label className="text-caption text-fg-muted block mb-1">Status</label>
          <select
            className="mt-1 w-full rounded-lg border border-border bg-bg-surface px-3 py-2 text-body text-fg focus:outline-none focus:border-brand"
            value={status}
            onChange={e => setStatus(e.target.value as TaskStatus)}
          >
            {STATUS_OPTIONS.map(o => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>

        {error && <p className="text-danger text-caption">{error}</p>}

        <button
          type="button"
          disabled={!canSave || isPending}
          onClick={() => mutate()}
          className="w-full py-3 bg-brand text-white rounded-xl font-semibold disabled:opacity-40 disabled:cursor-not-allowed transition-opacity"
        >
          {isPending ? 'Salvando...' : isEdit ? 'Salvar alterações' : 'Criar tarefa'}
        </button>
      </div>
    </BottomSheet>
  );
}
```

- [ ] **Step 2: Verificar tsc**

```bash
cd D:\la-organizer\_remote\web && npx tsc --noEmit
```

Expected: sem erros agora (Task 3 + Task 4 completos).

---

## Task 5: Navegação — rota + link

**Files:**
- Modify: `D:\la-organizer\_remote\web\src\App.tsx`
- Modify: `D:\la-organizer\_remote\web\src\screens\AgendaEscolar.tsx`

- [ ] **Step 1: Adicionar import e rota em `App.tsx`**

Em `App.tsx`, adicione o import (junto com os outros, na ordem alfabética por convenção do arquivo — depois do `import { AgendaEscolar } from './screens/AgendaEscolar';`):

```tsx
import { EventoDetalhe } from './screens/EventoDetalhe';
```

Em seguida, adicione a rota dentro do bloco `<Route element={<AppShell />}>` — logo após a linha `<Route path="mais/observabilidade" element={<Observabilidade />} />`:

```tsx
<Route path="mais/eventos/:id" element={<EventoDetalhe />} />
```

- [ ] **Step 2: Adicionar link "Tarefas" no card de evento (`AgendaEscolar.tsx`)**

Em `AgendaEscolar.tsx`, primeiro adicione o import do `Link` ao topo (verifique se já não está importado):

```tsx
import { Link } from 'react-router-dom';
```

Em seguida, dentro do `<li>` do card de evento, depois da `<div>` que contém os chips (`<div className="flex flex-wrap gap-3">…</div>`) e antes do botão `Cancelar evento`, adicione:

```tsx
<div className="flex items-center gap-3">
  <Link
    to={`/mais/eventos/${ev.id}`}
    className="text-caption text-brand underline focus-ring rounded"
  >
    Tarefas do evento
  </Link>
</div>
```

O botão "Cancelar evento" continua existindo logo abaixo. O link aparece para todos que têm acesso à tela `AgendaEscolar` (que já é restrita a `coordinator`/`director` via `Mais.tsx`), portanto não precisa de check de role adicional aqui.

- [ ] **Step 3: Verificar tsc**

```bash
cd D:\la-organizer\_remote\web && npx tsc --noEmit
```

Expected: sem erros.

---

## Task 6: Build e smoke test local

- [ ] **Step 1: Build da PWA**

```bash
cd D:\la-organizer\_remote\web && npm run build
```

Expected: build completa sem erros. Output em `web/dist/`.

- [ ] **Step 2: Verificação estática rápida**

Releia os arquivos criados/modificados e confirme:

1. `types.ts`:
   - `TaskStatus` inclui `awaiting_confirmation`
   - `EventSector`, `SECTORS`, `SECTOR_LABELS`, `TASK_STATUS_LABELS` exportados
   - `Task` interface tem 4 campos novos (todos opcionais)
2. `EventoDetalhe.tsx`:
   - Query usa `school_event_id` no filter
   - Toggle status grava `completed_at` e `completed_by` ao marcar `done`
   - Setor com tasks abre por default; vazio fica colapsado
3. `EventTaskSheet.tsx`:
   - INSERT inclui `source: 'manual'`, `context: 'work'`, `priority: 'medium'`, `created_by`
   - UPDATE NÃO inclui esses campos (preserva originais)
   - `due_date` defaulta para `event.event_date`
   - Filtra colaboradores por unidade do evento (com OR para unidade nula)
4. `App.tsx`: rota `mais/eventos/:id` registrada
5. `AgendaEscolar.tsx`: link "Tarefas do evento" no card

Se algum item falhar, corrija antes de seguir para Task 7.

---

## Task 7: Deploy + validação E2E

**Files:** scp para VPS (host `tom`, key `~/.ssh/tom_vps`).

- [ ] **Step 1: Sincronizar PWA built**

```bash
scp -i ~/.ssh/tom_vps -r D:/la-organizer/_remote/web/dist/. tom:/opt/LA-Organizer/web/dist/
```

- [ ] **Step 2: Reiniciar pm2 (PWA)**

```bash
ssh -i ~/.ssh/tom_vps tom "pm2 restart la-organizer-web && pm2 status la-organizer-web"
```

Expected: `online`.

- [ ] **Step 3: Smoke test — criar task de evento**

Use `mcp__4c04bb52-f946-4fe8-85f6-b01d200f8c20__execute_sql`:

```sql
-- Pegar um evento ativo e um coordinator
SELECT
  (SELECT id FROM school_events WHERE status = 'active' ORDER BY event_date DESC LIMIT 1) AS event_id,
  (SELECT id FROM collaborators WHERE role = 'coordinator' LIMIT 1) AS coord_id;
```

Anote os UUIDs retornados.

```sql
-- Inserir uma task de evento de teste
INSERT INTO tasks (
  title, assigned_to, due_date, status, source, context, priority, category,
  school_event_id, event_sector, notes, created_by
)
SELECT
  'Teste S14F1: montar palco',
  '<COORD-UUID>',
  ev.event_date,
  'pending', 'manual', 'work', 'medium', 'operational',
  ev.id, 'logistica', 'observação de teste',
  '<COORD-UUID>'
FROM school_events ev WHERE ev.id = '<EVENT-UUID>'
RETURNING id, title, event_sector, school_event_id;
```

Expected: 1 row retornada, todos os campos preenchidos.

- [ ] **Step 4: Smoke test — query funcional**

```sql
SELECT t.id, t.title, t.event_sector, t.status, c.full_name AS responsavel
FROM tasks t
LEFT JOIN collaborators c ON c.id = t.assigned_to
WHERE t.school_event_id = '<EVENT-UUID>'
ORDER BY t.event_sector, t.created_at;
```

Expected: pelo menos 1 row (a task criada no Step 3), com `event_sector = 'logistica'`.

- [ ] **Step 5: Smoke test — testar status `awaiting_confirmation`**

```sql
UPDATE tasks SET status = 'awaiting_confirmation' WHERE title = 'Teste S14F1: montar palco' RETURNING id, status;
```

Expected: 1 row, `status = 'awaiting_confirmation'`. Se der erro de CHECK constraint, a migration do Task 1 não foi aplicada corretamente.

- [ ] **Step 6: Smoke test — PWA**

Abra a PWA no browser (mobile ou desktop). Login como coordinator/director.

Navegue: `Mais` → `Agenda Escolar` → veja card do evento → clique em "Tarefas do evento" → confirma:

1. ✅ Tela `/mais/eventos/<id>` carrega com header (título, data, unidade)
2. ✅ Setor "Logística" mostra a task "Teste S14F1: montar palco"
3. ✅ Outros 4 setores aparecem colapsados (count 0)
4. ✅ Clique na checkbox da task → marca como concluída (linha riscada)
5. ✅ Clique em "Adicionar tarefa" em qualquer setor vazio → abre EventTaskSheet → preenche título, responsável, prazo → "Criar tarefa" → task aparece imediatamente na lista
6. ✅ Clique em ✏️ (editar) → sheet abre com campos preenchidos → muda algo → salva → atualiza
7. ✅ Clique em 🗑️ (excluir) → vira "Confirmar?" → clique → task some
8. ✅ Status select inclui "Aguardando confirmação"

- [ ] **Step 7: Cleanup do teste**

```sql
DELETE FROM tasks WHERE title LIKE 'Teste S14F1%';
```

---

## Self-Review

**Spec coverage:**
- ✅ DB migration: 4 colunas novas + status `awaiting_confirmation` + índice (Task 1)
- ✅ Tipos TypeScript: `Task` extendido + `EventSector`/`SECTORS`/`SECTOR_LABELS`/`TASK_STATUS_LABELS` (Task 2)
- ✅ Tela `EventoDetalhe` com header read-only, acordeões por setor, toggle status, edit, delete (Task 3)
- ✅ `EventTaskSheet` com todos os campos (title, sector, assigned_to, support_team, due_date, notes, status) (Task 4)
- ✅ Rota `/mais/eventos/:id` em `App.tsx` (Task 5)
- ✅ Link "Tarefas do evento" em `AgendaEscolar` (Task 5)
- ✅ Sem TOM, sem engine, sem skills (escopo Fatia 1 ✓)
- ✅ Build + deploy + smoke test E2E (Tasks 6-7)

**No placeholders.**

**Type consistency:**
- `EventSector` definido em Task 2.2 e usado em Tasks 3.1, 4.1
- `SECTORS` (array) usado em Tasks 3.1 e 4.1 com mesma ordem
- `TASK_STATUS_LABELS` definido em Task 2.4, usado em Task 3.1
- `school_event_id` (snake_case) consistente em DB (Task 1) e queries (Tasks 3, 4)
- `support_team` é `uuid[]` no DB e `string[]` no TS (mapeamento correto)
- INSERT em Task 4 inclui `category: 'operational'` que é o default DB — não precisa explícito, mas incluído por segurança? **Verificação: o INSERT do Task 4 NÃO inclui `category` explícito** — confiando no default. Isso está correto, é como `QuickTaskSheet` faz.

Ah, momento — `QuickTaskSheet` na linha 42-52 também não passa `category`. O default `'operational'` cobre. Plan está consistente.

**Note:** Este projeto não tem git local — sem `git commit` em nenhuma task. Artefatos são deployados via scp no Task 7.

**Próxima fatia (Sprint 14 Fatia 2 — NÃO esquecer):**
- TOM 5W2H auto-generation (criar tasks via skill ao criar evento)
- Mapa de equipe (setor → responsável fixo por evento)
- Lembretes automáticos via dispatcher usando `remind_at`
