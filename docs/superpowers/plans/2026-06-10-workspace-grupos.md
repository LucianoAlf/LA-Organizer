# Workspace de Grupos de Trabalho — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transformar a página de Grupos de trabalho no ambiente de trabalho do grupo (lista → workspace → edição de tarefa do pool), fiel ao mockup aprovado.

**Architecture:** PWA-only, zero migration, zero engine. Funções puras de bucketização em `lib/groupWorkspace.ts` (vitest), dados em `hooks/useGroupWorkspace.ts` (react-query sobre RLS existente), 3 telas novas em `screens/grupos/` reusando DS + mutations de `useWorkGroups`. Rota antiga vira redirect.

**Tech Stack:** React+TS+Vite+Tailwind (tokens DS), @tanstack/react-query, supabase-js (RLS `tasks_group_member_all`), vitest.

**Spec:** `docs/superpowers/specs/2026-06-10-workspace-grupos-design.md` · **Mockup canônico (UI fiel, exigência do Alf):** `docs/superpowers/specs/assets/2026-06-10-workspace-grupos-mockup.html`

**Regras do repo:** `_remote` NÃO é git repo (auto-deploy no Stop hook → sem steps de commit). Validação local: `cd _remote/web && npx tsc --noEmit && npx vite build`; testes `npx vitest run src/lib/groupWorkspace.test.ts`. Preview localhost:4173 (limpar SW caches).

**Fatos verificados (10/06):** FKs tasks→collaborators: `tasks_created_by_fkey`, `tasks_completed_by_fkey`, `tasks_assigned_to_fkey` (embeds EXIGEM o nome — senão PGRST200). Self-embed de tasks por constraint NÃO funciona (PGRST200) — nunca embedar pai. `ConfirmDialog` existe em `components/ConfirmDialog.tsx`. Rota atual: `mais/grupos-trabalho` (App.tsx, gated manager+) + item em `Mais.tsx:39` + item na SidebarV2 (arquivo MINIFICADO 1 linha — editar via PowerShell `.Replace`).

---

## File structure

| Arquivo | Papel |
|---|---|
| Create `web/src/lib/groupWorkspace.ts` | Funções puras: buckets por urgência, label de conclusão, pacote-do-mês, counts da lista. |
| Create `web/src/lib/groupWorkspace.test.ts` | Vitest das puras (TDD). |
| Create `web/src/hooks/useGroupWorkspace.ts` | Queries do pool/pacotes/overview + mutations (toggle anti-corrida, salvar, cancelar). |
| Create `web/src/screens/grupos/GroupTaskSheet.tsx` | Sheet de edição da tarefa do pool (CRUD novo). |
| Create `web/src/screens/grupos/GroupConfigPanel.tsx` | ⚙ config (membros/líder/desativar) — miolo da tela atual em BottomSheet. |
| Create `web/src/screens/grupos/GrupoWorkspace.tsx` | Workspace (mockup seção 2). |
| Create `web/src/screens/grupos/GruposLista.tsx` | Lista de grupos (mockup seção 1) + sheet "Novo grupo" (movido da tela atual). |
| Modify `web/src/components/QuickCreateSheet.tsx` | Props `defaultKind`/`defaultGroupId`. |
| Modify `web/src/App.tsx` | Rotas `/grupos`, `/grupos/:groupId`; `mais/grupos-trabalho` → redirect. |
| Modify `web/src/screens/Mais.tsx` | Item aponta pra `/grupos`, sem requireRoles. |
| Modify `web/src/design/shell/SidebarV2.tsx` | Item sobe pra PRINCIPAL (PowerShell .Replace). |
| Delete `web/src/screens/gestao/GruposTrabalho.tsx` | Absorvida por GruposLista + GroupConfigPanel. |

---

### Task 1: Funções puras + testes (TDD)

**Files:** Create `web/src/lib/groupWorkspace.ts` · Create `web/src/lib/groupWorkspace.test.ts`

- [ ] **1.1 Escrever os testes (falhando):**

```ts
// web/src/lib/groupWorkspace.test.ts
import { describe, it, expect } from 'vitest';
import { bucketizeGroupTasks, doneWhenLabel, packageInMonth, addDaysYmd, type PoolTask } from './groupWorkspace';

const t = (p: Partial<PoolTask>): PoolTask => ({
  id: Math.random().toString(36).slice(2), title: 'x', status: 'pending',
  due_date: null, due_time: null, completed_at: null, created_by: null,
  creator_name: null, completed_by_name: null, description: null, ...p,
});

describe('bucketizeGroupTasks (hoje=2026-06-10)', () => {
  const today = '2026-06-10';
  it('separa atrasada / vence em breve / mais pra frente / sem prazo / feitas', () => {
    const r = bucketizeGroupTasks([
      t({ id: 'a', due_date: '2026-06-08' }),                                  // atrasada
      t({ id: 'b', due_date: '2026-06-10' }),                                  // hoje → dueSoon
      t({ id: 'c', due_date: '2026-06-17' }),                                  // +7 → dueSoon (limite)
      t({ id: 'd', due_date: '2026-06-18' }),                                  // +8 → later
      t({ id: 'e', due_date: null }),                                          // sem prazo → later
      t({ id: 'f', status: 'done', completed_at: '2026-06-10T17:02:00Z' }),    // feita
    ], today);
    expect(r.overdue.map(x => x.id)).toEqual(['a']);
    expect(r.dueSoon.map(x => x.id)).toEqual(['b', 'c']);
    expect(r.later.map(x => x.id)).toEqual(['d', 'e']);
    expect(r.doneRecent.map(x => x.id)).toEqual(['f']);
  });
  it('doneRecent: desc por completed_at, máx 10', () => {
    const many = Array.from({ length: 12 }, (_, i) =>
      t({ id: `d${i}`, status: 'done', completed_at: `2026-06-0${(i % 9) + 1}T0${i % 10}:00:00Z` }));
    const r = bucketizeGroupTasks(many, '2026-06-10');
    expect(r.doneRecent.length).toBe(10);
    const ts = r.doneRecent.map(x => x.completed_at!);
    expect([...ts].sort().reverse()).toEqual(ts);
  });
  it('ordena abertas por due asc (sem prazo no fim de later)', () => {
    const r = bucketizeGroupTasks([
      t({ id: 'p', due_date: null }), t({ id: 'q', due_date: '2026-06-20' }),
    ], '2026-06-10');
    expect(r.later.map(x => x.id)).toEqual(['q', 'p']);
  });
});

describe('doneWhenLabel (BRT)', () => {
  const now = '2026-06-10T23:30:00.000Z'; // 20:30 BRT de 10/06
  it('hoje → "hoje HH:MM"', () => expect(doneWhenLabel('2026-06-10T17:02:00Z', now)).toBe('hoje 14:02'));
  it('ontem → "ontem"', () => expect(doneWhenLabel('2026-06-09T15:00:00Z', now)).toBe('ontem'));
  it('antes → DD/MM', () => expect(doneWhenLabel('2026-06-01T15:00:00Z', now)).toBe('01/06'));
});

describe('packageInMonth (ym=2026-06)', () => {
  const m = (p: Record<string, unknown>) => ({ status: 'pending', due_date: null, ...p });
  it('due no mês entra (aberto ou done)', () => {
    expect(packageInMonth(m({ due_date: '2026-06-01', status: 'done' }), '2026-06')).toBe(true);
  });
  it('aberto atrasado de mês anterior entra', () => {
    expect(packageInMonth(m({ due_date: '2026-05-15' }), '2026-06')).toBe(true);
  });
  it('done de mês anterior fica fora; ciclo futuro fica fora', () => {
    expect(packageInMonth(m({ due_date: '2026-05-01', status: 'done' }), '2026-06')).toBe(false);
    expect(packageInMonth(m({ due_date: '2026-07-01' }), '2026-06')).toBe(false);
  });
  it('sem prazo aberto entra', () => expect(packageInMonth(m({}), '2026-06')).toBe(true));
});

describe('addDaysYmd', () => {
  it('soma atravessando o mês', () => expect(addDaysYmd('2026-06-28', 7)).toBe('2026-07-05'));
});
```

