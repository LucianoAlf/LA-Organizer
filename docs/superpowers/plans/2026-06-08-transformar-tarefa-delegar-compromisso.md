# Transformar Tarefa (Delegar / Compromisso) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir transformar uma tarefa existente em **compromisso** (evento na agenda, arquivando a tarefa) ou **delegá-la** a um membro da equipe (com WhatsApp do TOM), no desktop e no PWA.

**Architecture:** 100% client-side via Supabase, reusando os padrões já existentes em `QuickCreateSheet.tsx` (createEvent / delegate) e o helper `notifyTaskDelegated()` (`lib/tomEngine.ts`). Dois novos `AdaptiveSheet` (Delegar / Converter), abertos do `RowMenu` do card e de dentro do `EditTaskSheet`. Sem endpoint serverless, sem mudança de RLS. Única mudança de schema: coluna `tasks.converted_to_event_id`.

**Tech Stack:** React + TypeScript + Vite + Tailwind (tokens DS), @tanstack/react-query, Supabase JS, vitest.

**Spec:** `docs/superpowers/specs/2026-06-08-transformar-tarefa-delegar-compromisso-design.md`

**Convenções do projeto (CLAUDE.md):**
- NÃO commitar entre tasks. Trabalhar tudo local em `_remote/`. O Stop hook faz commit+push+deploy no fim do turno.
- Migrations podem ser aplicadas no Supabase via MCP (projeto `cesnbnrynvxvgdhfmaua`).
- Validação: `cd _remote/web && npx tsc --noEmit` e `npx vite build`. Preview PWA em `localhost:4173`.
- DS: usar `AdaptiveSheet`, `DateInput`, `TimeInput`, `DateTimeInput`, `CustomSelect`, `Button`, tokens `bg-tom/text-fg/bg-bg-surface/border-border`. Testar 375px e 1440px.

---

## File Structure

**Criar:**
- `migrations/2026-06-08-task-convert-to-event.sql` — coluna de rastro tarefa→evento.
- `web/src/lib/delegableMembers.ts` — função PURA: dado o líder + lista de colabs, retorna quem ele pode delegar.
- `web/src/lib/delegableMembers.test.ts` — testes vitest da função pura.
- `web/src/hooks/useDelegableMembers.ts` — hook que carrega colabs+governança e aplica a função pura.
- `web/src/components/DelegateTaskSheet.tsx` — modal de delegar (update + notifyTaskDelegated).
- `web/src/components/ConvertToEventSheet.tsx` — modal de converter em compromisso (insert event + arquiva task).
- `web/src/hooks/useTaskTransform.tsx` — controller: estado + render dos 2 sheets + helper `canDelegate(task)`.

**Modificar:**
- `web/src/types.ts` — `Task.converted_to_event_id?: string | null`.
- `web/src/components/TaskRow.tsx` — props `onDelegate?`/`onTransformToEvent?` + itens no `RowMenu`.
- `web/src/components/EditTaskSheet.tsx` — prop `onTransform?` + seção "Transformar em".
- `web/src/screens/Hoje.tsx`, `web/src/screens/Semana.tsx`, `web/src/screens/AgendaDesktop.tsx` — fiar o `useTaskTransform` (passar handlers ao `TaskRow`/`EditTaskSheet` e renderizar os sheets).

---

## Task 1: Migração — coluna `converted_to_event_id`

**Files:**
- Create: `migrations/2026-06-08-task-convert-to-event.sql`

- [ ] **Step 1: Escrever a migração**

```sql
-- Rastro tarefa→compromisso: quando uma tarefa é convertida em evento, marcamos
-- a tarefa como 'cancelled' e guardamos o id do evento criado. Evita cobrança
-- duplicada (a tarefa some da lista ativa) mas preserva o rastro.
ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS converted_to_event_id uuid
  REFERENCES events(id) ON DELETE SET NULL;

COMMENT ON COLUMN tasks.converted_to_event_id IS
  'Quando a tarefa foi transformada em compromisso, aponta pro events.id criado. status=cancelled nesse caso.';
```

- [ ] **Step 2: Aplicar no Supabase via MCP**

Usar a tool `mcp__supabase__apply_migration` (ou `execute_sql`) no projeto `cesnbnrynvxvgdhfmaua` com o SQL acima. Nome da migração: `task_convert_to_event`.

- [ ] **Step 3: Verificar coluna criada**

Rodar via MCP `execute_sql`:
```sql
SELECT column_name, data_type FROM information_schema.columns
WHERE table_name='tasks' AND column_name='converted_to_event_id';
```
Esperado: 1 linha, `uuid`.

---

## Task 2: Tipo `Task.converted_to_event_id`

**Files:**
- Modify: `web/src/types.ts` (interface `Task`)

