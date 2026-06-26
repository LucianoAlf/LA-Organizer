# Tela de leitura de tarefa (expandir descrição) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans (execução inline nesta sessão). Steps usam checkbox (`- [ ]`).

**Goal:** Tocar uma tarefa (agenda mobile/desktop ou workspace de grupo) abre uma view de LEITURA com a descrição inteira (sem corte), com ações Concluir/Editar.

**Architecture:** Um componente apresentacional `TaskDetailSheet` (read-only, base `AdaptiveSheet`) recebe props normalizadas; cada superfície (3) adapta seu tipo de tarefa e monta o sheet. Um helper puro `taskDetailMeta` classifica delegada/grupo/pessoal (TDD vitest). A edição (`EditTaskSheet`/`GroupTaskSheet`) fica intacta, atrás do botão `Editar`.

**Tech Stack:** React + TypeScript (PWA Vite), Tailwind DS (tokens `bg-bg-surface`/`text-fg`/`text-tom`/`border-border`), `AdaptiveSheet`/`Button`/`Badge`, vitest p/ lib pura.

## Global Constraints
- Voz/comportamento do TOM: **intactos** (nada de backend de engine aqui).
- Edição **intacta**: `EditTaskSheet` e `GroupTaskSheet` não mudam de comportamento; só passam a ser abertos pelo botão `Editar` da leitura.
- Guardrail desktop: mobile sagrado — testar **375px e 1440px**; nunca sobrescrever mobile.
- DS obrigatório: `Button`/`AdaptiveSheet`/`Badge`/tokens; nada de HTML nativo de input.
- Descrição = **texto puro**: render `whitespace-pre-wrap break-words`, **sem `max-height`**.
- `.deploy-hold` antes de editar `web/`; soltar no fim. `npx tsc --noEmit` + `npx vite build` limpos. Validar no preview (localhost:4173) antes de fechar.
- Mensagem pra equipe NÃO faz parte (Alf já avisou).

---

### Task 0: Hold
- [ ] Criar `_remote/.deploy-hold` com 1 linha ("REVISOR — leitura de tarefa 2026-06-25"). (Soltar na Task 7.)

---

### Task 1: Helper puro `taskDetailMeta` (TDD)

**Files:**
- Create: `web/src/lib/taskDetail.ts`
- Test: `web/src/lib/taskDetail.test.ts`

**Produces:**
```ts
export type TaskMetaKind = 'delegated' | 'group' | 'personal';
export interface TaskMetaInput {
  meId: string | null;
  assigned_to: string | null;
  created_by: string | null;
  assigned_group_id?: string | null;
  creatorName?: string | null;   // nome de created_by, já resolvido
  assigneeName?: string | null;  // nome de assigned_to, já resolvido
  groupName?: string | null;
}
export interface TaskMeta { kind: TaskMetaKind; label: string; }
export function taskDetailMeta(i: TaskMetaInput): TaskMeta;
```