- [ ] **1.2 Rodar e ver falhar:** `cd _remote/web && npx vitest run src/lib/groupWorkspace.test.ts` → FAIL (módulo não existe).

- [ ] **1.3 Implementar:**

```ts
// web/src/lib/groupWorkspace.ts
// Workspace de grupos (spec 2026-06-10) — funções PURAS (testáveis sem DB).
// Buckets por urgência espelham o mockup aprovado: Atrasadas → Vence em breve
// (hoje..+7d) → Mais pra frente/sem prazo → Feitas recentemente (mês, máx 10).

export interface PoolTask {
  id: string; title: string; description: string | null;
  status: string; due_date: string | null; due_time: string | null;
  completed_at: string | null; created_by: string | null;
  creator_name: string | null; completed_by_name: string | null;
}

export interface PoolBuckets {
  overdue: PoolTask[]; dueSoon: PoolTask[]; later: PoolTask[]; doneRecent: PoolTask[];
}

export function addDaysYmd(ymd: string, n: number): string {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

const byDueAsc = (a: PoolTask, b: PoolTask) =>
  (a.due_date ?? '9999').localeCompare(b.due_date ?? '9999');

export function bucketizeGroupTasks(tasks: PoolTask[], todayYmd: string): PoolBuckets {
  const horizon = addDaysYmd(todayYmd, 7);
  const open = tasks.filter(t => t.status !== 'done' && t.status !== 'cancelled');
  const done = tasks.filter(t => t.status === 'done');
  return {
    overdue: open.filter(t => t.due_date && t.due_date < todayYmd).sort(byDueAsc),
    dueSoon: open.filter(t => t.due_date && t.due_date >= todayYmd && t.due_date <= horizon).sort(byDueAsc),
    later: open.filter(t => !t.due_date || t.due_date > horizon).sort(byDueAsc),
    doneRecent: done
      .sort((a, b) => (b.completed_at ?? '').localeCompare(a.completed_at ?? ''))
      .slice(0, 10),
  };
}

const SP = 'America/Sao_Paulo';
function ymdSP(iso: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: SP, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
}

/** "hoje 14:02" / "ontem" / "01/06" — sempre em BRT. */
export function doneWhenLabel(completedAtIso: string, nowIso: string): string {
  const d = ymdSP(completedAtIso);
  const today = ymdSP(nowIso);
  if (d === today) {
    const hm = new Intl.DateTimeFormat('pt-BR', { timeZone: SP, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(completedAtIso));
    return `hoje ${hm}`;
  }
  if (d === addDaysYmd(today, -1)) return 'ontem';
  return `${d.slice(8, 10)}/${d.slice(5, 7)}`;
}

/** Pacote (mãe is_group do pool) pertence ao painel do mês corrente? */
export function packageInMonth(m: { status: string; due_date: string | null }, ym: string): boolean {
  if (m.status === 'cancelled') return false;
  if (m.due_date && m.due_date.slice(0, 7) === ym) return true;            // ciclo do mês (aberto ou feito)
  if (m.status !== 'done' && (!m.due_date || m.due_date.slice(0, 7) < ym)) return true; // atrasado/sem prazo
  return false;
}
```

- [ ] **1.4 Rodar e ver passar:** `npx vitest run src/lib/groupWorkspace.test.ts` → todos PASS.

### Task 2: Hook de dados `useGroupWorkspace` + `useGroupsOverview`

**Files:** Create `web/src/hooks/useGroupWorkspace.ts`

- [ ] **2.1 Implementar** (embeds usam os NOMES DE CONSTRAINT verificados; nunca embedar o pai de tasks):