- [ ] **Step 1: Adicionar o campo na interface Task**

Localizar a interface `Task` (campos como `id`, `title`, `status`, `assigned_to`, `delegated_to`...) e adicionar:

```ts
  converted_to_event_id?: string | null;
```

- [ ] **Step 2: Typecheck**

Run: `cd _remote/web && npx tsc --noEmit`
Expected: sem erros novos.

---

## Task 3: Função pura `delegableMembers` (TDD)

A regra de "pra quem o líder pode delegar" é pura e testável. Reusa `membersOf` de `lib/team-routing.ts` (inversa de `resolveLeadersOf`), com diretor → todos e fallback → todos ativos.

**Files:**
- Create: `web/src/lib/delegableMembers.ts`
- Test: `web/src/lib/delegableMembers.test.ts`

- [ ] **Step 1: Escrever o teste primeiro**

```ts
import { describe, it, expect } from 'vitest';
import { delegableMembers } from './delegableMembers';
import type { Collab } from './team-routing';

const mk = (id: string, role: string, extra: Partial<Collab> = {}): Collab => ({
  id, role, function_role: null, unit: null, supervisor_id: null,
  is_ceo: false, is_active: true, explicit_leader_ids: [], group_leader_ids: [], ...extra,
});

describe('delegableMembers', () => {
  const dir = mk('dir', 'director', { is_ceo: true });
  const coord = mk('coord', 'coordinator');
  const m1 = mk('m1', 'collaborator', { explicit_leader_ids: ['coord'] });
  const m2 = mk('m2', 'collaborator', { explicit_leader_ids: ['coord'] });
  const other = mk('other', 'collaborator', { explicit_leader_ids: ['dir'] });
  const all = [dir, coord, m1, m2, other];

  it('coordenador vê só sua equipe direta (m1, m2) — exclui ele mesmo', () => {
    const ids = delegableMembers('coord', 'coordinator', all).map(c => c.id).sort();
    expect(ids).toEqual(['m1', 'm2']);
  });

  it('diretor vê todos os ativos menos ele mesmo', () => {
    const ids = delegableMembers('dir', 'director', all).map(c => c.id).sort();
    expect(ids).toEqual(['coord', 'm1', 'm2', 'other']);
  });

  it('líder sem equipe configurada cai no fallback = todos ativos menos ele', () => {
    const lone = mk('lone', 'coordinator');
    const ids = delegableMembers('lone', 'coordinator', [lone, m1, m2]).map(c => c.id).sort();
    expect(ids).toEqual(['m1', 'm2']);
  });

  it('exclui colaboradores inativos', () => {
    const inactive = mk('inact', 'collaborator', { explicit_leader_ids: ['coord'], is_active: false });
    const ids = delegableMembers('coord', 'coordinator', [...all, inactive]).map(c => c.id);
    expect(ids).not.toContain('inact');
  });
});
```

- [ ] **Step 2: Rodar o teste — deve FALHAR**

Run: `cd _remote/web && npx vitest run src/lib/delegableMembers.test.ts`
Expected: FAIL (módulo `./delegableMembers` não existe).

- [ ] **Step 3: Implementar a função pura**

```ts
// web/src/lib/delegableMembers.ts
// Quem um líder pode delegar: a equipe direta dele (inversa de resolveLeadersOf).
// Diretor → todos os ativos. Fallback (líder sem arestas) → todos os ativos.
// Sempre exclui o próprio usuário. Função PURA — testável sem rede.
import { membersOf, type Collab } from './team-routing';

export function delegableMembers(meId: string, role: string, allCollabs: Collab[]): Collab[] {
  const active = (allCollabs ?? []).filter(c => c && c.is_active !== false && c.id !== meId);
  if (role === 'director') return active;

  const me = (allCollabs ?? []).find(c => c.id === meId);
  if (!me) return active; // sem contexto → fallback
  const team = membersOf(me, allCollabs);
  return team.length > 0 ? team : active; // fallback: sem equipe configurada → todos ativos
}
```

- [ ] **Step 4: Rodar o teste — deve PASSAR**

Run: `cd _remote/web && npx vitest run src/lib/delegableMembers.test.ts`
Expected: 4 passed.

---

## Task 4: Hook `useDelegableMembers`

Carrega colaboradores + arestas de governança, anexa `explicit_leader_ids`/`group_leader_ids`, e aplica `delegableMembers`. Reusa `fetchGovernanceEdges`, `attachExplicitLeaders`, `fetchGroupLeaders`, `attachGroupLeaders` de `lib/governance-edges.ts`.

**Files:**
- Create: `web/src/hooks/useDelegableMembers.ts`

- [ ] **Step 1: Implementar o hook**