- [ ] **Step 1 — teste RED** (`web/src/lib/taskDetail.test.ts`):
```ts
import { describe, it, expect } from 'vitest';
import { taskDetailMeta } from './taskDetail';

const ME = 'me-1';
describe('taskDetailMeta', () => {
  it('grupo: assigned_group_id → "👥 grupo · criada por X"', () => {
    const m = taskDetailMeta({ meId: ME, assigned_to: null, created_by: 'c-9', assigned_group_id: 'g-1', groupName: 'ADM CG', creatorName: 'Vitoria Souza' });
    expect(m.kind).toBe('group');
    expect(m.label).toBe('👥 ADM CG · criada por Vitoria');
  });
  it('grupo sem nome do criador → só o grupo', () => {
    const m = taskDetailMeta({ meId: ME, assigned_to: null, created_by: null, assigned_group_id: 'g-1', groupName: 'ADM CG' });
    expect(m.label).toBe('👥 ADM CG');
  });
  it('delegada PRA mim (assigned=me, criada por outro) → "Delegada por X"', () => {
    const m = taskDetailMeta({ meId: ME, assigned_to: ME, created_by: 'c-9', creatorName: 'Rose Lima' });
    expect(m.kind).toBe('delegated');
    expect(m.label).toBe('Delegada por Rose');
  });
  it('delegada POR mim (criada por mim, atribuída a outro) → "Delegada para Y"', () => {
    const m = taskDetailMeta({ meId: ME, assigned_to: 'o-2', created_by: ME, assigneeName: 'João Pedro' });
    expect(m.kind).toBe('delegated');
    expect(m.label).toBe('Delegada para João');
  });
  it('pessoal: criada e atribuída a mim → "Pessoal"', () => {
    const m = taskDetailMeta({ meId: ME, assigned_to: ME, created_by: ME });
    expect(m).toEqual({ kind: 'personal', label: 'Pessoal' });
  });
});
```
- [ ] **Step 2 — rodar e ver falhar**: `cd _remote/web && npx vitest run src/lib/taskDetail.test.ts` → FAIL (módulo não existe).
- [ ] **Step 3 — implementar** (`web/src/lib/taskDetail.ts`):
```ts
export type TaskMetaKind = 'delegated' | 'group' | 'personal';

export interface TaskMetaInput {
  meId: string | null;
  assigned_to: string | null;
  created_by: string | null;
  assigned_group_id?: string | null;
  creatorName?: string | null;
  assigneeName?: string | null;
  groupName?: string | null;
}
export interface TaskMeta { kind: TaskMetaKind; label: string; }

function first(name?: string | null): string {
  return String(name ?? '').trim().split(/\s+/)[0] || '';
}

export function taskDetailMeta(i: TaskMetaInput): TaskMeta {
  if (i.assigned_group_id) {
    const by = first(i.creatorName);
    return { kind: 'group', label: `👥 ${i.groupName || 'grupo'}${by ? ` · criada por ${by}` : ''}` };
  }
  const me = i.meId;
  if (me && i.assigned_to === me && i.created_by && i.created_by !== me) {
    return { kind: 'delegated', label: `Delegada por ${first(i.creatorName) || 'alguém'}` };
  }
  if (me && i.created_by === me && i.assigned_to && i.assigned_to !== me) {
    return { kind: 'delegated', label: `Delegada para ${first(i.assigneeName) || 'alguém'}` };
  }
  return { kind: 'personal', label: 'Pessoal' };
}
```
- [ ] **Step 4 — rodar e ver passar**: `npx vitest run src/lib/taskDetail.test.ts` → PASS (5/5).

---

### Task 2: Componente `TaskDetailSheet` (read-only)

**Files:**
- Create: `web/src/components/TaskDetailSheet.tsx`

**Consumes:** `AdaptiveSheet`, `Button`, `Badge` (todos em `web/src/components/`).
**Produces:**
```ts
interface TaskDetailSheetProps {
  open: boolean; onClose: () => void;
  title: string; metaLine: React.ReactNode; description?: string | null;
  dueLabel?: string | null; statusTone?: 'neutral'|'warning'|'danger'|'success'; statusLabel?: string | null;
  doneByLine?: React.ReactNode; isRecurring?: boolean;
  canComplete?: boolean; isDone?: boolean; completing?: boolean;
  onComplete?: () => void; onReopen?: () => void; onEdit?: () => void;
}
export function TaskDetailSheet(props: TaskDetailSheetProps): JSX.Element | null;
```