```ts
// web/src/hooks/useGroupWorkspace.ts
// Dados do workspace (spec 2026-06-10). Zero migration — RLS tasks_group_member_all
// (membro: ALL) + leituras de gestão já cobrem. FK explícita nos embeds (tasks tem
// 5 FKs pra collaborators → sem nome dá PGRST200).
import { useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { todaySP } from '../utils/date';
import { GROUP_SELECT_FOR_WORKSPACE, bucketizeGroupTasks, packageInMonth, type PoolTask } from '../lib/groupWorkspace';
import type { Task } from '../types';

const POOL_SELECT =
  'id, title, description, status, due_date, due_time, completed_at, created_by, ' +
  'creator:collaborators!tasks_created_by_fkey(full_name), ' +
  'done_by:collaborators!tasks_completed_by_fkey(full_name), ' +
  'task_reminders(id, remind_at, sent_at)';

export interface PoolTaskRow extends PoolTask {
  task_reminders?: Array<{ id: string; remind_at: string; sent_at: string | null }>;
}

function monthStartUtcIso(todayYmd: string): string {
  return `${todayYmd.slice(0, 7)}-01T03:00:00.000Z`; // 00:00 BRT do dia 1
}

async function fetchPool(groupId: string, todayYmd: string): Promise<PoolTaskRow[]> {
  const { data, error } = await supabase
    .from('tasks')
    .select(POOL_SELECT)
    .eq('assigned_group_id', groupId)
    .eq('is_group', false)
    .is('parent_task_id', null)
    .neq('status', 'cancelled')
    .eq('data_classification', 'real')
    .or(`status.neq.done,and(status.eq.done,completed_at.gte.${monthStartUtcIso(todayYmd)})`)
    .order('due_date', { ascending: true });
  if (error) throw error;
  return ((data ?? []) as any[]).map(r => ({
    ...r,
    creator_name: r.creator?.full_name ?? null,
    completed_by_name: r.done_by?.full_name ?? null,
  }));
}

// Pacotes: mães is_group do grupo com filhas — mesmo shape do taskGroups.GROUP_SELECT.
const PKG_SELECT =
  'id, title, status, context, due_date, due_time, is_group, recurrence_rule, recurrence_parent_id, ' +
  'sort_position, assigned_to, assigned_group_id, created_by, completed_at, created_at, ' +
  'subtasks:tasks!parent_task_id(id, title, status, due_date, due_time, sort_position, parent_task_id, recurrence_parent_id, completed_at, ' +
  'done_by:collaborators!tasks_completed_by_fkey(full_name))';

async function fetchPackages(groupId: string, todayYmd: string): Promise<Task[]> {
  const { data, error } = await supabase
    .from('tasks')
    .select(PKG_SELECT)
    .eq('assigned_group_id', groupId)
    .eq('is_group', true)
    .is('recurrence_rule', null) // esconde mãe-TEMPLATE (instância representa o ciclo)
    .neq('status', 'cancelled')
    .eq('data_classification', 'real');
  if (error) throw error;
  const ym = todayYmd.slice(0, 7);
  return ((data ?? []) as unknown as Task[])
    .filter(m => packageInMonth({ status: m.status, due_date: m.due_date }, ym))
    .map(m => ({ ...m, subtasks: [...(m.subtasks ?? [])].sort((a, b) => (a.sort_position ?? 0) - (b.sort_position ?? 0)) }));
}

export function useGroupWorkspace(groupId: string | undefined, collabId: string | undefined) {
  const qc = useQueryClient();
  const today = todaySP();

  const pool = useQuery({
    queryKey: ['group-workspace', groupId, today],
    enabled: Boolean(groupId),
    queryFn: () => fetchPool(groupId!, today),
  });
  const packages = useQuery({
    queryKey: ['group-workspace-pkgs', groupId, today],
    enabled: Boolean(groupId),
    queryFn: () => fetchPackages(groupId!, today),
  });

  const buckets = useMemo(() => bucketizeGroupTasks(pool.data ?? [], today), [pool.data, today]);
  const stats = useMemo(() => ({
    abertas: buckets.overdue.length + buckets.dueSoon.length + buckets.later.length,
    venceEmBreve: buckets.dueSoon.length,
    atrasadas: buckets.overdue.length,
    feitasNoMes: (pool.data ?? []).filter(t => t.status === 'done').length,
  }), [buckets, pool.data]);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['group-workspace'] });
    qc.invalidateQueries({ queryKey: ['group-workspace-pkgs'] });
    qc.invalidateQueries({ queryKey: ['groups-overview'] });
    qc.invalidateQueries({ queryKey: ['tasks'] });
    qc.invalidateQueries({ queryKey: ['task-groups'] });
  };

  // Concluir com ANTI-CORRIDA (padrão do engine): 0 rows = outra pessoa fechou antes.
  const toggleDone = useMutation({
    mutationFn: async ({ task, done }: { task: PoolTaskRow; done: boolean }) => {
      if (done) {
        const { data, error } = await supabase.from('tasks')
          .update({ status: 'done', completed_at: new Date().toISOString(), completed_by: collabId ?? null })
          .eq('id', task.id).neq('status', 'done').select('id');
        if (error) throw error;
        if (!data || data.length === 0) throw new Error('JA_CONCLUIDA');
      } else {
        const { error } = await supabase.from('tasks')
          .update({ status: 'pending', completed_at: null, completed_by: null })
          .eq('id', task.id);
        if (error) throw error;
      }
    },
    onSettled: invalidate,
  });

  // Salvar edição: prazo mudou → reminded_at=null (re-arma T-1 do grupo) +
  // task_reminders: remove não-enviados e insere os novos.
  const saveTask = useMutation({
    mutationFn: async (input: { id: string; title: string; description: string | null; due_date: string | null; due_time: string | null; reminderIsos: string[]; dueChanged: boolean }) => {
      const patch: Record<string, unknown> = {
        title: input.title.trim().slice(0, 200),
        description: input.description?.trim() || null,
        due_date: input.due_date, due_time: input.due_time,
      };
      if (input.dueChanged) patch.reminded_at = null;
      const { data, error } = await supabase.from('tasks').update(patch).eq('id', input.id).select('id');
      if (error) throw error;
      if (!data || data.length === 0) throw new Error('SEM_PERMISSAO'); // RLS barrou (não-membro) — nunca falhar mudo
      const { error: de } = await supabase.from('task_reminders').delete().eq('task_id', input.id).is('sent_at', null);
      if (de) throw de;
      if (input.reminderIsos.length > 0) {
        const { error: ie } = await supabase.from('task_reminders')
          .insert(input.reminderIsos.map(r => ({ task_id: input.id, remind_at: r })));
        if (ie) throw ie;
      }
    },
    onSuccess: invalidate,
  });

  const cancelTask = useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await supabase.from('tasks').update({ status: 'cancelled' }).eq('id', id).select('id');
      if (error) throw error;
      if (!data || data.length === 0) throw new Error('SEM_PERMISSAO');
    },
    onSuccess: invalidate,
  });

  return { pool, packages, buckets, stats, toggleDone, saveTask, cancelTask, invalidate };
}

// Lista /grupos: counts por grupo (1 query leve agregada em JS).
export interface GroupCounts { abertas: number; atrasadas: number; venceEmBreve: number; feitasNoMes: number; totalMes: number; }

export function useGroupsOverview(groupIds: string[]) {
  const today = todaySP();
  return useQuery({
    queryKey: ['groups-overview', groupIds.join(','), today],
    enabled: groupIds.length > 0,
    queryFn: async (): Promise<Record<string, GroupCounts>> => {
      const { data, error } = await supabase
        .from('tasks')
        .select('id, assigned_group_id, status, due_date, completed_at, is_group, parent_task_id')
        .in('assigned_group_id', groupIds)
        .eq('is_group', false)
        .is('parent_task_id', null)
        .neq('status', 'cancelled')
        .eq('data_classification', 'real');
      if (error) throw error;
      const monthStart = monthStartUtcIso(today);
      const out: Record<string, GroupCounts> = {};
      for (const gid of groupIds) out[gid] = { abertas: 0, atrasadas: 0, venceEmBreve: 0, feitasNoMes: 0, totalMes: 0 };
      for (const t of (data ?? []) as any[]) {
        const c = out[t.assigned_group_id]; if (!c) continue;
        if (t.status === 'done') { if ((t.completed_at ?? '') >= monthStart) c.feitasNoMes++; continue; }
        c.abertas++;
        if (t.due_date && t.due_date < today) c.atrasadas++;
        else if (t.due_date && t.due_date <= today.slice(0, 8) + String(Number(today.slice(8)) + 7).padStart(2, '0')) c.venceEmBreve++;
      }
      for (const gid of groupIds) out[gid].totalMes = out[gid].feitasNoMes + out[gid].abertas;
      return out;
    },
  });
}
```

**Nota:** o cálculo de `venceEmBreve` acima com aritmética de string quebra na virada de mês — substituir por `addDaysYmd(today, 7)` importado de `lib/groupWorkspace` (`t.due_date <= addDaysYmd(today, 7)`). Implementar JÁ com `addDaysYmd`.

- [ ] **2.2 Conferir tipos:** `npx tsc --noEmit` → 0 erros (remover import não-usado `GROUP_SELECT_FOR_WORKSPACE` se sobrar).

### Task 3: GroupTaskSheet (edição da tarefa do pool)

**Files:** Create `web/src/screens/grupos/GroupTaskSheet.tsx`

- [ ] **3.1 Implementar** (mockup seção 3 — AdaptiveSheet, DS puro; `readOnly` quando não-membro):

