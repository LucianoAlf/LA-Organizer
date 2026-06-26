# Subtarefas/Checklist nas tarefas (pessoal/delegada/grupo) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (escolhido: inline, com checkpoints de produção pro Alf). Steps usam checkbox (`- [ ]`).

**Goal:** Dar checklist/subtarefa às tarefas pessoal/delegada (grupo já tem), reusando `tasks.parent_task_id` — sem migration, sem conceito novo.

**Architecture:** Sub-item = `task` filha (`parent_task_id`=pai, `is_group=false`, herda context/assigned do pai). As listas de topo escondem filhas (Hoje/Semana JÁ fazem via `.is('parent_task_id', null)`; falta `useAgendaTasks` desktop + confirmar `fetchDelegatedTasks`). UI no `TaskDetailSheet` (read-view) + sheet de edição. TOM via helper LITE generalizado do `task-groups.js` + marker `subtasks`.

**Tech Stack:** React/TS + Vite + Tailwind (PWA, vitest); Node CJS engine (node:test); Supabase (project `cesnbnrynvxvgdhfmaua`).

**Spec:** `_remote/docs/superpowers/specs/2026-06-26-subtarefas-checklist-tarefas-design.md`

## Global Constraints

- **ZERO migration** — `parent_task_id`/`is_group`/`context`/`sort_position` já existem. Nada novo no schema.
- **Zero-regressão (risco #1):** tarefa SEM checklist mostra conjunto IDÊNTICO nas 5 listas (antes==depois). NÃO regredir `filterVisibleGroupTasks` / o pool do grupo.
- **1 nível só:** sub-item não tem sub-item (trava UI + marker).
- **Default (a):** marcar todos os itens NÃO conclui o pai. **Default (b):** delegada → liderado marca / delegador edita lista + vê X/N.
- **Voz/comportamento do TOM sagrado** — só ação/persistência, nunca tom/tamanho.
- **`.deploy-hold` na raiz (`D:\la-organizer\.deploy-hold`) ANTES de editar `src/`** (multi-chat no _remote); liberar no deploy. scp+pm2 / git push permitidos sem pedir.
- **Compromisso (events) e fusão do módulo Checklists: FORA** (fatias futuras).

## File Structure

- **Create** `web/src/lib/taskChecklist.ts` — funções puras: `splitTopLevel(tasks)`, `checklistProgress(children)`, `canCheckItem({task, meId})`. Sem I/O.
- **Create** `web/src/lib/taskChecklist.test.ts` — vitest.
- **Modify** `web/src/screens/Hoje.tsx` — confirmar/garantir `.is('parent_task_id', null)` em `fetchDelegatedTasks`; passar children pro read-view.
- **Modify** `web/src/screens/agenda/hooks/useAgendaTasks.ts` — excluir filhas de pai **não-grupo** (o vazamento desktop).
- **Modify** `web/src/components/TaskDetailSheet.tsx` — seção Checklist (lista + checkbox + X/N).
- **Modify** `web/src/components/EditTaskSheet.tsx` (ou o sheet de edição de task) — add/remover/reordenar/marcar itens.
- **Modify** `web/src/screens/Hoje.tsx` / `Semana.tsx` / `TaskRow.tsx` — badge "X/N" na linha quando há itens.
- **Create** `web/src/hooks/useTaskChecklist.ts` — fetch das filhas de um pai + mutations (add/toggle/remove/reorder).
- **Create** `src/services/subtasks.js` — helper LITE: `createSubtasks({supabase, parentId, texts, deps})` + `addSubtask` + `toggleSubtask`. Generaliza o de `task-groups.js` SEM acoplamento a `assigned_group_id`.
- **Create** `src/services/subtasks.test.js` — node:test.
- **Modify** `src/engine.js` — parser TASK aceita `subtasks:[...]`; ação add-item/mark-item; anti-confab.
- **Modify** `skills/` (a skill de criar tarefa) — documentar o `subtasks` pro TOM.

---

### Task F1: Funções puras `taskChecklist.ts` (PWA, TDD)

**Files:** Create `web/src/lib/taskChecklist.ts` + `web/src/lib/taskChecklist.test.ts`

**Interfaces — Produces:**
- `splitTopLevel<T extends {parent_task_id?: string|null}>(tasks: T[]): { top: T[], childrenByParent: Map<string, T[]> }`
- `checklistProgress(children: {status?: string}[]): { done: number, total: number }` — total exclui `cancelled`; done = `status==='done'`.
- `canCheckItem(args: {assigned_to?: string|null, meId?: string|null}): boolean` — true se `meId === assigned_to` (o responsável marca).

- [ ] **Step 1: Teste que falha** (`taskChecklist.test.ts`)

```ts
import { describe, it, expect } from 'vitest';
import { splitTopLevel, checklistProgress, canCheckItem } from './taskChecklist';

describe('splitTopLevel', () => {
  it('separa topo de filhas e agrupa por pai', () => {
    const tasks = [
      { id: 'p', parent_task_id: null },
      { id: 'c1', parent_task_id: 'p' },
      { id: 'c2', parent_task_id: 'p' },
      { id: 'q', parent_task_id: null },
    ];
    const { top, childrenByParent } = splitTopLevel(tasks);
    expect(top.map(t => t.id)).toEqual(['p', 'q']);
    expect(childrenByParent.get('p')!.map(t => t.id)).toEqual(['c1', 'c2']);
    expect(childrenByParent.has('q')).toBe(false);
  });
});

describe('checklistProgress', () => {
  it('conta done sobre total (ignora cancelled)', () => {
    expect(checklistProgress([{ status: 'done' }, { status: 'pending' }, { status: 'cancelled' }]))
      .toEqual({ done: 1, total: 2 });
  });
  it('lista vazia => 0/0', () => {
    expect(checklistProgress([])).toEqual({ done: 0, total: 0 });
  });
});

describe('canCheckItem', () => {
  it('só o responsável marca', () => {
    expect(canCheckItem({ assigned_to: 'u1', meId: 'u1' })).toBe(true);
    expect(canCheckItem({ assigned_to: 'u1', meId: 'u2' })).toBe(false);
    expect(canCheckItem({ assigned_to: null, meId: 'u1' })).toBe(false);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar** — `cd _remote/web && npx vitest run src/lib/taskChecklist.test.ts` → FAIL (módulo não existe).
- [ ] **Step 3: Implementar** (`taskChecklist.ts`)

```ts
export function splitTopLevel<T extends { id: string; parent_task_id?: string | null }>(tasks: T[]) {
  const top: T[] = [];
  const childrenByParent = new Map<string, T[]>();
  for (const t of tasks) {
    if (t.parent_task_id) {
      const arr = childrenByParent.get(t.parent_task_id) ?? [];
      arr.push(t);
      childrenByParent.set(t.parent_task_id, arr);
    } else {
      top.push(t);
    }
  }
  return { top, childrenByParent };
}

export function checklistProgress(children: { status?: string | null }[]) {
  const counted = children.filter(c => c.status !== 'cancelled');
  return { done: counted.filter(c => c.status === 'done').length, total: counted.length };
}

export function canCheckItem(args: { assigned_to?: string | null; meId?: string | null }): boolean {
  return !!args.meId && args.meId === args.assigned_to;
}
```

- [ ] **Step 4: Rodar e passar** — `npx vitest run src/lib/taskChecklist.test.ts` → PASS (6 testes).

---

### Task F2: Linchpin — esconder filhas do topo (zero-regressão)

**Files:** Modify `web/src/screens/Hoje.tsx` (`fetchDelegatedTasks`), `web/src/screens/agenda/hooks/useAgendaTasks.ts`. Test: `web/src/lib/taskChecklist.test.ts` (regressão de filtro).

**Contexto aterrado (já lido):** `fetchTasksToday` (Hoje 102-103/131-132/150-151) e `Semana` (50-51) **já** fazem `.is('parent_task_id', null).eq('is_group', false)` → filha de tarefa pessoal **já é escondida**. Faltam 2 pontos.

- [ ] **Step 1: Confirmar `fetchDelegatedTasks` (Hoje ~167-196)** — ler a função. Se a query NÃO tiver `.is('parent_task_id', null)`, adicionar (alinha com fetchTasksToday). Se já tiver, marcar como OK e seguir.
- [ ] **Step 2: `useAgendaTasks` — excluir filhas de pai NÃO-grupo.** Hoje (linha ~88) faz `.eq('is_group', false)` e só remove filhas de template-mãe (linha ~104: `tplMotherIds`). Filha de tarefa pessoal/delegada (pai `is_group=false`, fora de `tplMotherIds`) **vaza**. Estender o filtro JS: além de remover filhas de template-mãe, remover filhas cujo pai **não é grupo** (i.e., todo `parent_task_id` que não seja de uma mãe-instância de grupo legítima que o desktop queira exibir). **Regra segura:** o desktop só deve listar topo de grupo (pool) + topo pessoal; qualquer `parent_task_id` apontando pra pai que não esteja no conjunto de mães-de-grupo exibíveis sai. Ler o arquivo inteiro pra montar o conjunto certo SEM tirar o pool do grupo (não regredir FixDesk).
- [ ] **Step 3: Teste de regressão (vitest, em `taskChecklist.test.ts`)** — provar que `splitTopLevel` + o filtro de topo NÃO mexe em tarefas sem `parent_task_id`:

```ts
it('regressão: tarefas sem checklist permanecem todas no topo', () => {
  const semChecklist = [{ id: 'a', parent_task_id: null }, { id: 'b', parent_task_id: null }];
  expect(splitTopLevel(semChecklist).top.map(t => t.id)).toEqual(['a', 'b']);
});
it('filha de tarefa pessoal nunca entra no topo', () => {
  const mix = [{ id: 'p', parent_task_id: null }, { id: 'c', parent_task_id: 'p' }];
  expect(splitTopLevel(mix).top.map(t => t.id)).toEqual(['p']);
});
```

- [ ] **Step 4: Contadores** — confirmar que "PRA HOJE / ATRASADAS / CONCLUÍDAS" (Hoje) e badges contam a partir das listas JÁ filtradas (topo), não da query crua. Se algum contador usa array não-filtrado, corrigir.
- [ ] **Step 5: Build** — `cd _remote/web && npx tsc --noEmit && npx vite build` → sem erro.

---

### Task F3: UI — checklist no read-view + edição + badge

**Files:** Modify `web/src/components/TaskDetailSheet.tsx`, o sheet de edição de task, `web/src/components/TaskRow.tsx`. Create `web/src/hooks/useTaskChecklist.ts`.

**Interfaces — Consumes:** `splitTopLevel`/`checklistProgress`/`canCheckItem` (F1). **Produces:** `useTaskChecklist(parentId)` → `{ items, addItem, toggleItem, removeItem, reorderItems, progress }`.

- [ ] **Step 1: `useTaskChecklist.ts`** — query `tasks` filhas (`.eq('parent_task_id', parentId).neq('status','cancelled').order('sort_position')`); mutations:
  - `addItem(text)` → insert `{ title: text, parent_task_id: parentId, is_group: false, status: 'pending', context: pai.context, assigned_to: pai.assigned_to, assigned_group_id: pai.assigned_group_id, created_by: meId, sort_position: <fim> }`.
  - `toggleItem(id, done)` → update status (`done`/`pending`) + `completed_at`/`completed_by`.
  - `removeItem(id)` → soft via `status='cancelled'` (consistente com o resto do app) OU delete (decidir lendo como o grupo apaga filha; seguir o padrão do grupo).
  - `reorderItems(ids)` → update `sort_position` por índice.
  - Invalida as queries de agenda (`['tasks',...]`) após cada mutation.
- [ ] **Step 2: `TaskDetailSheet` — seção Checklist.** Abaixo da Descrição: se há itens (ou sempre, com "adicionar"), renderiza lista com checkbox + texto + progresso "X/N" no header da seção. Checkbox habilitado só se `canCheckItem({assigned_to: task.assigned_to, meId})`. Read-only pro delegador. Reusar o componente de linha de subtarefa do grupo se existir (procurar em `grupos/`/`useGroupWorkspace`); senão, linha simples DS (checkbox + texto).
- [ ] **Step 3: Edição.** No sheet de edição de task: bloco "Checklist" com input "adicionar item", lista com remover + arrastar (reusar a lib de DnD já usada no app), marcar. Disponível pro criador (delegador) e pro responsável conforme regra.
- [ ] **Step 4: Badge "X/N" na linha.** `TaskRow` (e a linha da Semana) mostram badge de progresso quando a task tem filhas (passar `childCount`/`progress` via props a partir do `childrenByParent` do `splitTopLevel`, OU um count leve no fetch). Espelhar o "0/3" do grupo.
- [ ] **Step 5: 1-nível** — dentro de um sub-item (se abrir) NÃO oferecer "adicionar subtarefa".
- [ ] **Step 6: Build + preview** — `tsc --noEmit && vite build`; validar no preview (Task F5).

---

### Task F4: TOM — helper LITE + marker `subtasks` (engine, TDD)

**Files:** Create `src/services/subtasks.js` + `src/services/subtasks.test.js`. Modify `src/engine.js` (parser TASK + ações). Modify a skill de criar tarefa.

**Interfaces — Produces:** `createSubtasks({ supabase, parentId, texts, parent, createdBy })` → cria filhas herdando `context/assigned_to/assigned_group_id` de `parent`, `is_group=false`, `status='pending'`, `sort_position` incremental. Recusa se `parent.parent_task_id` (filho-de-filho). Retorna `{ created: n }`.

- [ ] **Step 1: Teste puro que falha** (`subtasks.test.js`, node:test) — `createSubtasks` herda do pai, recusa filho-de-filho, NÃO seta is_group, NÃO cascateia conclusão. Usar um fake `supabase` (stub de `.from().insert()`), igual aos testes puros do projeto.

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { createSubtasks } = require('./subtasks');

function fakeSupabase(captured) {
  return { from: () => ({ insert: (rows) => { captured.rows = rows; return { select: () => ({ data: rows.map((_, i) => ({ id: 'c' + i })), error: null }) }; } }) };
}

test('cria filhas herdando context/assigned do pai, is_group=false', async () => {
  const cap = {};
  const parent = { id: 'p', parent_task_id: null, context: 'personal', assigned_to: 'u1', assigned_group_id: null };
  const r = await createSubtasks({ supabase: fakeSupabase(cap), parentId: 'p', texts: ['a', 'b'], parent, createdBy: 'u1' });
  assert.equal(r.created, 2);
  assert.equal(cap.rows.length, 2);
  assert.equal(cap.rows[0].parent_task_id, 'p');
  assert.equal(cap.rows[0].is_group, false);
  assert.equal(cap.rows[0].context, 'personal');
  assert.equal(cap.rows[0].assigned_to, 'u1');
});

test('recusa filho-de-filho (1 nível só)', async () => {
  const parent = { id: 'c', parent_task_id: 'p', context: 'personal' };
  await assert.rejects(() => createSubtasks({ supabase: fakeSupabase({}), parentId: 'c', texts: ['x'], parent, createdBy: 'u1' }), /nested|nível|child-of-child/i);
});
```

- [ ] **Step 2: Rodar e falhar** — `cd _remote && node --test src/services/subtasks.test.js` → FAIL.
- [ ] **Step 3: Implementar `subtasks.js`** — função pura-ish (recebe `supabase` injetado, padrão do projeto — ver `project_local_vps_desync`). Validar 1-nível antes do insert; mapear `texts` → rows herdando do `parent`.
- [ ] **Step 4: Rodar e passar** — `node --test src/services/subtasks.test.js` → PASS.
- [ ] **Step 5: Engine — parser TASK aceita `subtasks`.** No handler de criação de TASK (`engine.js`): após criar o pai com sucesso, se o marker trouxe `subtasks: [...]` (array de strings), chamar `createSubtasks({...})` e incluir a contagem na confirmação. Emitir marker/telemetria real (anti-confab: nunca "criei o checklist" sem persistir — a Camada-1 já cobre no-marker; garantir que o caminho subtasks seta `marker_emitted`).
- [ ] **Step 6: Ações add-item / mark-item** — reusar o parser de `TASK_UPDATE`: "adiciona item X na tarefa Y" → `addSubtask`; "marca item X" → `toggleSubtask(status=done)` no filho. NÃO cascatear pro pai (default a). Decidir o shape exato lendo o parser TASK_UPDATE atual; manter mínimo.
- [ ] **Step 7: Skill** — na skill de criar tarefa, documentar o campo `subtasks` (quando o user pede "tarefa com checklist / com os passos X, Y, Z"). NÃO mexer em voz/tom.
- [ ] **Step 8: `node --check src/engine.js`** + sweep `find src -name '*.test.js' -print0 | xargs -0 node --test` (baseline: só os 2 env-fails de sempre).

---

### Task F5: Validação + preview E2E + deploy + registro

**Files:** nenhum novo (validação + deploy + KI + memória).

- [ ] **Step 1: `.deploy-hold`** na raiz antes de qualquer edição de `src/` (F4) — `printf 'subtasks-checklist %s\n' "$(date)" > /d/la-organizer/.deploy-hold`. (F1-F3 são web/, mas o hold protege o ciclo todo enquanto edito.)
- [ ] **Step 2: Build final** — `cd _remote/web && npx tsc --noEmit && npx vite build`; backend `node --check` + `node --test` sweep.
- [ ] **Step 3: Preview E2E (localhost:4173)** — limpar SW, criar tarefa pessoal "X" com 3 itens (via app), provar: read-view mostra os 3 + "0/3"; agenda Hoje NÃO mostra os 3 soltos (só "X" com badge); marcar 1 item → "1/3"; tarefa "X" continua única. Screenshot de prova.
- [ ] **Step 4: Regressão visual** — abrir Hoje/Semana/Desktop/Grupo com tarefas existentes (sem checklist) → tudo igual (nada sumiu, contadores certos, pool do grupo intacto).
- [ ] **Step 5: Deploy coordenado** — confirmar nenhum outro chat editando; remover o `.deploy-hold`; rodar auto-deploy (`powershell -File scripts/auto-deploy.ps1`); provar `origin/main` recebeu os arquivos; engine via o mesmo deploy (git reset+restart). Se só web mudou, Vercel basta.
- [ ] **Step 6: Prova produção** — após Vercel (~2min), teste no celular (hard-refresh) numa tarefa real.
- [ ] **Step 7: Registro** — `tom_known_issues` INSERT (`SUBTASK-CHECKLIST-TASKS`, area=marker/ui, status=corrigido, causa/fix) + memória (`project_*` novo OU atualizar um existente): "checklist via parent_task_id nas 3 tarefas; compromisso/Checklists fora".

---

## Self-Review

**1. Spec coverage:**
- §4 modelo (parent_task_id, herda do pai, 1-nível, sem migration) → F1 (helper) + F3 (useTaskChecklist insert) + F4 (createSubtasks). ✅
- §5 linchpin (esconder filhas do topo) → F2 (Hoje/Semana já ok; fetchDelegatedTasks + useAgendaTasks; regressão). ✅
- §6 UI (read-view checklist + edição + badge X/N + permissão) → F3. ✅
- §7 TOM (helper LITE + marker subtasks + anti-confab + não-cascata) → F4. ✅
- §8 testes (puros PWA+engine, regressão, E2E) → F1/F4 puros, F2 regressão, F5 E2E. ✅
- §3 defaults (a não-cascata / b permissão delegada) → F4 step6 (não-cascata) / F1 canCheckItem + F3 step2 (permissão). ✅

**2. Placeholder scan:** F2 step2 e F4 step6 dizem "ler o arquivo e decidir o shape" — é intencional (execução inline lê o arquivo real; o QUE fazer está cravado, o shape exato do parser/filtro se confirma no código). Sem TBD de conteúdo. ✅

**3. Type consistency:** `splitTopLevel`/`checklistProgress`/`canCheckItem` (F1) usados igual em F2/F3. `createSubtasks({supabase,parentId,texts,parent,createdBy})` igual em F4 test + impl + engine. Colunas (`parent_task_id`,`is_group`,`context`,`assigned_to`,`assigned_group_id`,`sort_position`,`status`) idênticas no insert do F3 e F4. ✅

**Gap conhecido (registrado):** o shape exato da exclusão em `useAgendaTasks` (F2.2) e do parser add-item/mark-item (F4.6) confirma-se lendo o arquivo na execução — risco baixo (inline), mas é o ponto a revisar com cuidado (catraca no F2).