- [ ] **Step 1 — implementar** (sem unit test; é apresentacional — validação por tsc + preview na Task 7):
```tsx
import type { ReactNode } from 'react';
import { Repeat } from 'lucide-react';
import { AdaptiveSheet } from './AdaptiveSheet';
import { Button } from './Button';
import { Badge } from './Badge';

interface TaskDetailSheetProps {
  open: boolean; onClose: () => void;
  title: string; metaLine: ReactNode; description?: string | null;
  dueLabel?: string | null; statusTone?: 'neutral' | 'warning' | 'danger' | 'success'; statusLabel?: string | null;
  doneByLine?: ReactNode; isRecurring?: boolean;
  canComplete?: boolean; isDone?: boolean; completing?: boolean;
  onComplete?: () => void; onReopen?: () => void; onEdit?: () => void;
}

export function TaskDetailSheet({
  open, onClose, title, metaLine, description, dueLabel, statusTone = 'neutral', statusLabel,
  doneByLine, isRecurring, canComplete, isDone, completing, onComplete, onReopen, onEdit,
}: TaskDetailSheetProps) {
  const desc = (description ?? '').trim();
  return (
    <AdaptiveSheet open={open} onClose={onClose} title="Tarefa" size="md">
      <div className="space-y-md">
        <p className="text-body-sm text-fg-muted flex items-center gap-1.5">
          {metaLine}
          {isRecurring && <Repeat size={13} className="shrink-0" aria-label="Recorrente" />}
        </p>
        <h2 className="text-lg font-semibold text-fg leading-snug break-words">{title}</h2>
        {(dueLabel || statusLabel) && (
          <div className="flex flex-wrap items-center gap-xs">
            {dueLabel && <Badge tone="neutral">{dueLabel}</Badge>}
            {statusLabel && <Badge tone={statusTone}>{statusLabel}</Badge>}
          </div>
        )}
        {doneByLine && <p className="text-body-sm text-fg-muted">{doneByLine}</p>}
        <div>
          <div className="text-label uppercase tracking-wide text-fg-muted mb-1">Descrição</div>
          {desc
            ? <div className="text-body-md text-fg whitespace-pre-wrap break-words">{desc}</div>
            : <div className="text-body-sm text-fg-muted italic">Sem descrição.</div>}
        </div>
        <div className="flex items-center gap-sm pt-sm border-t border-border">
          {canComplete && !isDone && onComplete && (
            <Button variant="primary" size="md" loading={completing} onClick={onComplete}>Concluir</Button>
          )}
          {isDone && onReopen && (
            <Button variant="secondary" size="md" onClick={onReopen}>Reabrir</Button>
          )}
          <div className="ml-auto flex gap-sm">
            {onEdit && <Button variant="secondary" size="md" onClick={onEdit}>Editar</Button>}
            <Button variant="ghost" size="md" onClick={onClose}>Fechar</Button>
          </div>
        </div>
      </div>
    </AdaptiveSheet>
  );
}
```
- [ ] **Step 2 — tsc**: `cd _remote/web && npx tsc --noEmit` → 0 erros. (Se `Button` não tiver `variant="ghost"`, trocar por `secondary`; se `Badge` tones diferirem, ajustar — verificar os componentes antes.)

---

### Task 3: `useAgendaTasks` — join do criador + campos pro detail

**Files:**
- Modify: `web/src/screens/agenda/hooks/useAgendaTasks.ts` (select ~76 + map ~102-111)

- [ ] **Step 1** — no `.select(...)` da query de tasks, acrescentar o join do criador:
  `... assigned_group_id, work_group:work_groups!tasks_assigned_group_id_fkey(name), creator:collaborators!tasks_created_by_fkey(preferred_name, full_name)`.
- [ ] **Step 2** — no `.map(t => ({...}))` que monta `TaskForPanel`/normalizado, expor (se ainda não houver): `description`, `created_by`, `assigned_to`, `assigned_group_id`, `creator_name: t.creator?.preferred_name ?? t.creator?.full_name ?? null`, e manter `work_group_name`. Atualizar a interface `TaskForPanel` (mesmo arquivo) com os campos novos (`description: string | null; creator_name: string | null; created_by: string | null; assigned_to: string | null; assigned_group_id: string | null;`).
- [ ] **Step 3 — tsc**: `npx tsc --noEmit` → 0 erros (corrigir quem consumir `TaskForPanel`).

**Nota:** `useCollaboratorNames` (leftPanel) já resolve nome por id — pro detail, o `creator_name` vindo do join evita lookup extra. Não duplicar: usar o join.

---

### Task 4: Wire AGENDA MOBILE (TaskRow + Hoje/Semana)

**Files:**
- Modify: `web/src/components/TaskRow.tsx` (add `onOpen?`)
- Modify: `web/src/screens/Hoje.tsx`, `web/src/screens/Semana.tsx`