```tsx
// web/src/screens/grupos/GroupTaskSheet.tsx
// Edição de tarefa do POOL (spec 2026-06-10) — primeiro CRUD de task de grupo do app.
// readOnly: não-membro (gestor) visualiza sem salvar — nunca falhar em silêncio.
import { useEffect, useMemo, useState } from 'react';
import { AdaptiveSheet } from '../../components/AdaptiveSheet';
import { Button } from '../../components/Button';
import { Field } from '../../components/Field';
import { DateInput } from '../../components/DateInput';
import { TimeInput } from '../../components/TimeInput';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { showToast } from '../../components/Toast';
import type { PoolTaskRow } from '../../hooks/useGroupWorkspace';

const PRESETS = [
  { min: 0, label: 'Na hora' }, { min: 60, label: '1h antes' }, { min: 120, label: '2h antes' }, { min: 1440, label: '1 dia antes' },
] as const;

interface Props {
  open: boolean; task: PoolTaskRow | null; groupName: string; readOnly: boolean;
  onClose: () => void;
  onSave: (input: { id: string; title: string; description: string | null; due_date: string | null; due_time: string | null; reminderIsos: string[]; dueChanged: boolean }) => Promise<void>;
  onCancelTask: (id: string) => Promise<void>;
  onReopen?: (task: PoolTaskRow) => void;
}

export function GroupTaskSheet({ open, task, groupName, readOnly, onClose, onSave, onCancelTask, onReopen }: Props) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [due, setDue] = useState('');
  const [time, setTime] = useState('');
  const [mins, setMins] = useState<number[]>([]);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open && task) {
      setTitle(task.title); setDescription(task.description ?? '');
      setDue(task.due_date ?? ''); setTime(task.due_time ? task.due_time.slice(0, 5) : '');
      setMins([]); setConfirmCancel(false);
    }
  }, [open, task]);

  const pendingExisting = useMemo(() =>
    (task?.task_reminders ?? []).filter(r => !r.sent_at).length, [task]);

  if (!task) return null;
  const isDone = task.status === 'done';

  async function save() {
    if (!title.trim()) { showToast({ kind: 'error', title: 'Coloca um título.' }); return; }
    setSaving(true);
    try {
      // Lembretes: âncora = due + hora (ou 09:00), offset fixo -03:00 (padrão do projeto).
      const baseMs = due ? new Date(`${due}T${time || '09:00'}:00-03:00`).getTime() : null;
      const reminderIsos = baseMs ? mins.map(m => new Date(baseMs - m * 60000).toISOString()) : [];
      await onSave({
        id: task.id, title, description: description || null,
        due_date: due || null, due_time: time ? `${time}:00` : null,
        reminderIsos, dueChanged: (due || null) !== (task.due_date ?? null),
      });
      showToast({ kind: 'success', title: 'Tarefa do grupo atualizada' });
      onClose();
    } catch (e) {
      const m = e instanceof Error ? e.message : '';
      showToast({ kind: 'error', title: m === 'SEM_PERMISSAO' ? 'Só membros do grupo editam' : 'Não consegui salvar', msg: m === 'SEM_PERMISSAO' ? 'Entra no grupo pela ⚙ ou pede pra um membro.' : undefined });
    } finally { setSaving(false); }
  }

  return (
    <AdaptiveSheet open={open} onClose={onClose} title="Editar tarefa do grupo" size="sm">
      <div className="space-y-md">
        <p className="text-body-sm text-fg-muted">
          👥 {groupName} · criada por {task.creator_name ?? '—'}
          {isDone && task.completed_by_name ? ` · concluída por ${task.completed_by_name}` : readOnly ? ' · só membros editam' : ' · qualquer membro pode editar'}
        </p>
        <Field label="Título">
          <input value={title} disabled={readOnly} onChange={e => setTitle(e.target.value)} maxLength={200}
            className="w-full bg-bg-surface border border-border rounded-md p-2 text-fg focus:outline-none focus:border-tom disabled:opacity-60" />
        </Field>
        <Field label="Descrição" sub="opcional">
          <textarea value={description} disabled={readOnly} onChange={e => setDescription(e.target.value)} rows={3} maxLength={2000}
            className="w-full bg-bg-surface border border-border rounded-md p-2 text-fg focus:outline-none focus:border-tom resize-y disabled:opacity-60" />
        </Field>
        <div className="flex gap-sm">
          <Field label="Prazo"><DateInput value={due} onChange={readOnly ? () => {} : setDue} /></Field>
          <Field label="Hora" sub="opcional"><TimeInput value={time} onChange={readOnly ? () => {} : setTime} /></Field>
        </div>
        {!isDone && (
          <Field label="Lembretes" sub={`vão pra TODOS os membros${pendingExisting ? ` · ${pendingExisting} já agendado(s) — salvar substitui` : ''}`}>
            <div className="flex flex-wrap gap-xs">
              {PRESETS.map(p => {
                const on = mins.includes(p.min);
                return (
                  <button key={p.min} type="button" disabled={readOnly || !due}
                    onClick={() => setMins(prev => on ? prev.filter(m => m !== p.min) : [...prev, p.min])}
                    className={`h-8 px-sm rounded-sm border text-body-sm focus-ring ${on ? 'border-tom text-tom bg-tom/10' : 'border-border text-fg-muted'} disabled:opacity-50`}>
                    {p.label}
                  </button>
                );
              })}
            </div>
          </Field>
        )}
        <div className="flex items-center gap-sm pt-sm">
          {!readOnly && !isDone && (
            <Button variant="danger" size="sm" onClick={() => setConfirmCancel(true)}>Cancelar tarefa</Button>
          )}
          {!readOnly && isDone && onReopen && (
            <Button variant="secondary" size="sm" onClick={() => { onReopen(task); onClose(); }}>Reabrir</Button>
          )}
          <div className="ml-auto flex gap-sm">
            <Button variant="secondary" size="md" onClick={onClose}>Fechar</Button>
            {!readOnly && <Button variant="primary" size="md" loading={saving} onClick={save}>Salvar</Button>}
          </div>
        </div>
      </div>
      <ConfirmDialog
        open={confirmCancel}
        title="Cancelar esta tarefa do grupo?"
        message={`"${task.title}" sai do pool de todo mundo. Dá pra reverter depois pelo banco, mas ninguém mais vê.`}
        confirmLabel="Cancelar tarefa"
        onConfirm={async () => { await onCancelTask(task.id); setConfirmCancel(false); onClose(); showToast({ kind: 'success', title: 'Tarefa cancelada' }); }}
        onClose={() => setConfirmCancel(false)}
      />
    </AdaptiveSheet>
  );
}
```

**Nota:** conferir a API real de `ConfirmDialog` (props) antes de finalizar — ajustar nomes (`message`/`description`, `onConfirm`/`onClose`) ao que o componente expõe (ver uso em `components/TaskGroupSheet.tsx:287`).

- [ ] **3.2 tsc:** `npx tsc --noEmit` → 0 erros.

### Task 4: GrupoWorkspace (a página — fiel ao mockup seção 2)

**Files:** Create `web/src/screens/grupos/GrupoWorkspace.tsx` · Create `web/src/screens/grupos/GroupConfigPanel.tsx`

- [ ] **4.1 GroupConfigPanel** — miolo da GruposTrabalho atual, por grupo, em BottomSheet (reusa mutations de `useWorkGroups` sem mudança):