```ts
// web/src/hooks/useDelegableMembers.ts
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import {
  fetchGovernanceEdges, attachExplicitLeaders,
  fetchGroupLeaders, attachGroupLeaders,
} from '../lib/governance-edges';
import { delegableMembers } from '../lib/delegableMembers';
import type { Collab } from '../lib/team-routing';

export interface DelegableMember { id: string; full_name: string; role: string; }

export function useDelegableMembers(enabled: boolean) {
  const { collaborator } = useAuth();
  return useQuery({
    queryKey: ['delegable-members', collaborator?.id],
    enabled: enabled && Boolean(collaborator?.id),
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<DelegableMember[]> => {
      const { data, error } = await supabase
        .from('collaborators')
        .select('id, full_name, role, function_role, unit, supervisor_id, is_ceo, is_active')
        .eq('is_active', true);
      if (error) throw error;
      const collabs = (data ?? []) as unknown as (Collab & { full_name: string })[];
      const [edges, groupLeaders] = await Promise.all([fetchGovernanceEdges(), fetchGroupLeaders()]);
      attachExplicitLeaders(collabs, edges);
      attachGroupLeaders(collabs, groupLeaders);
      const me = collaborator!;
      const team = delegableMembers(me.id, me.role, collabs) as (Collab & { full_name: string })[];
      return team
        .map(c => ({ id: c.id, full_name: c.full_name, role: c.role }))
        .sort((a, b) => a.full_name.localeCompare(b.full_name));
    },
  });
}
```

- [ ] **Step 2: Typecheck**

Run: `cd _remote/web && npx tsc --noEmit`
Expected: sem erros novos.

---

## Task 5: `ConvertToEventSheet` (tarefa → compromisso)

Espelha o `createEvent` de `QuickCreateSheet`: usa `useEventCategories` (default `la_music`), monta `start_at/end_at` como `${'YYYY-MM-DDTHH:MM'}:00-03:00`, insere em `events` com `source='manual'`, e marca a tarefa `status='cancelled'` + `converted_to_event_id`.

**Files:**
- Create: `web/src/components/ConvertToEventSheet.tsx`

- [ ] **Step 1: Implementar o componente**