- [ ] **Step 1 — `TaskRow.tsx`**: add prop `onOpen?: (task: Task) => void;`. Tornar o bloco de conteúdo clicável: no `<div className="min-w-0 flex-1">`, adicionar `onClick={() => onOpen?.(task)}` + `role={onOpen ? 'button' : undefined}` + `tabIndex={onOpen ? 0 : undefined}` + `className` ganha `cursor-pointer` quando `onOpen`. Checkbox e `RowMenu` são irmãos (não filhos desse div) → cliques neles não disparam `onOpen`. Não mexer no grip/drag.
- [ ] **Step 2 — `Hoje.tsx`/`Semana.tsx`**: 
  - `import { TaskDetailSheet } from '../components/TaskDetailSheet'; import { taskDetailMeta } from '../lib/taskDetail';`
  - estado `const [detail, setDetail] = useState<Task | null>(null);`
  - passar `onOpen={setDetail}` em cada `<TaskRow .../>`.
  - montar 1× no fim do JSX:
```tsx
{detail && (() => {
  const meta = taskDetailMeta({
    meId: collaborator?.id ?? null,
    assigned_to: detail.assigned_to ?? null,
    created_by: detail.created_by ?? null,
    assigned_group_id: (detail as any).assigned_group_id ?? null,
    creatorName: (detail as any).creator_name ?? null,
    assigneeName: detail.assignee?.full_name ?? null,
    groupName: (detail as any).work_group?.name ?? (detail as any).work_group_name ?? null,
  });
  const isDone = detail.status === 'done';
  return (
    <TaskDetailSheet
      open onClose={() => setDetail(null)}
      title={detail.title}
      metaLine={meta.label}
      description={detail.description}
      isRecurring={Boolean(detail.recurrence_rule || detail.recurrence_parent_id)}
      isDone={isDone}
      canComplete={!isDone}
      onComplete={() => { onToggleTask(detail); setDetail(null); }}
      onEdit={() => { setEditTask(detail); setDetail(null); }}
    />
  );
})()}
```
  - **Wiring real:** usar os handlers de toggle e edit que `Hoje`/`Semana` JÁ passam pro `TaskRow` (`onToggle`/`onEdit`). Ler o arquivo e reusar os nomes exatos (não criar handler novo). `dueLabel`/`statusLabel` opcionais — se quiser, derivar de `detail.due_date`/status; YAGNI no v1 (pode ficar sem chips e a leitura já resolve a dor).
- [ ] **Step 3 — tsc + build**: `npx tsc --noEmit && npx vite build` → limpos.

---

### Task 5: Wire AGENDA DESKTOP (CompactTaskRow + panels)

**Files:**
- Modify: `web/src/screens/agenda/leftPanel/DayPanel.tsx`, `WeekPanel.tsx`, `MonthPanel.tsx` (e o container pai que hoje abre o `EditTaskSheet` no desktop)

- [ ] **Step 1** — Localizar o que o `onClick` do `CompactTaskRow` dispara hoje (abre edição). Subir o estado de `detail` pro mesmo nível onde vive o estado de edição do desktop. Rotear `onClick` → `setDetail(task)` (abre `TaskDetailSheet`); o `onEdit` do detail chama o handler de edição ANTERIOR (o que abria o `EditTaskSheet`).
- [ ] **Step 2** — Montar `TaskDetailSheet` 1× no container do leftPanel desktop, mapeando igual à Task 4 (usando os campos novos de `TaskForPanel`: `description`, `creator_name`, `created_by`, `assigned_to`, `assigned_group_id`, `work_group_name`, `delegated_to`). `assigneeName` via `useCollaboratorNames().firstName(task.delegated_to)` quando for delegada-por-mim.
- [ ] **Step 3 — tsc + build**: limpos. (Não tocar no mobile.)

---

### Task 6: Wire WORKSPACE DE GRUPO

**Files:**
- Modify: `web/src/screens/grupos/GrupoWorkspace.tsx`