```tsx
// web/src/screens/grupos/GroupConfigPanel.tsx
// ⚙ do workspace — membros/líder/desativar (ex-GruposTrabalho.tsx, agora por grupo).
import { useState } from 'react';
import { Star, X, Plus, Users } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { useWorkGroups, type WorkGroup } from '../../hooks/useWorkGroups';
import { useCollabRoster } from '../../hooks/useNotes';
import { Button } from '../../components/Button';
import { Field } from '../../components/Field';
import { CustomSelect } from '../../components/CustomSelect';
import { BottomSheet } from '../../components/BottomSheet';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { showToast } from '../../components/Toast';

export function GroupConfigPanel({ open, group, onClose }: { open: boolean; group: WorkGroup; onClose: () => void }) {
  const { role } = useAuth();
  const navigate = useNavigate();
  const { addMember, removeMember, updateGroup, deactivateGroup, meuId } = useWorkGroups();
  const roster = useCollabRoster();
  const [addOpen, setAddOpen] = useState(false);
  const [confirmOff, setConfirmOff] = useState(false);
  const podeEditar = role === 'director' || group.leader_id === meuId;

  return (
    <BottomSheet open={open} onClose={onClose} title={`Configurações — ${group.name}`}>
      <div className="space-y-md">
        <div className="flex flex-wrap items-center gap-sm">
          {group.members.map(m => {
            const isLeader = m.collaborator_id === group.leader_id;
            return (
              <span key={m.collaborator_id} className={`inline-flex items-center gap-xs rounded-sm border px-sm py-xs text-body-sm ${isLeader ? 'bg-tom text-black border-tom' : 'bg-bg-elevated text-fg border-border'}`}>
                {isLeader && <Star size={12} />}{m.full_name.split(' ')[0]}
                {podeEditar && !isLeader && (
                  <button onClick={() => removeMember.mutate({ groupId: group.id, collaboratorId: m.collaborator_id })}
                    className="focus-ring rounded-sm" aria-label={`Remover ${m.full_name}`}><X size={12} /></button>
                )}
              </span>
            );
          })}
          {podeEditar && (
            <Button variant="ghost" size="sm" leadingIcon={<Plus size={14} />} onClick={() => setAddOpen(true)}>membro</Button>
          )}
        </div>
        <p className="text-body-sm text-fg-muted inline-flex items-center gap-xs">
          <Users size={12} /> ★ líder recebe as escalações · lembretes vão pra todos
        </p>
        {podeEditar && role === 'director' && (
          <Field label="Líder" sub="Recebe as escalações de tarefa travada">
            <CustomSelect value={group.leader_id}
              options={group.members.map(m => ({ value: m.collaborator_id, label: m.full_name }))}
              onChange={v => updateGroup.mutate({ id: group.id, leaderId: String(v) })} size="sm" />
          </Field>
        )}
        {podeEditar && (
          <div className="flex justify-end">
            <Button variant="ghost" size="sm" onClick={() => setConfirmOff(true)}>
              <span className="text-danger">desativar grupo</span>
            </Button>
          </div>
        )}
      </div>
      <BottomSheet open={addOpen} onClose={() => setAddOpen(false)} title={`Adicionar membro — ${group.name}`}>
        <div className="space-y-xs max-h-80 overflow-y-auto">
          {(roster.data ?? [])
            .filter(c => !group.members.some(m => m.collaborator_id === c.id))
            .map(c => (
              <button key={c.id}
                onClick={async () => { await addMember.mutateAsync({ groupId: group.id, collaboratorId: c.id }); setAddOpen(false); }}
                className="w-full text-left p-sm rounded-sm focus-ring hover:bg-bg-elevated text-body-md">{c.full_name}</button>
            ))}
        </div>
      </BottomSheet>
      <ConfirmDialog open={confirmOff} title={`Desativar "${group.name}"?`}
        message="O grupo some das listas (tarefas abertas bloqueiam a desativação)."
        confirmLabel="Desativar"
        onConfirm={async () => {
          try { await deactivateGroup.mutateAsync(group.id); showToast({ kind: 'success', title: 'Grupo desativado' }); navigate('/grupos'); }
          catch (e) { showToast({ kind: 'error', title: 'Não deu pra desativar', msg: e instanceof Error ? e.message : undefined }); }
          finally { setConfirmOff(false); }
        }}
        onClose={() => setConfirmOff(false)} />
    </BottomSheet>
  );
}
```

- [ ] **4.2 GrupoWorkspace** — header + stats + seções (cada uma oculta quando vazia) + sheets:

```tsx
// web/src/screens/grupos/GrupoWorkspace.tsx
// O "escritório" do grupo (spec/mockup 2026-06-10 — UI FIEL ao mockup aprovado).
import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Settings } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useWorkGroups, useMyGroupIds } from '../../hooks/useWorkGroups';
import { useGroupWorkspace, type PoolTaskRow } from '../../hooks/useGroupWorkspace';
import { doneWhenLabel } from '../../lib/groupWorkspace';
import { toggleChildWithCascade } from '../../lib/taskGroups';
import { Badge } from '../../components/Badge';
import { Button } from '../../components/Button';
import { Fab } from '../../components/Fab';
import { StatCard } from '../../components/StatCard';
import { LoadingState } from '../../components/LoadingState';
import { EmptyState } from '../../components/EmptyState';
import { TaskCheckbox } from '../../components/TaskCheckbox';
import { QuickCreateSheet } from '../../components/QuickCreateSheet';
import { TaskGroupSheet } from '../../components/TaskGroupSheet';
import { showToast } from '../../components/Toast';
import { GroupTaskSheet } from './GroupTaskSheet';
import { GroupConfigPanel } from './GroupConfigPanel';
import { brShort } from '../../utils/date';
import type { Task } from '../../types';

function dueBadge(due: string | null, todayYmd: string): { text: string; tone: 'danger' | 'warning' | 'neutral' } | null {
  if (!due) return null;
  if (due < todayYmd) {
    const days = Math.round((new Date(todayYmd).getTime() - new Date(due).getTime()) / 86400000);
    return { text: `${days}d atrasada`, tone: 'danger' };
  }
  if (due === todayYmd) return { text: 'hoje', tone: 'warning' };
  return { text: brShort(due), tone: 'warning' };
}

export function GrupoWorkspace() {
  const { groupId } = useParams<{ groupId: string }>();
  const navigate = useNavigate();
  const { collaborator, role } = useAuth();
  const { list, meuId } = useWorkGroups();
  const myIds = useMyGroupIds();
  const ws = useGroupWorkspace(groupId, collaborator?.id);

  const [createOpen, setCreateOpen] = useState(false);
  const [createKind, setCreateKind] = useState<'task' | 'group'>('task');
  const [configOpen, setConfigOpen] = useState(false);
  const [editing, setEditing] = useState<PoolTaskRow | null>(null);
  const [openPkgId, setOpenPkgId] = useState<string | null>(null);

  const group = (list.data ?? []).find(g => g.id === groupId);
  const isMember = (myIds.data ?? []).includes(groupId ?? '');
  const canManage = role === 'director' || role === 'coordinator' || role === 'manager' || group?.leader_id === meuId;
  const todayYmd = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });

  const members = useMemo(() => {
    if (!group) return '';
    const names = group.members.map(m => `${m.collaborator_id === group.leader_id ? '★ ' : ''}${m.full_name.split(' ')[0]}`);
    return names.join(' · ');
  }, [group]);

  if (list.isLoading || ws.pool.isLoading) return <LoadingState />;
  if (!group) return <EmptyState title="Grupo não encontrado" subtitle="Ele pode ter sido desativado." />;
  if (!isMember && !canManage) return <EmptyState title="Você não está neste grupo" subtitle="Pede pro líder te adicionar." />;

  async function onToggle(task: PoolTaskRow, done: boolean) {
    try { await ws.toggleDone.mutateAsync({ task, done }); }
    catch (e) {
      if (e instanceof Error && e.message === 'JA_CONCLUIDA') showToast({ kind: 'info', title: '✋ Já concluída por outra pessoa', msg: 'Atualizei a lista.' });
      else showToast({ kind: 'error', title: 'Não consegui atualizar' });
    }
  }

  const Section = ({ label, danger, children }: { label: string; danger?: boolean; children: React.ReactNode }) => (
    <section className="space-y-xs">
      <h3 className={`text-label uppercase tracking-wide ${danger ? 'text-danger' : 'text-fg-muted'}`}>{label}</h3>
      {children}
    </section>
  );

  const Row = ({ t }: { t: PoolTaskRow }) => {
    const badge = dueBadge(t.due_date, todayYmd);
    const isDone = t.status === 'done';
    return (
      <div className="flex items-center gap-sm px-md py-sm border-b border-border last:border-b-0">
        <TaskCheckbox done={isDone} overdue={!isDone && !!t.due_date && t.due_date < todayYmd} size="sm" onClick={() => onToggle(t, !isDone)} />
        <button type="button" onClick={() => setEditing(t)} className={`flex-1 min-w-0 text-left text-body-md truncate focus-ring rounded-sm ${isDone ? 'line-through text-fg-muted' : 'text-fg'}`}>
          {t.title}
        </button>
        {isDone && t.completed_at
          ? <Badge tone="success">por {t.completed_by_name?.split(' ')[0] ?? '—'} · {doneWhenLabel(t.completed_at, new Date().toISOString())}</Badge>
          : badge && <Badge tone={badge.tone === 'danger' ? 'danger' : 'warning'}>{badge.text}</Badge>}
        {!isDone && t.creator_name && <span className="text-body-sm text-fg-muted shrink-0 max-md:hidden">por {t.creator_name.split(' ')[0]}</span>}
      </div>
    );
  };

  const Pkg = ({ m }: { m: Task }) => {
    const kids = m.subtasks ?? [];
    const total = kids.filter(k => k.status !== 'cancelled').length;
    const done = kids.filter(k => k.status === 'done').length;
    const pct = total ? Math.round((done / total) * 100) : 0;
    return (
      <div className="surface rounded-md border border-border p-md space-y-sm">
        <button type="button" onClick={() => setOpenPkgId(m.id)} className="w-full text-left focus-ring rounded-sm">
          <div className="flex items-center gap-sm">
            <span className="text-body-lg font-semibold flex-1 min-w-0 truncate">{m.title}</span>
            {m.recurrence_parent_id && <Badge tone="neutral">mensal</Badge>}
            <span className="text-body-sm text-fg-muted tabular-nums">{done}/{total}</span>
          </div>
          <div className="mt-sm h-1 w-full bg-bg-subtle rounded-full overflow-hidden"><div className="h-full bg-tom" style={{ width: `${pct}%` }} /></div>
        </button>
        {kids.filter(k => k.status !== 'cancelled').map(k => (
          <div key={k.id} className="flex items-center gap-sm py-xs">
            <TaskCheckbox done={k.status === 'done'} size="sm"
              onClick={async () => { await toggleChildWithCascade(k, k.status !== 'done'); ws.invalidate(); }} />
            <span className={`text-body-md flex-1 min-w-0 truncate ${k.status === 'done' ? 'line-through text-fg-muted' : ''}`}>{k.title}</span>
            <span className="text-body-sm text-fg-muted shrink-0">
              {k.due_date ? `dia ${Number(k.due_date.slice(8, 10))}` : ''}
              {k.status === 'done' && (k as any).done_by?.full_name ? ` · por ${(k as any).done_by.full_name.split(' ')[0]}` : ''}
            </span>
          </div>
        ))}
      </div>
    );
  };

  const b = ws.buckets;
  return (
    <div className="space-y-lg max-w-content mx-auto w-full pb-2xl">
      <header className="flex items-start justify-between gap-md">
        <div className="min-w-0">
          <button type="button" onClick={() => navigate('/grupos')} className="text-body-sm text-fg-muted hover:text-fg focus-ring rounded-sm">‹ Grupos</button>
          <h2 className="text-screen-title">👥 {group.name}</h2>
          <p className="text-body-sm text-fg-muted mt-xs">{members} — qualquer um conclui</p>
        </div>
        <div className="flex items-center gap-sm shrink-0 max-md:hidden">
          <Button variant="secondary" size="md" onClick={() => { setCreateKind('group'); setCreateOpen(true); }}>🗂️ + Pacote mensal</Button>
          <Button variant="primary" size="md" onClick={() => { setCreateKind('task'); setCreateOpen(true); }}>+ Nova tarefa</Button>
          {canManage && <Button variant="ghost" size="md" onClick={() => setConfigOpen(true)} aria-label="Configurações"><Settings size={18} /></Button>}
        </div>
        {canManage && (
          <Button variant="ghost" size="sm" className="md:hidden" onClick={() => setConfigOpen(true)} aria-label="Configurações"><Settings size={16} /></Button>
        )}
      </header>

      <div className="flex gap-sm">
        <StatCard label="Abertas" value={ws.stats.abertas} tone="neutral" className="flex-1" />
        <StatCard label="Vence em breve" value={ws.stats.venceEmBreve} tone={ws.stats.venceEmBreve > 0 ? 'warning' : 'neutral'} className="flex-1" />
        <StatCard label="Atrasadas" value={ws.stats.atrasadas} tone={ws.stats.atrasadas > 0 ? 'danger' : 'neutral'} className="flex-1" />
        <StatCard label="Feitas no mês" value={ws.stats.feitasNoMes} tone={ws.stats.feitasNoMes > 0 ? 'success' : 'neutral'} className="flex-1" />
      </div>

      {b.overdue.length > 0 && (
        <Section label="🔴 Atrasadas" danger>
          <div className="surface rounded-md border border-danger/35 overflow-hidden">{b.overdue.map(t => <Row key={t.id} t={t} />)}</div>
        </Section>
      )}
      {b.dueSoon.length > 0 && (
        <Section label="⏰ Vence em breve">
          <div className="surface rounded-md border border-border overflow-hidden">{b.dueSoon.map(t => <Row key={t.id} t={t} />)}</div>
        </Section>
      )}
      {(ws.packages.data ?? []).length > 0 && (
        <Section label="🗂️ Pacotes do mês">
          <div className="space-y-sm">{(ws.packages.data ?? []).map(m => <Pkg key={m.id} m={m} />)}</div>
        </Section>
      )}
      {b.later.length > 0 && (
        <Section label="📅 Mais pra frente · sem prazo">
          <div className="surface rounded-md border border-border overflow-hidden">{b.later.map(t => <Row key={t.id} t={t} />)}</div>
        </Section>
      )}
      {b.doneRecent.length > 0 && (
        <Section label="✅ Feitas recentemente">
          <div className="surface rounded-md border border-border overflow-hidden opacity-85">{b.doneRecent.map(t => <Row key={t.id} t={t} />)}</div>
        </Section>
      )}
      {ws.stats.abertas === 0 && ws.stats.feitasNoMes === 0 && (ws.packages.data ?? []).length === 0 && (
        <EmptyState title="Pool vazio" subtitle={'Cria a primeira com "+ Nova tarefa" — ou manda no WhatsApp: "TOM, cria uma tarefa pro ' + group.name.toLowerCase() + '".'} />
      )}

      <div className="md:hidden"><Fab onClick={() => { setCreateKind('task'); setCreateOpen(true); }} label="Novo" ariaLabel="Criar no grupo" /></div>

      <QuickCreateSheet open={createOpen} onClose={() => { setCreateOpen(false); ws.invalidate(); }} defaultKind={createKind} defaultGroupId={group.id} />
      <GroupTaskSheet open={Boolean(editing)} task={editing} groupName={group.name} readOnly={!isMember}
        onClose={() => setEditing(null)}
        onSave={i => ws.saveTask.mutateAsync(i)}
        onCancelTask={id => ws.cancelTask.mutateAsync(id)}
        onReopen={t => onToggle(t, false)} />
      <TaskGroupSheet open={Boolean(openPkgId)} groupId={openPkgId} onClose={() => { setOpenPkgId(null); ws.invalidate(); }} onEditChild={() => {}} />
      {canManage && <GroupConfigPanel open={configOpen} group={group} onClose={() => setConfigOpen(false)} />}
    </div>
  );
}
```