```tsx
// web/src/components/ConvertToEventSheet.tsx
// Transforma uma tarefa existente em compromisso (events) e arquiva a tarefa
// (status='cancelled' + converted_to_event_id). Client-side, espelha o
// createEvent do QuickCreateSheet. DS: AdaptiveSheet + DateTimeInput + CustomSelect.
import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import { AdaptiveSheet } from './AdaptiveSheet';
import { Button } from './Button';
import { DateTimeInput } from './DateTimeInput';
import { CustomSelect } from './CustomSelect';
import { useEventCategories } from '../hooks/useEventCategories';
import { showToast } from './Toast';
import { MODALITY_LABELS, type EventModality } from '../types';
import type { Task } from '../types';

const MODALITIES: EventModality[] = ['presencial', 'online', 'hibrido'];

interface Props { open: boolean; task: Task | null; onClose: () => void; }

export function ConvertToEventSheet({ open, task, onClose }: Props) {
  const { collaborator } = useAuth();
  const qc = useQueryClient();
  const eventCategories = useEventCategories();
  const defaultCategoryId = eventCategories.bySlug('la_music')?.id ?? '';

  const [categoryId, setCategoryId] = useState('');
  const [startAt, setStartAt] = useState('');
  const [endAt, setEndAt] = useState('');
  const [modality, setModality] = useState<EventModality>('presencial');
  const [locationText, setLocationText] = useState('');
  const [meetingUrl, setMeetingUrl] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !task) return;
    const day = task.due_date || new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(new Date());
    setCategoryId(defaultCategoryId);
    setStartAt(`${day}T09:00`);
    setEndAt(`${day}T10:00`);
    setModality('presencial');
    setLocationText('');
    setMeetingUrl('');
    setError(null);
  }, [open, task?.id, defaultCategoryId]); // eslint-disable-line react-hooks/exhaustive-deps

  const showMeetingUrl = modality === 'online' || modality === 'hibrido';

  const convert = useMutation({
    mutationFn: async () => {
      if (!collaborator || !task) throw new Error('no_task');
      const cat = eventCategories.byId(categoryId);
      if (!cat) throw new Error('Escolhe uma categoria.');
      const startIso = `${startAt}:00-03:00`;
      const endIso = `${endAt}:00-03:00`;
      if (new Date(endIso) <= new Date(startIso)) throw new Error('Fim precisa ser depois do início.');
      const remindMs = new Date(startIso).getTime() - 60 * 60 * 1000;
      const remindAt = remindMs > Date.now() ? new Date(remindMs).toISOString() : null;

      const { data: ev, error: evErr } = await supabase.from('events').insert({
        title: task.title.slice(0, 200),
        description: task.description ?? null,
        collaborator_id: collaborator.id,
        created_by: collaborator.id,
        source: 'manual',
        status: 'scheduled',
        context: cat.context,
        category_id: cat.id,
        project_id: task.project_id ?? null,
        start_at: startIso,
        end_at: endIso,
        remind_at: remindAt,
        modality,
        location_text: locationText.trim() || null,
        meeting_url: showMeetingUrl && meetingUrl.trim() ? meetingUrl.trim() : null,
        eisenhower_quadrant: task.eisenhower_quadrant ?? null,
      }).select('id').single();
      if (evErr) throw evErr;
      if (!ev?.id) throw new Error('Não consegui criar o compromisso.');

      const { error: upErr } = await supabase.from('tasks')
        .update({ status: 'cancelled', converted_to_event_id: ev.id })
        .eq('id', task.id)
        .select('id');
      if (upErr) throw upErr;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['events'] });
      qc.invalidateQueries({ queryKey: ['tasks'] });
      showToast({ kind: 'success', title: 'Tarefa virou compromisso' });
      onClose();
    },
    onError: (e: Error) => setError(e.message),
  });

  return (
    <AdaptiveSheet open={open && Boolean(task)} onClose={onClose} title="Transformar em compromisso" size="md">
      {task && (
        <div className="space-y-md">
          <div className="rounded-md border border-border bg-bg-elevated p-3 text-body-sm text-fg-muted">
            De: <span className="text-fg font-medium">{task.title}</span>
          </div>

          <div>
            <div className="text-label uppercase tracking-wide text-fg-muted mb-1.5">Categoria</div>
            <CustomSelect
              value={categoryId}
              placeholder="— Escolher categoria —"
              onChange={setCategoryId}
              options={[
                ...eventCategories.workCategories.map(c => ({ value: c.id, label: c.label })),
                ...eventCategories.personalCategories.map(c => ({ value: c.id, label: c.label, sublabel: 'pessoal' })),
              ]}
            />
          </div>

          <div className="space-y-md">
            <div>
              <div className="text-label uppercase tracking-wide text-fg-muted mb-1.5">Início</div>
              <DateTimeInput value={startAt} onChange={setStartAt} />
            </div>
            <div>
              <div className="text-label uppercase tracking-wide text-fg-muted mb-1.5">Fim</div>
              <DateTimeInput value={endAt} onChange={setEndAt} />
            </div>
          </div>

          <fieldset>
            <legend className="text-label uppercase tracking-wide text-fg-muted mb-1.5">Modalidade</legend>
            <div role="radiogroup" className="grid grid-cols-3 gap-2">
              {MODALITIES.map(m => {
                const active = modality === m;
                return (
                  <button key={m} type="button" role="radio" aria-checked={active}
                    onClick={() => setModality(m)}
                    className={['h-11 rounded-md border text-body-sm font-semibold transition-colors focus-ring',
                      active ? 'bg-tom text-black border-tom' : 'bg-bg-subtle text-fg-secondary border-border'].join(' ')}
                  >{MODALITY_LABELS[m]}</button>
                );
              })}
            </div>
          </fieldset>

          <label className="block">
            <div className="text-label uppercase tracking-wide text-fg-muted mb-1.5">
              {modality === 'presencial' ? 'Local' : 'Local (físico, opcional)'}
            </div>
            <input type="text" maxLength={200} value={locationText} onChange={e => setLocationText(e.target.value)}
              placeholder="Ex.: LA Recreio sala 2"
              className="w-full h-12 px-3 rounded-md bg-bg-elevated border border-border text-fg placeholder:text-fg-muted focus-ring" />
          </label>

          {showMeetingUrl && (
            <label className="block">
              <div className="text-label uppercase tracking-wide text-fg-muted mb-1.5">Link da reunião</div>
              <input type="url" maxLength={500} value={meetingUrl} onChange={e => setMeetingUrl(e.target.value)}
                placeholder="https://meet.google.com/..."
                className="w-full h-12 px-3 rounded-md bg-bg-elevated border border-border text-fg placeholder:text-fg-muted focus-ring" />
            </label>
          )}

          <div className="rounded-md border border-warning bg-warning/10 p-3 text-body-sm text-fg">
            ⚠️ A tarefa original será arquivada (vira compromisso). Sem cobrança duplicada.
          </div>

          {error && <p role="alert" className="text-body-sm text-danger">{error}</p>}

          <div className="flex items-center gap-md pt-2">
            <Button type="button" variant="secondary" onClick={onClose}>Cancelar</Button>
            <Button type="button" loading={convert.isPending} fullWidth onClick={() => { setError(null); convert.mutate(); }}>
              Criar compromisso
            </Button>
          </div>
        </div>
      )}
    </AdaptiveSheet>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `cd _remote/web && npx tsc --noEmit`
Expected: sem erros. Se `MODALITY_LABELS`/`EventModality` não existirem em `types.ts`, confirmar o import (são usados em `QuickCreateSheet.tsx`). Se `useEventCategories` não expuser `bySlug/byId/workCategories/personalCategories`, abrir `hooks/useEventCategories.ts` e ajustar (essas APIs são usadas no `QuickCreateSheet`).

---

## Task 6: `DelegateTaskSheet` (delegar tarefa)

Atualiza a tarefa (espelha o write do engine: `assigned_to`+`delegated_to`+`delegated_at`+`status='delegated'`) e dispara `notifyTaskDelegated`. Picker via `useDelegableMembers`. Prazo via `DateInput` (pré-preenchido). Recado opcional salvo em `description`.

**Files:**
- Create: `web/src/components/DelegateTaskSheet.tsx`

- [ ] **Step 1: Implementar o componente**

```tsx
// web/src/components/DelegateTaskSheet.tsx
// Delega uma tarefa existente a um membro da equipe. Client-side: UPDATE da task
// + notifyTaskDelegated (TOM manda WhatsApp). Picker restrito à equipe do líder.
import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import { AdaptiveSheet } from './AdaptiveSheet';
import { Button } from './Button';
import { CustomSelect } from './CustomSelect';
import { DateInput } from './DateInput';
import { useDelegableMembers } from '../hooks/useDelegableMembers';
import { notifyTaskDelegated } from '../lib/tomEngine';
import { showToast } from './Toast';
import type { Task } from '../types';