- [ ] **Step 1** — Adicionar estado `const [reading, setReading] = useState<PoolTaskRow | null>(null);`. O `PoolRow` já chama `onOpen` — trocar o handler dos `<PoolRow ... onOpen={setEditing} />` (linhas ~332/344/413/425) para `onOpen={setReading}` (abre LEITURA). O `setEditing` (abre `GroupTaskSheet`) passa a ser chamado pelo `onEdit` do detail.
- [ ] **Step 2** — Montar `TaskDetailSheet` perto do `<GroupTaskSheet ...>` (linha ~446):
```tsx
{reading && (() => {
  const isDone = reading.status === 'done';
  const canEdit = !ws.readOnly; // mesma regra do GroupTaskSheet
  return (
    <TaskDetailSheet
      open onClose={() => setReading(null)}
      title={reading.title}
      metaLine={`👥 ${ws.group?.name ?? 'grupo'}${reading.creator_name ? ` · criada por ${first(reading.creator_name)}` : ''}`}
      description={reading.description}
      isDone={isDone}
      canComplete={!isDone && !ws.readOnly}
      completing={rowBusy === reading.id}
      doneByLine={isDone && reading.completed_by_name ? `concluída por ${first(reading.completed_by_name)}` : undefined}
      onComplete={() => { onToggle(reading, true); setReading(null); }}
      onReopen={isDone && !ws.readOnly ? () => { onReopen?.(reading); setReading(null); } : undefined}
      onEdit={canEdit ? () => { setEditing(reading); setReading(null); } : undefined}
    />
  );
})()}
```
  - `first(...)`, `ws.group`, `ws.readOnly`, `onToggle`, `onReopen`, `rowBusy` já existem no arquivo (conferir nomes exatos ao editar). Import `TaskDetailSheet`.
- [ ] **Step 3 — tsc + build**: limpos.

---

### Task 7: Validação + KI + deploy

- [ ] **Step 1 — build final**: `cd _remote/web && npx tsc --noEmit && npx vite build` → limpos.
- [ ] **Step 2 — preview mobile 375px** (localhost:4173, limpar SW): abrir uma tarefa **delegada com descrição longa** na agenda → descrição **inteira, sem corte**; `Concluir` dá baixa; `Editar` abre o `EditTaskSheet`; `Fechar` volta. Screenshot.
- [ ] **Step 3 — preview desktop 1440px**: abrir tarefa pelo painel esquerdo → leitura; `Editar` abre edição. Screenshot. Mobile não quebrou.
- [ ] **Step 4 — grupo**: workspace → tocar card → leitura; `Editar` → `GroupTaskSheet`; `Concluir` baixa o pool.
- [ ] **Step 5 — regressão**: menu ⋮ (mobile) e fluxo de edição/save intactos; checkbox não abre a leitura; criar/editar tarefa normal funciona.
- [ ] **Step 6 — KI**: INSERT em `tom_known_issues` (`TASKDESC-READVIEW-EXPAND` — descrição de tarefa só legível dentro do form apertado; fix = `TaskDetailSheet` read-only nas 3 superfícies).
- [ ] **Step 7 — soltar hold**: apagar `_remote/.deploy-hold`. Auto-deploy (Stop hook) commita+pusha → Vercel.

---

## Self-Review (writing-plans)
- **Spec coverage:** view leitura (T2) ✓; descrição sem teto (T2) ✓; 3 superfícies (T4 mobile, T5 desktop, T6 grupo) ✓; join criador (T3) ✓; meta delegada/grupo/pessoal (T1) ✓; edição atrás do Editar (T4/T5/T6) ✓; gestor readOnly (T6) ✓; testes preview 375/1440 (T7) ✓.
- **Placeholders:** nenhum; código completo nas peças novas (T1/T2) e deltas exatos no wiring. Os pontos "ler o arquivo e reusar handler X" são intencionais (reuso de handler existente, não invenção).
- **Type consistency:** `taskDetailMeta` (T1) ↔ chamadas em T4/T5/T6 batem (campos `meId/assigned_to/created_by/assigned_group_id/creatorName/assigneeName/groupName`). `TaskDetailSheet` props (T2) ↔ uso em T4/T5/T6 batem. `TaskForPanel` novos campos (T3) ↔ consumo em T5.