**Notas de fidelidade ao mockup:** seções com `text-label` muted (danger na de atrasadas), surfaces `rounded-md border`, badges via `Badge` (success/warning/danger/neutral), barra de progresso `bg-tom` h-1, "por Fulana · hoje 14:02" no Badge success, stats via `StatCard`. Conferir API real de `StatCard` (`tone` aceita 'warning'? ver components/StatCard.tsx — se não tiver, usar 'neutral' e cor pelo valor como nos panels da agenda) e de `TaskGroupSheet` (props `groupId`/`onEditChild` — espelhar uso em Hoje.tsx). Ajustar sem inventar prop.

- [ ] **4.3 tsc:** `npx tsc --noEmit` → 0 erros.

### Task 5: GruposLista + auto-skip

**Files:** Create `web/src/screens/grupos/GruposLista.tsx`

- [ ] **5.1 Implementar** (mockup seção 1; sheet "Novo grupo" movido da tela antiga, igual):

```tsx
// web/src/screens/grupos/GruposLista.tsx
// Lista de grupos (spec/mockup 2026-06-10). Membro vê os seus; gestão vê todos.
// 1 grupo só e sem gestão → entra direto no workspace.
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { useWorkGroups, useMyGroupIds, type WorkGroup } from '../../hooks/useWorkGroups';
import { useGroupsOverview } from '../../hooks/useGroupWorkspace';
import { useCollabRoster } from '../../hooks/useNotes';
import { Badge } from '../../components/Badge';
import { Button } from '../../components/Button';
import { Field } from '../../components/Field';
import { CustomSelect } from '../../components/CustomSelect';
import { BottomSheet } from '../../components/BottomSheet';
import { LoadingState } from '../../components/LoadingState';
import { showToast } from '../../components/Toast';

export function GruposLista() {
  const navigate = useNavigate();
  const { collaborator, role } = useAuth();
  const { list, createGroup, meuId } = useWorkGroups();
  const myIds = useMyGroupIds();
  const roster = useCollabRoster();
  const canManage = role === 'director' || role === 'coordinator' || role === 'manager';

  const visible = useMemo(() => {
    const all = list.data ?? [];
    if (canManage) return all;
    const mine = new Set(myIds.data ?? []);
    return all.filter(g => mine.has(g.id) || g.leader_id === meuId);
  }, [list.data, myIds.data, canManage, meuId]);

  const counts = useGroupsOverview(visible.map(g => g.id));

  // Atalho: 1 grupo e sem gestão → direto no workspace.
  useEffect(() => {
    if (!canManage && !list.isLoading && !myIds.isLoading && visible.length === 1) {
      navigate(`/grupos/${visible[0].id}`, { replace: true });
    }
  }, [canManage, list.isLoading, myIds.isLoading, visible, navigate]);

  const [novoOpen, setNovoOpen] = useState(false);
  const [nome, setNome] = useState('');
  const [lider, setLider] = useState<string>(collaborator?.id ?? '');
  const [membros, setMembros] = useState<string[]>([]);
  const rosterOpts = (roster.data ?? []).map(c => ({ value: c.id, label: c.full_name }));

  async function criar() {
    if (!nome.trim() || !lider) return;
    try {
      const gid = await createGroup.mutateAsync({ name: nome, leaderId: lider, memberIds: membros });
      showToast({ kind: 'success', title: `Grupo "${nome.trim()}" criado` });
      setNovoOpen(false); setNome(''); setMembros([]);
      navigate(`/grupos/${gid}`);
    } catch (e) {
      showToast({ kind: 'error', title: 'Não consegui criar o grupo', msg: e instanceof Error ? e.message : undefined });
    }
  }

  if (list.isLoading) return <LoadingState />;

  return (
    <div className="space-y-lg max-w-content mx-auto w-full pb-2xl">
      <header className="flex items-end justify-between gap-md">
        <div>
          <h2 className="text-section-title">👥 Grupos de trabalho</h2>
          <p className="text-body-sm text-fg-muted mt-xs">O ambiente da equipe: todo membro vê e qualquer um conclui. "TOM, cria tarefa pro financeiro" também funciona.</p>
        </div>
        {canManage && (
          <Button variant="primary" size="md" onClick={() => { setLider(collaborator?.id ?? ''); setNovoOpen(true); }}>+ Novo grupo</Button>
        )}
      </header>

      {visible.length === 0 ? (
        <div className="surface p-lg rounded-md text-center text-body-md text-fg-muted">
          {canManage ? <>Nenhum grupo ainda. Cria o primeiro — ex.: <em>Financeiro</em>.</> : 'Você ainda não está em nenhum grupo. Pede pro seu líder te adicionar.'}
        </div>
      ) : (
        <ul className="space-y-sm">
          {visible.map((g: WorkGroup) => {
            const c = counts.data?.[g.id];
            const pct = c && c.totalMes > 0 ? Math.round((c.feitasNoMes / c.totalMes) * 100) : 0;
            return (
              <li key={g.id}>
                <button type="button" onClick={() => navigate(`/grupos/${g.id}`)}
                  className="surface w-full text-left p-md rounded-md border border-border flex items-center gap-md focus-ring hover:bg-bg-elevated transition-colors">
                  <div className="flex-1 min-w-0">
                    <div className="text-card-title truncate">{g.name}</div>
                    <div className="text-body-sm text-fg-muted truncate">
                      {g.members.map(m => `${m.collaborator_id === g.leader_id ? '★ ' : ''}${m.full_name.split(' ')[0]}`).join(' · ')}
                    </div>
                  </div>
                  {c && c.totalMes > 0 && (
                    <div className="w-32 shrink-0 max-md:hidden">
                      <div className="text-body-sm text-fg-muted text-right mb-xs">{c.feitasNoMes} de {c.totalMes} no mês</div>
                      <div className="h-1 bg-bg-subtle rounded-full overflow-hidden"><div className="h-full bg-tom" style={{ width: `${pct}%` }} /></div>
                    </div>
                  )}
                  {c && c.atrasadas > 0 && <Badge tone="danger">{c.atrasadas} atrasada{c.atrasadas > 1 ? 's' : ''}</Badge>}
                  {c && c.atrasadas === 0 && c.venceEmBreve > 0 && <Badge tone="warning">{c.venceEmBreve} vence em breve</Badge>}
                  <span className="text-fg-muted" aria-hidden>→</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <BottomSheet open={novoOpen} onClose={() => setNovoOpen(false)} title="Novo grupo de trabalho">
        <div className="space-y-md">
          <Field label="Nome do grupo">
            <input value={nome} onChange={e => setNome(e.target.value)} placeholder="ex.: Financeiro"
              className="w-full bg-bg-surface border border-border rounded-md p-2 text-fg focus:outline-none focus:border-tom" />
          </Field>
          <Field label="Líder" sub="Recebe as escalações (e já entra como membro)">
            <CustomSelect value={lider} options={rosterOpts} onChange={v => setLider(String(v))} />
          </Field>
          <Field label="Membros">
            <div className="space-y-xs max-h-80 overflow-y-auto">
              {(roster.data ?? []).filter(c => c.id !== lider).map(c => {
                const on = membros.includes(c.id);
                return (
                  <button key={c.id} onClick={() => setMembros(prev => on ? prev.filter(x => x !== c.id) : [...prev, c.id])}
                    className={`w-full text-left flex items-center justify-between p-sm rounded-sm focus-ring ${on ? 'bg-bg-elevated' : ''}`}>
                    <span className="text-body-md">{c.full_name}</span>
                    {on && <Badge tone="success">membro</Badge>}
                  </button>
                );
              })}
            </div>
          </Field>
          <Button variant="primary" size="md" fullWidth loading={createGroup.isPending} disabled={!nome.trim() || !lider} onClick={criar}>Criar grupo</Button>
        </div>
      </BottomSheet>
    </div>
  );
}
```