interface Props { open: boolean; task: Task | null; onClose: () => void; }

export function DelegateTaskSheet({ open, task, onClose }: Props) {
  const { collaborator } = useAuth();
  const qc = useQueryClient();
  const membersQ = useDelegableMembers(open);

  const [assignee, setAssignee] = useState('');
  const [due, setDue] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !task) return;
    setAssignee('');
    setDue(task.due_date || '');
    setNote(task.description ?? '');
    setError(null);
  }, [open, task?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const delegate = useMutation({
    mutationFn: async () => {
      if (!collaborator || !task) throw new Error('no_task');
      if (!assignee) throw new Error('Escolhe pra quem delegar.');
      if (assignee === collaborator.id) throw new Error('Não dá pra delegar pra você mesmo.');
      const { data, error: e } = await supabase.from('tasks').update({
        assigned_to: assignee,
        delegated_to: assignee,
        delegated_at: new Date().toISOString(),
        status: 'delegated',
        due_date: due || null,
        description: note.trim() || null,
      }).eq('id', task.id).select('id');
      if (e) throw e;
      if (!data || data.length === 0) {
        throw new Error('Você não tem permissão pra delegar essa tarefa.');
      }
      const r = await notifyTaskDelegated(task.id);
      return r;
    },
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['tasks'] });
      if (r.ok) showToast({ kind: 'success', title: 'Tarefa delegada', msg: 'TOM mandou WhatsApp pra pessoa.' });
      else showToast({ kind: 'error', title: 'Tarefa delegada', msg: `Salvou, mas WhatsApp falhou (${r.reason}).` });
      onClose();
    },
    onError: (e: Error) => setError(e.message),
  });

  const options = (membersQ.data ?? []).map(m => ({ value: m.id, label: m.full_name, sublabel: m.role }));

  return (
    <AdaptiveSheet open={open && Boolean(task)} onClose={onClose} title="Delegar tarefa" size="md">
      {task && (
        <div className="space-y-md">
          <div className="rounded-md border border-border bg-bg-elevated p-3 text-body-sm text-fg-muted">
            Tarefa: <span className="text-fg font-medium">{task.title}</span>
          </div>

          <div>
            <div className="text-label uppercase tracking-wide text-fg-muted mb-1.5">Delegar para · sua equipe</div>
            <CustomSelect
              value={assignee}
              placeholder={membersQ.isLoading ? 'Carregando…' : '— Escolher pessoa —'}
              onChange={setAssignee}
              options={options}
            />
            {!membersQ.isLoading && options.length === 0 && (
              <p className="text-body-sm text-fg-muted mt-1.5">Nenhum membro disponível na sua equipe.</p>
            )}
          </div>

          <div>
            <div className="text-label uppercase tracking-wide text-fg-muted mb-1.5">Prazo (opcional)</div>
            <DateInput value={due} onChange={setDue} />
          </div>

          <label className="block">
            <div className="text-label uppercase tracking-wide text-fg-muted mb-1.5">Recado (opcional)</div>
            <textarea rows={3} maxLength={500} value={note} onChange={e => setNote(e.target.value)}
              placeholder="Contexto pra pessoa que vai receber…"
              className="w-full px-3 py-2 rounded-md bg-bg-elevated border border-border text-fg placeholder:text-fg-muted focus-ring resize-y" />
            <p className="text-body-sm text-fg-muted mt-1">Some na tarefa da pessoa. TOM avisa pelo WhatsApp na hora.</p>
          </label>

          {error && <p role="alert" className="text-body-sm text-danger">{error}</p>}

          <div className="flex items-center gap-md pt-2">
            <Button type="button" variant="secondary" onClick={onClose}>Cancelar</Button>
            <Button type="button" loading={delegate.isPending} fullWidth
              disabled={!assignee}
              onClick={() => { setError(null); delegate.mutate(); }}>
              Delegar e avisar
            </Button>
          </div>
        </div>
      )}
    </AdaptiveSheet>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `cd _remote/web && npx tsc --noEmit`
Expected: sem erros. Confirmar que `CustomSelect` aceita `sublabel` nas options (é usado assim em `QuickCreateSheet.tsx`).

---

## Task 7: Props de transformação no `TaskRow`

**Files:**
- Modify: `web/src/components/TaskRow.tsx`

- [ ] **Step 1: Adicionar as props na interface `Props`**

Após `onDelete?: (task: Task) => void;` adicionar:

```ts
  /** Transformar em compromisso (abre ConvertToEventSheet no parent). */
  onTransformToEvent?: (task: Task) => void;
  /** Delegar a alguém (abre DelegateTaskSheet no parent). Só passar quando o user pode delegar a tarefa. */
  onDelegate?: (task: Task) => void;
```

- [ ] **Step 2: Receber as props no destructuring do componente**

Trocar:
```ts
  task, onToggle, readOnly, onEdit, onReschedule, onDelete,
  sortableRef, sortableStyle, sortableAttributes, sortableListeners, isDragging,
```
por:
```ts
  task, onToggle, readOnly, onEdit, onReschedule, onDelete, onTransformToEvent, onDelegate,
  sortableRef, sortableStyle, sortableAttributes, sortableListeners, isDragging,
```

- [ ] **Step 3: Adicionar os itens no bloco do RowMenu**

No IIFE que monta `items` (logo após `if (onReschedule) ...`), antes do `if (onDelete) ...`, inserir:

```ts
        if (onTransformToEvent) items.push({ label: '📆 Transformar em compromisso', onClick: () => onTransformToEvent(task) });
        if (onDelegate) items.push({ label: '👥 Delegar', onClick: () => onDelegate(task) });
```

E incluir as duas novas props na guarda de render do menu, trocando:
```ts
      {(onEdit || onReschedule || onDelete) && (() => {
```
por:
```ts
      {(onEdit || onReschedule || onDelete || onTransformToEvent || onDelegate) && (() => {
```

- [ ] **Step 4: Typecheck**

Run: `cd _remote/web && npx tsc --noEmit`
Expected: sem erros.

---

## Task 8: Seção "Transformar em" no `EditTaskSheet`

**Files:**
- Modify: `web/src/components/EditTaskSheet.tsx`

- [ ] **Step 1: Adicionar a prop `onTransform` na interface `Props`**

```ts
interface Props {
  open: boolean;
  task: Task | null;
  onClose: () => void;
  /** Abre o fluxo de transformação no parent (delegar / compromisso). */
  onTransform?: (task: Task, kind: 'event' | 'delegate') => void;
  /** Se o user pode delegar esta tarefa (controla o botão "Delegar"). */
  canDelegate?: boolean;
}
```

- [ ] **Step 2: Receber no destructuring**

Trocar `export function EditTaskSheet({ open, task, onClose }: Props) {` por:
```ts
export function EditTaskSheet({ open, task, onClose, onTransform, canDelegate }: Props) {
```

- [ ] **Step 3: Renderizar a seção antes do rodapé de botões**

Imediatamente ANTES do bloco `<div className="flex items-center gap-md pt-2">` (Cancelar/Salvar), inserir:

```tsx
          {onTransform && task.assigned_to === collaborator?.id
            && task.status !== 'done' && task.status !== 'cancelled' && task.status !== 'delegated' && (
            <div className="border-t border-border pt-3">
              <div className="text-label uppercase tracking-wide text-fg-muted mb-2">Transformar em</div>
              <div className="flex gap-2">
                <Button type="button" variant="secondary" onClick={() => onTransform(task, 'event')}>
                  📆 Compromisso
                </Button>
                {canDelegate && (
                  <Button type="button" variant="secondary" onClick={() => onTransform(task, 'delegate')}>
                    👥 Delegar
                  </Button>
                )}
              </div>
            </div>
          )}
```

- [ ] **Step 4: Typecheck**

Run: `cd _remote/web && npx tsc --noEmit`
Expected: sem erros.

---

## Task 9: Controller `useTaskTransform`

Centraliza o estado dos dois sheets e expõe handlers + o gate `canDelegate(task)`. Cada tela usa em ~3 linhas.

**Files:**
- Create: `web/src/hooks/useTaskTransform.tsx`

- [ ] **Step 1: Implementar o controller**

```tsx
// web/src/hooks/useTaskTransform.tsx
// Controller compartilhado pra transformar tarefas: hospeda DelegateTaskSheet e
// ConvertToEventSheet e expõe handlers + o gate canDelegate(task). Cada tela renderiza
// {sheets} uma vez e passa openDelegate/openConvert ao TaskRow e onTransform ao EditTaskSheet.
import { useState, useCallback } from 'react'; // useCallback usado em canDelegate/canConvert/onEditSheetTransform
import { useAuth } from '../contexts/AuthContext';
import { hasCoordLevel } from '../lib/permissions';
import { DelegateTaskSheet } from '../components/DelegateTaskSheet';
import { ConvertToEventSheet } from '../components/ConvertToEventSheet';
import type { Task } from '../types';

export function useTaskTransform() {
  const { collaborator } = useAuth();
  const [delegateTask, setDelegateTask] = useState<Task | null>(null);
  const [convertTask, setConvertTask] = useState<Task | null>(null);

  // canDelegate: tem nível de coord E pode editar a tarefa (própria/atribuída ou coord/director).
  const canDelegate = useCallback((t: Task): boolean => {
    if (!collaborator || !hasCoordLevel(collaborator)) return false;
    if (t.status === 'done' || t.status === 'cancelled' || t.status === 'delegated') return false;
    const mine = t.created_by === collaborator.id || t.assigned_to === collaborator.id;
    const coordOrDir = collaborator.role === 'coordinator' || collaborator.role === 'director';
    return mine || coordOrDir;
  }, [collaborator]);

  const canConvert = useCallback((t: Task): boolean => {
    if (!collaborator) return false;
    if (t.status === 'done' || t.status === 'cancelled' || t.status === 'delegated') return false;
    return t.assigned_to === collaborator.id;
  }, [collaborator]);

  const onEditSheetTransform = useCallback((t: Task, kind: 'event' | 'delegate') => {
    if (kind === 'delegate') setDelegateTask(t);
    else setConvertTask(t);
  }, []);

  const sheets = (
    <>
      <DelegateTaskSheet open={Boolean(delegateTask)} task={delegateTask} onClose={() => setDelegateTask(null)} />
      <ConvertToEventSheet open={Boolean(convertTask)} task={convertTask} onClose={() => setConvertTask(null)} />
    </>
  );

  return {
    sheets,
    openDelegate: setDelegateTask,
    openConvert: setConvertTask,
    canDelegate,
    canConvert,
    onEditSheetTransform,
    canDelegateAny: collaborator ? hasCoordLevel(collaborator) : false,
  };
}
```

> Nota: `openDelegate`/`openConvert` são os próprios setters (`setDelegateTask`/`setConvertTask`), assinatura `(task: Task) => void`, expostos no `return`. React aceita `setX(task)` direto — não precisa de wrapper.

- [ ] **Step 2: Typecheck**

Run: `cd _remote/web && npx tsc --noEmit`
Expected: sem erros.

---

## Task 10: Fiar nas telas (Hoje, Semana, AgendaDesktop)

Cada tela já tem estado de `editTask` e renderiza `<EditTaskSheet>` + `<RescheduleSheet>` e lista `<TaskRow>`. Adicionar o `useTaskTransform` e fiar.

**Files:**
- Modify: `web/src/screens/Hoje.tsx`
- Modify: `web/src/screens/Semana.tsx`
- Modify: `web/src/screens/AgendaDesktop.tsx`

- [ ] **Step 1: Em cada tela, instanciar o controller**

No corpo do componente da tela, perto dos outros hooks:
```tsx
const tt = useTaskTransform();
```
Import: `import { useTaskTransform } from '../hooks/useTaskTransform';`

- [ ] **Step 2: Passar handlers a cada `<TaskRow>`**

Em cada `<TaskRow ... />`, adicionar:
```tsx
  onTransformToEvent={tt.canConvert(task) ? tt.openConvert : undefined}
  onDelegate={tt.canDelegate(task) ? tt.openDelegate : undefined}
```
(usar o mesmo identificador `task` que o `.map` já fornece naquele ponto.)

- [ ] **Step 3: Passar `onTransform`/`canDelegate` ao `<EditTaskSheet>`**

No `<EditTaskSheet open={...} task={...} onClose={...} />` de cada tela, adicionar:
```tsx
  onTransform={tt.onEditSheetTransform}
  canDelegate={tt.canDelegateAny}
```

- [ ] **Step 4: Renderizar os sheets do controller**

Perto do final do JSX da tela (junto dos outros sheets), adicionar:
```tsx
{tt.sheets}
```

- [ ] **Step 5: Typecheck + build**

Run: `cd _remote/web && npx tsc --noEmit && npx vite build`
Expected: build sem erros.

> Se alguma tela usar `TaskListItem` em vez de `TaskRow` (ex.: variações de lista), aplicar o mesmo padrão de props ou deixar de fora do v1 (o `EditTaskSheet` cobre o fluxo via "Editar"). Documentar quais telas ficaram cobertas no PR/notas.

---

## Task 11 (opcional, baixo risco): incluir o recado no WhatsApp do TOM

Hoje `/internal/task-delegated` compõe `"📌 {criador} delegou: {título} (prazo …)"` sem o recado. Para o WhatsApp refletir o recado do mockup, incluir `task.description` na mensagem.

**Files:**
- Modify: `src/internal-api.js` (handler `/internal/task-delegated`, ~L668-749)

- [ ] **Step 1: Incluir `description` no SELECT e na mensagem**

No `.select(...)` da task, garantir `description`. Na montagem do `body`, após a linha do título, acrescentar (só se houver):
```js
    (task.description ? `\n\n💬 "${String(task.description).slice(0, 300)}"` : '') +
```

- [ ] **Step 2: Syntax check**

Run: `node --check src/internal-api.js`
Expected: sem erro.

> Isso é um ajuste na mensagem de um endpoint REACTIVE (permitido pelo guard). Não é infra nova. Se preferir manter v1 estritamente sem backend, pular esta task — o recado fica visível no app da pessoa de qualquer forma.

---

## Task 12: Verificação manual no Preview (desktop + mobile)

**Files:** nenhum (validação).

- [ ] **Step 1: Garantir build limpo**

Run: `cd _remote/web && npx tsc --noEmit && npx vite build`
Expected: sem erros.

- [ ] **Step 2: Validar no Preview (localhost:4173) — usar mcp Claude_Preview**

Checklist (testar em 1440px e 375px):
- Abrir "Hoje". Card de tarefa própria → menu ⋯ mostra "📆 Transformar em compromisso" e "👥 Delegar" (Delegar só se o user é coord/director/has_coord).
- Colaborador comum (sem coord) → NÃO vê "Delegar"; vê só "Compromisso".
- "Delegar" → abre o sheet; picker lista só a equipe; escolher pessoa + prazo + recado → "Delegar e avisar" → toast; a tarefa some da lista ativa e aparece em "Delegadas"; `status='delegated'`, `assigned_to` = pessoa.
- "Transformar em compromisso" → abre o sheet; escolher categoria/início/fim/modalidade → "Criar compromisso" → toast; a tarefa some (cancelled) e o evento aparece na agenda no dia escolhido. Modalidade presencial esconde "Link da reunião"; online/híbrido mostra.
- Dentro de "Editar tarefa" → seção "Transformar em" com os mesmos 2 botões; clicar abre os sheets corretos.

- [ ] **Step 3: Conferir no banco (MCP execute_sql)**

```sql
SELECT id, status, assigned_to, delegated_to, converted_to_event_id
FROM tasks ORDER BY updated_at DESC LIMIT 5;
```
Esperado: a delegada com `status='delegated'` + `delegated_to` setado; a convertida com `status='cancelled'` + `converted_to_event_id` preenchido.

- [ ] **Step 4: Registrar no `tom_known_issues` se algum bug surgir** (protocolo do CLAUDE.md).

---

## Notas de verificação (self-review do plano)

- **Cobertura da spec:** entrada dupla (Task 7 ⋯ + Task 8 editar) ✓; delegar com WhatsApp (Task 6) ✓; equipe restrita (Tasks 3-4) ✓; gate role/has_coord (Task 9 `hasCoordLevel`) ✓; tarefa→compromisso + arquivar (Task 5 + Task 1) ✓; DS desktop+mobile (`AdaptiveSheet`) ✓; sem RLS/serverless ✓.
- **Trade-off conhecido:** `notifyTaskDelegated` usa segredo exposto no bundle (dívida de dev aceita; sinalizar antes de produção). Recado no WhatsApp é Task 11 opcional.
- **Limitação v1:** delegar só tarefas que o user pode editar pela RLS (próprias/atribuídas, ou coord/director). `has_coord_permissions` puro delega só as próprias.
- **Risco:** se `useEventCategories`/`CustomSelect`/`DateTimeInput` tiverem APIs diferentes do assumido, ajustar no Step de typecheck (todos são usados hoje no `QuickCreateSheet`, então a API existe).