- [ ] **5.2 tsc:** `npx tsc --noEmit` → 0 erros (atenção: `createGroup.mutateAsync` retorna `gid` string — já é assim no hook).

### Task 6: Rotas, sidebar, Mais, e remoção da tela antiga

**Files:** Modify `web/src/App.tsx` · Modify `web/src/screens/Mais.tsx` · Modify `web/src/design/shell/SidebarV2.tsx` · Delete `web/src/screens/gestao/GruposTrabalho.tsx`

- [ ] **6.1 App.tsx:** ler o bloco de rotas (`Grep -n "grupos-trabalho|anotacoes" App.tsx` pra achar as linhas). Trocar a rota atual `<Route path="mais/grupos-trabalho" element={<ProtectedRoute requireRoles={...}><GruposTrabalho/></ProtectedRoute>} />` (forma exata no arquivo) por:

```tsx
<Route path="grupos" element={<GruposLista />} />
<Route path="grupos/:groupId" element={<GrupoWorkspace />} />
<Route path="mais/grupos-trabalho" element={<Navigate to="/grupos" replace />} />
```

Imports: remover `GruposTrabalho`, adicionar `GruposLista`, `GrupoWorkspace` (de `./screens/grupos/...`) e garantir `Navigate` no import de react-router-dom. As rotas novas ficam DENTRO do layout autenticado (mesmo nível das rotas `anotacoes`), SEM requireRoles.

- [ ] **6.2 Mais.tsx:39:** mover o item de `coordItems` pra `personalItems` (visível a todos), apontando pra `/grupos`:

```ts
// em personalItems, após Anotações:
{ to: '/grupos', label: 'Grupos de trabalho', hint: 'O ambiente da sua equipe — pool de tarefas' },
// remover a entrada antiga de coordItems ({ to: '/mais/grupos-trabalho', ... requireRoles })
```

- [ ] **6.3 SidebarV2.tsx (minificado):** extrair a string atual do item e substituir via PowerShell:

```powershell
$p = 'D:\la-organizer\_remote\web\src\design\shell\SidebarV2.tsx'
$s = [IO.File]::ReadAllText($p)
# 1) descobrir a string exata do item atual:
[regex]::Match($s, '\{[^{}]*grupos-trabalho[^{}]*\}').Value
# 2) remover do bloco GESTÃO (usar a string achada acima, com vírgula adjacente) e
# 3) inserir após o item Anotações no bloco PRINCIPAL, com to:'/grupos':
$old = '<STRING-EXATA-ACHADA-NO-PASSO-1>'
$novo = "{ to: '/grupos', label: 'Grupos de trabalho', icon: Users },"
$s = $s.Replace($old + ',', '').Replace($old, '')   # remove (com ou sem vírgula)
$anot = [regex]::Match($s, '\{[^{}]*Anotações[^{}]*\},').Value
$s = $s.Replace($anot, $anot + ' ' + $novo)
[IO.File]::WriteAllText($p, $s, (New-Object System.Text.UTF8Encoding($false)))
```

(Os passos 1→2 são descoberta obrigatória: o arquivo é 1 linha; NUNCA editar no escuro. Conferir com tsc que `Users` segue importado.)

- [ ] **6.4 Apagar** `web/src/screens/gestao/GruposTrabalho.tsx` (absorvida). `npx tsc --noEmit` acusa qualquer import órfão.

### Task 7: QuickCreateSheet — defaults

**Files:** Modify `web/src/components/QuickCreateSheet.tsx`

- [ ] **7.1 Props:**

```tsx
interface Props {
  open: boolean;
  onClose: () => void;
  /** Pre-fill date (e.g., from /semana when adding to a specific day). Defaults to today. */
  defaultDueDate?: string;
  /** Workspace de grupos (2026-06-10): abre já no kind certo com o grupo travado. */
  defaultKind?: 'task' | 'group';
  defaultGroupId?: string;
}
export function QuickCreateSheet({ open, onClose, defaultDueDate, defaultKind, defaultGroupId }: Props) {
```

- [ ] **7.2 Reset effect** (substituir as 4 linhas correspondentes dentro do `useEffect` de open):

```tsx
      setKind(defaultKind ?? 'task');
      ...
      setTaskGroupMode(Boolean(defaultGroupId));
      setTaskGroupId(defaultGroupId ?? '');
```

(deps do effect: adicionar `defaultKind`, `defaultGroupId` — eslint-disable já existe na linha; manter.)

- [ ] **7.3 tsc + build:** `npx tsc --noEmit && npx vite build` → OK.

### Task 8: Validação completa + e2e + docs

- [ ] **8.1 Testes:** `npx vitest run src/lib/groupWorkspace.test.ts` → PASS; `npx tsc --noEmit` → 0; `npx vite build` → OK.
- [ ] **8.2 Preview desktop (1366px), logado como Alf:** limpar SW caches; navegar `/grupos` → card Financeiro com membros/progresso; entrar → workspace com stats + "Conferir os cheques do sistema" em ⏰; abrir tarefa → sheet edita; ⚙ abre config; `/mais/grupos-trabalho` redireciona. Screenshot CONTRA O MOCKUP (`specs/assets/2026-06-10-workspace-grupos-mockup.html`): tipografia/espessuras/cores idênticas às do DS.
- [ ] **8.3 Preview mobile (375px):** stats compactos, seções empilhadas, FAB; Mais → Grupos de trabalho leva pra `/grupos`; demais rotas mobile intactas (Hoje/Semana).
- [ ] **8.4 E2E real (Financeiro):** criar tarefa pelo workspace (grupo pré-travado) → aparece no pool + Hoje da Rose/Ana; concluir → "por <nome> · hoje HH:MM" em Feitas; editar prazo → `reminded_at` voltou a NULL no banco (`select reminded_at from tasks where id=...`); cancelar com confirmação.
- [ ] **8.5 Docs:** atualizar STATUS em `docs/superpowers/plans/2026-06-10-grupos-de-trabalho.md` (workspace entregue, pendências restantes: escalação→líder, relatórios) e STATUS neste plano. Registrar known issue só se surgir bug real durante a implementação.

## Self-review (feito na escrita)

1. **Cobertura da spec:** rotas+redirect (T6), lista com counts (T5+T2), workspace fiel com 5 seções+stats+⚙ (T4), GroupTaskSheet com re-arm de lembrete e readOnly (T3+T2), criação pré-configurada (T7), puras+testes (T1), validação vs mockup+e2e (T8). Radar/fora-do-MVP: sem task — correto.
2. **Placeholders:** o único `<STRING-EXATA-...>` é passo de DESCOBERTA obrigatória do arquivo minificado (comando de extração dado) — intencional.
3. **Consistência de tipos:** `PoolTaskRow` (T2) é o tipo do sheet (T3) e das rows (T4); `bucketizeGroupTasks/doneWhenLabel/packageInMonth/addDaysYmd` batem entre T1/T2/T4; `createGroup.mutateAsync → gid` confirmado no hook existente. APIs a conferir no código real durante execução (anotado em T3/T4): `ConfirmDialog`, `StatCard.tone`, `TaskGroupSheet` props, `EmptyState` props.
