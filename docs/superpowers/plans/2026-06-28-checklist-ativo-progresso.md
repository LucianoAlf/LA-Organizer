# Checklist Ativo — Progresso na Comunicação do TOM — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (escolhido: inline, com checkpoints de produção pro Alf) ou superpowers:subagent-driven-development. Steps usam checkbox (`- [ ]`).

**Goal:** Fazer o checklist (subtarefa via `parent_task_id`, já existe) virar visível e ativo na comunicação do TOM — progresso `X/N`+barra na cobrança/briefing pro executor E delegador, conclusão da última filha auto-concluindo o pai (disparando o aviso ao delegador que já existe + parando a cobrança), e barra de progresso na UI do PWA.

**Architecture:** Um helper puro determinístico monta o bloco de texto (formato exato), espelhado PWA↔engine (parity test). O bloco é injetado em 2 superfícies: alerta de atrasada (determinístico = byte-exato) e briefing (LLM = fiel via instrução verbatim). A "cascade" (todas as filhas done → pai done) roda nos 2 caminhos de marcação (PWA `toggleItem` e ação `mark-item` do TOM) e reusa `notifyTaskCreatorOfAction` que já existe. Zero migration.

**Tech Stack:** Node.js/CommonJS (engine `src/`, `node:test`), React+TS+Supabase (PWA `web/`, `vitest`).

## Global Constraints (valem implicitamente em TODA task)

- **Voz/tom/tamanho do TOM são SAGRADOS.** O bloco é DADO determinístico injetado — NÃO muda como o TOM fala.
- **ZERO migration.** `parent_task_id`, `status`, `completed_at`, `completed_by` já existem.
- **Zero-regressão.** NÃO regredir: listas de topo (`parent_task_id IS NULL`), checklist de GRUPO, e o módulo `op_checklists` (SEPARADO — não tocar, não fundir).
- **Byte-exato** no alerta de atrasada; **fiel (verbatim)** no briefing (LLM).
- **Reusar:** `taskChecklist.ts`/`checklistProgress`, `tomEngine.ts` `/internal/*`, `notifyTaskCreatorOfAction` (`engine.js:4049`), padrão `ChecklistCard` (`/internal/checklist-completed`).
- **`.deploy-hold`** na raiz ANTES de editar qualquer coisa em `src/`; **coordenar** `engine.js`/`system.js`/`dispatcher.js` com o outro chat (dono do engine). PWA (`web/`) é deste chat.
- **Anti-confab:** só afirmar "concluído" se o BANCO confirmar (rowcount/status). Telemetria/marker reais.
- **TDD/catraca.** Helper puro primeiro, com teste. Subagentes/execução NUNCA em Haiku.
- **Commits:** NÃO commitar entre tasks (CLAUDE.md). O auto-deploy (Stop hook) commita+pusha o `web/` no fim do turno; engine vai via `scp`+`pm2` na task de deploy. (Os "Commit" steps abaixo são marcos lógicos, não `git commit` manuais.)

## File Structure

- `web/src/lib/taskChecklist.ts` (Modify) — + `renderChecklistBlock`, `shouldAutocompleteParent` (puros). [Task 1]
- `web/src/lib/taskChecklist.test.ts` (Modify) — + testes dos 2 novos. [Task 1]
- `src/services/checklist-render.js` (Create) — espelho dos 2 helpers, saída idêntica. [Task 2]
- `src/services/checklist-render.test.js` (Create) — parity test. [Task 2]
- `web/src/components/TaskChecklistSection.tsx` (Modify) — barra visual. [Task 3]
- `web/src/components/AgendaTaskRow*.tsx` / linha da agenda (Modify) — badge X/N + mini-barra. [Task 3]
- `src/rituals/dispatcher.js` (Modify) — `checkOverdueAlerts`/`buildOverdueText` anexa bloco + carrega filhas. [Task 4]
- `src/prompts/system.js` (Modify) — bloco no contexto (executor `:470-476` + Delegadas `:649-657`); instrução verbatim no `briefing_diario` (`:2754`). [Task 5]
- loader do contexto (em `engine.js`/`system.js` `buildContext`) — anexa filhas por pai. [Task 5]
- `src/engine.js` (Modify) — ação `mark-item` no parser (vizinho do create em `:4954`); cascade → `notifyTaskCreatorOfAction` (`:4049`) + confirma executor. [Task 6]
- `src/server.js` ou onde moram os `/internal/*` (Modify) — endpoint da ponte. [Task 7]
- `web/src/lib/tomEngine.ts` (Modify) — client da ponte. [Task 7/8]
- `web/src/hooks/useTaskChecklist.ts` (Modify) — cascade no `toggleItem`. [Task 8]

---

### Task 1 — Helpers puros PWA: `renderChecklistBlock` + `shouldAutocompleteParent` (F1)

**Files:**
- Modify: `web/src/lib/taskChecklist.ts`
- Test: `web/src/lib/taskChecklist.test.ts`

**Interfaces:**
- Consumes: `checklistProgress(children: {status?}[]) → {done,total}` (já existe no arquivo).
- Produces:
  - `renderChecklistBlock(children: {title:string; status?:string|null; sort_position?:number|null}[], opts?: {assigneeName?: string|null}) → string`
  - `shouldAutocompleteParent(children: {status?:string|null}[]) → boolean`

- [ ] **Step 1: Escrever os testes que falham** — append em `web/src/lib/taskChecklist.test.ts`:

```ts
import { renderChecklistBlock, shouldAutocompleteParent } from './taskChecklist';

const C = (title: string, status: string, sort_position: number) => ({ title, status, sort_position });

describe('renderChecklistBlock', () => {
  const five = [
    C('Mensagem enviada para o aluno', 'done', 1),
    C('Aluno respondeu', 'done', 2),
    C('Aluno pagou a mensalidade', 'done', 3),
    C('Trancamento do aluno realizado', 'done', 4),
    C('Confirmar matrícula', 'pending', 5),
  ];
  it('formato exato do mockup, com nome (visão do delegador)', () => {
    expect(renderChecklistBlock(five, { assigneeName: 'John' })).toBe(
      '*Checklist* John: 4/5 ▓▓▓▓░\n' +
      '✅ Mensagem enviada para o aluno\n' +
      '✅ Aluno respondeu\n' +
      '✅ Aluno pagou a mensalidade\n' +
      '✅ Trancamento do aluno realizado\n' +
      '⬜ Confirmar matrícula'
    );
  });
  it('sem nome (visão do próprio executor) → label sem nome', () => {
    expect(renderChecklistBlock(five).split('\n')[0]).toBe('*Checklist:* 4/5 ▓▓▓▓░');
  });
  it('sem itens → string vazia', () => {
    expect(renderChecklistBlock([])).toBe('');
  });
  it('cancelled sai do total e da lista', () => {
    const out = renderChecklistBlock([C('a','done',1), C('b','cancelled',2), C('c','pending',3)]);
    expect(out.split('\n')[0]).toBe('*Checklist:* 1/2 ▓▓▓▓▓░░░░░'.replace('▓▓▓▓▓░░░░░','▓░')); // 2 segmentos
    expect(out).not.toContain('b');
  });
  it('ordena por sort_position', () => {
    const out = renderChecklistBlock([C('segundo','pending',2), C('primeiro','pending',1)]);
    const lines = out.split('\n');
    expect(lines[1]).toBe('⬜ primeiro');
    expect(lines[2]).toBe('⬜ segundo');
  });
  it('N>10 escala a barra (cap 10 segmentos), label exato', () => {
    const big = Array.from({ length: 20 }, (_, i) => C(`i${i}`, i < 4 ? 'done' : 'pending', i + 1));
    const header = renderChecklistBlock(big).split('\n')[0];
    expect(header).toBe('*Checklist:* 4/20 ▓▓░░░░░░░░'); // round(4/20*10)=2
  });
  it('tudo feito → barra cheia', () => {
    expect(renderChecklistBlock([C('a','done',1), C('b','done',2)]).split('\n')[0]).toBe('*Checklist:* 2/2 ▓▓');
  });
});

describe('shouldAutocompleteParent', () => {
  it('todas done → true', () => expect(shouldAutocompleteParent([C('a','done',1), C('b','done',2)])).toBe(true));
  it('uma pendente → false', () => expect(shouldAutocompleteParent([C('a','done',1), C('b','pending',2)])).toBe(false));
  it('vazio → false', () => expect(shouldAutocompleteParent([])).toBe(false));
  it('cancelled ignorado: resto done → true', () => expect(shouldAutocompleteParent([C('a','done',1), C('b','cancelled',2)])).toBe(true));
  it('só cancelled → false (total 0)', () => expect(shouldAutocompleteParent([C('a','cancelled',1)])).toBe(false));
});
```

- [ ] **Step 2: Rodar e ver falhar** — `cd _remote/web && npx vitest run src/lib/taskChecklist.test.ts` → FAIL ("renderChecklistBlock is not a function").

- [ ] **Step 3: Implementar** — append em `web/src/lib/taskChecklist.ts`:

```ts
// Bloco de texto do checklist pro WhatsApp (determinístico, formato cravado).
// assigneeName: nome a exibir no label — delegador vê o nome do executor; o próprio executor vê sem nome.
// A barra usa 1 segmento por item até 10; acima disso escala proporcional (cap 10). O label X/N é a fonte de verdade.
export function renderChecklistBlock(
  children: { title: string; status?: string | null; sort_position?: number | null }[],
  opts?: { assigneeName?: string | null },
): string {
  const counted = children.filter((c) => c.status !== 'cancelled');
  const total = counted.length;
  if (total === 0) return '';
  const done = counted.filter((c) => c.status === 'done').length;
  const segments = Math.min(total, 10);
  const filled = Math.round((done / total) * segments);
  const bar = '▓'.repeat(filled) + '░'.repeat(segments - filled);
  const label = opts?.assigneeName ? `*Checklist* ${opts.assigneeName}:` : '*Checklist:*';
  const header = `${label} ${done}/${total} ${bar}`;
  const sorted = [...counted].sort((a, b) => (a.sort_position ?? 0) - (b.sort_position ?? 0));
  const lines = sorted.map((c) => `${c.status === 'done' ? '✅' : '⬜'} ${c.title}`);
  return [header, ...lines].join('\n');
}

// Cascade: pai deve auto-concluir sse tem itens (não-cancelados) e TODOS estão done.
export function shouldAutocompleteParent(children: { status?: string | null }[]): boolean {
  const counted = children.filter((c) => c.status !== 'cancelled');
  if (counted.length === 0) return false;
  return counted.every((c) => c.status === 'done');
}
```

- [ ] **Step 4: Rodar e ver passar** — `cd _remote/web && npx vitest run src/lib/taskChecklist.test.ts` → PASS (incl. os testes antigos de `checklistProgress`/`splitTopLevel`/`canCheckItem`).

- [ ] **Step 5: Marco** — F1 entregue (puro, não deploya). Seguir.

---

### Task 2 — Espelho no engine: `src/services/checklist-render.js` (F2)

**Files:**
- Create: `src/services/checklist-render.js`
- Test: `src/services/checklist-render.test.js`

**Interfaces:**
- Produces (CommonJS): `renderChecklistBlock(children, opts={}) → string` e `shouldAutocompleteParent(children) → boolean` — saída **idêntica** ao PWA (Task 1).

> **`.deploy-hold` ANTES de criar arquivo em `src/`.** Coordenar com o outro chat. Esta task é PURA (sem deploy).

- [ ] **Step 1: `.deploy-hold`** — criar `D:\la-organizer\.deploy-hold` (vazio) pra travar o auto-deploy enquanto edito `src/`.

- [ ] **Step 2: Escrever o teste de paridade que falha** — `src/services/checklist-render.test.js`:

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { renderChecklistBlock, shouldAutocompleteParent } = require('./checklist-render');

const C = (title, status, sort_position) => ({ title, status, sort_position });
const five = [
  C('Mensagem enviada para o aluno', 'done', 1),
  C('Aluno respondeu', 'done', 2),
  C('Aluno pagou a mensalidade', 'done', 3),
  C('Trancamento do aluno realizado', 'done', 4),
  C('Confirmar matrícula', 'pending', 5),
];

test('formato exato com nome (paridade com o PWA)', () => {
  assert.strictEqual(renderChecklistBlock(five, { assigneeName: 'John' }),
    '*Checklist* John: 4/5 ▓▓▓▓░\n' +
    '✅ Mensagem enviada para o aluno\n✅ Aluno respondeu\n✅ Aluno pagou a mensalidade\n' +
    '✅ Trancamento do aluno realizado\n⬜ Confirmar matrícula');
});
test('sem nome → label sem nome', () => {
  assert.strictEqual(renderChecklistBlock(five).split('\n')[0], '*Checklist:* 4/5 ▓▓▓▓░');
});
test('vazio → ""', () => assert.strictEqual(renderChecklistBlock([]), ''));
test('N>10 escala', () => {
  const big = Array.from({ length: 20 }, (_, i) => C(`i${i}`, i < 4 ? 'done' : 'pending', i + 1));
  assert.strictEqual(renderChecklistBlock(big).split('\n')[0], '*Checklist:* 4/20 ▓▓░░░░░░░░');
});
test('cascade: todas done → true; uma pendente → false; vazio → false; cancelled ignorado', () => {
  assert.strictEqual(shouldAutocompleteParent([C('a','done',1), C('b','done',2)]), true);
  assert.strictEqual(shouldAutocompleteParent([C('a','done',1), C('b','pending',2)]), false);
  assert.strictEqual(shouldAutocompleteParent([]), false);
  assert.strictEqual(shouldAutocompleteParent([C('a','done',1), C('b','cancelled',2)]), true);
  assert.strictEqual(shouldAutocompleteParent([C('a','cancelled',1)]), false);
});
```

- [ ] **Step 3: Rodar e ver falhar** — `cd _remote && node --test src/services/checklist-render.test.js` → FAIL (Cannot find module).

- [ ] **Step 4: Implementar** — `src/services/checklist-render.js`:

```js
'use strict';
// Espelho EXATO do helper do PWA (web/src/lib/taskChecklist.ts) pro engine montar o mesmo bloco.
// Mantém paridade byte-a-byte (checklist-render.test.js trava isso).
function renderChecklistBlock(children, opts = {}) {
  const counted = (children || []).filter((c) => c && c.status !== 'cancelled');
  const total = counted.length;
  if (total === 0) return '';
  const done = counted.filter((c) => c.status === 'done').length;
  const segments = Math.min(total, 10);
  const filled = Math.round((done / total) * segments);
  const bar = '▓'.repeat(filled) + '░'.repeat(segments - filled);
  const label = opts.assigneeName ? `*Checklist* ${opts.assigneeName}:` : '*Checklist:*';
  const header = `${label} ${done}/${total} ${bar}`;
  const sorted = [...counted].sort((a, b) => (a.sort_position ?? 0) - (b.sort_position ?? 0));
  const lines = sorted.map((c) => `${c.status === 'done' ? '✅' : '⬜'} ${c.title}`);
  return [header, ...lines].join('\n');
}
function shouldAutocompleteParent(children) {
  const counted = (children || []).filter((c) => c && c.status !== 'cancelled');
  if (counted.length === 0) return false;
  return counted.every((c) => c.status === 'done');
}
module.exports = { renderChecklistBlock, shouldAutocompleteParent };
```

- [ ] **Step 5: Rodar e ver passar** — `node --test src/services/checklist-render.test.js` → PASS.

- [ ] **Step 6: Marco** — F2 entregue. `.deploy-hold` permanece (próximas tasks de engine).

---

### Task 3 — Barra de progresso na UI do PWA (F3)

**Files:**
- Modify: `web/src/components/TaskChecklistSection.tsx` (linha ~33-38, o header "Checklist X/N")
- Modify: linha de tarefa da agenda que mostra o badge de checklist (localizar via grep `checklistProgress`/`splitTopLevel` no consumo da agenda; ex. `web/src/screens/agenda/**`)

**Interfaces:**
- Consumes: `progress: {done,total}` do `useTaskChecklist`.

- [ ] **Step 1: Adicionar a barra visual no `TaskChecklistSection.tsx`** — substituir o bloco do header (linhas 33-38):

```tsx
      <div className="text-label uppercase tracking-wide text-fg-muted mb-1 flex items-center gap-2">
        <span>Checklist</span>
        {progress.total > 0 && (
          <span className="text-fg-muted normal-case tracking-normal">{progress.done}/{progress.total}</span>
        )}
      </div>
      {progress.total > 0 && (
        <div className="h-1.5 w-full rounded-full bg-bg-elevated overflow-hidden mb-2" aria-hidden>
          <div
            className="h-full bg-tom transition-all"
            style={{ width: `${Math.round((progress.done / progress.total) * 100)}%` }}
          />
        </div>
      )}
```

- [ ] **Step 2: Validar build + tipos** — `cd _remote/web && npx tsc --noEmit && npx vite build` → sem erros.

- [ ] **Step 3: Badge na linha da agenda** — localizar onde a agenda exibe filhas/contagem (grep `childrenByParent`/`checklistProgress` em `web/src/screens/agenda`). Onde já houver o badge `X/N`, adicionar uma mini-barra (mesmo padrão acima, `h-1 w-10`). Se não houver badge ainda, adicionar `progress.done>0` → `🗂️ {done}/{total}` discreto. (Implementar conforme o componente real encontrado — manter o DS: `bg-tom`/`bg-bg-elevated`.)

- [ ] **Step 4: Preview** — `localhost:4173`, abrir uma tarefa com checklist (ficha descartável/read-only), conferir a barra. `preview_screenshot` de prova.

- [ ] **Step 5: Marco** — F3 entregue (deploya via Vercel no fim do turno).

---

### Task 4 — Bloco byte-exato no alerta de atrasada (F4a)

**Files:**
- Modify: `src/rituals/dispatcher.js` — `checkOverdueAlerts` (~4717) + `buildOverdueText` (~4704)

**Interfaces:**
- Consumes: `renderChecklistBlock` (Task 2). Filhas da tarefa atrasada (`parent_task_id = task.id`, `status != cancelled`, com `title,status,sort_position`).
- Produces: alerta de atrasada com o bloco anexado quando a tarefa tem checklist.

> `.deploy-hold` ativo. Coordenar com o outro chat. **Ler `dispatcher.js:4700-4880` antes de editar** (confirmar nomes reais).

- [ ] **Step 1: Carregar filhas das tarefas atrasadas** — em `checkOverdueAlerts`, após obter a lista de atrasadas (a query em ~4721), para cada tarefa, buscar as filhas:

```js
// Checklist da atrasada (subtarefa via parent_task_id) — pra mostrar progresso na cobrança.
const { data: _kids } = await supabase
  .from('tasks')
  .select('title, status, sort_position')
  .eq('parent_task_id', task.id)
  .neq('status', 'cancelled')
  .order('sort_position', { ascending: true, nullsFirst: true });
const checklistChildren = _kids || [];
```

- [ ] **Step 2: Anexar o bloco ao texto** — onde o texto do alerta é montado (`buildOverdueText(title, n, quiet)`), anexar o bloco depois:

```js
const { renderChecklistBlock } = require('../services/checklist-render');
let text = buildOverdueText(task.title, daysLate, quiet);
const block = renderChecklistBlock(checklistChildren); // executor vê → sem nome
if (block) text += `\n\n${block}`;
```

- [ ] **Step 3: Verificar sintaxe** — `cd _remote && node --check src/rituals/dispatcher.js`.

- [ ] **Step 4: Smoke (dry-run/log)** — sem deploy ainda; conferir por leitura que o texto concatena só quando há filhas (tarefa sem checklist → texto idêntico ao de hoje, zero-regressão).

- [ ] **Step 5: Marco** — F4a pronto (deploy do engine só na Task 9).

---

### Task 5 — Bloco no briefing (executor + Delegadas) + instrução verbatim (F4b/c)

**Files:**
- Modify: `src/prompts/system.js` — seções do executor (`:470-476` via `renderTaskList`) + Delegadas (`:649-657`); prompt `briefing_diario` (`:2754`)
- Modify: loader do contexto que alimenta `delegatedTasks`/`tasks` (anexar filhas por pai)

**Interfaces:**
- Consumes: `renderChecklistBlock` (Task 2); filhas por pai anexadas pelo loader.
- Produces: contexto do briefing com o bloco; TOM instruído a emitir verbatim.

> `.deploy-hold` ativo. Coordenar com o outro chat. **Ler `system.js:430-680` e `:2740-2790` antes de editar.**

- [ ] **Step 1: Loader anexa filhas por pai** — onde `delegatedTasks` e `tasks` (work/personal) são carregados (rastrear o caller de `buildContext`), para os pais que tenham filhas, anexar `task._checklist = [{title,status,sort_position}...]` (query `parent_task_id IN (ids)`, `status != cancelled`). Carregar SÓ pra compor o bloco — o topo continua filtrando `parent_task_id IS NULL`.

- [ ] **Step 2: Injetar no Delegadas** — em `system.js:651-656`, dentro do `forEach`, após a linha `• ${assignee}: ...`:

```js
const { renderChecklistBlock } = require('../services/checklist-render');
const _b = renderChecklistBlock(t._checklist || [], { assigneeName: assignee });
if (_b) _b.split('\n').forEach((l) => lines.push(`  ${l}`)); // delegador vê com o nome do executor
```

- [ ] **Step 3: Injetar nas tarefas do executor** — em `renderTaskList` (a função usada por `:473-476`), após a linha do título, anexar `renderChecklistBlock(t._checklist || [])` (sem nome — é o próprio executor), indentado.

- [ ] **Step 4: Instrução verbatim no prompt** — no bloco do `briefing_diario` (`system.js:2754`), adicionar uma linha curta: _"Quando uma tarefa trouxer um bloco `*Checklist*` no contexto, REPRODUZA-O VERBATIM (mesma barra/itens) — não resuma nem reescreva."_ (instrução de fidelidade de dado, não muda a voz.)

- [ ] **Step 5: Verificar sintaxe** — `node --check src/prompts/system.js`.

- [ ] **Step 6: Marco** — F4b/c pronto. (Risco LLM documentado no spec §8; o alerta da Task 4 é o carrier byte-exato.)

---

### Task 6 — Marker `mark-item` + cascade + notificação (F5a/b)

**Files:**
- Modify: `src/engine.js` — parser de `<<TASK_UPDATE>>`/`<<TASK>>` (vizinho do create em `:4954`); usar `notifyTaskCreatorOfAction` (`:4049`)

**Interfaces:**
- Consumes: `shouldAutocompleteParent` (Task 2); `notifyTaskCreatorOfAction(task, actor, action)` (existe).
- Produces: ação que marca/desmarca filha → roda cascade → completa/reabre pai → notifica.

> `.deploy-hold` ativo. Coordenar com o outro chat. **Ler `engine.js:4900-4990` e `:4049-4088` antes de editar.**

- [ ] **Step 1: Aceitar `mark-item` no marker** — no handler de `TASK_UPDATE` (onde hoje trata `create`/subtasks), aceitar `{action:'mark-item', item_id?, item_title?, parent_id, done:true|false}`. Resolver a filha (por id, ou por match de título dentro de `parent_id`). Update `status/completed_at/completed_by`.

- [ ] **Step 2: Cascade após marcar** — após o update da filha, carregar as irmãs e rodar:

```js
const { shouldAutocompleteParent } = require('./services/checklist-render');
const { data: sibs } = await supabase.from('tasks')
  .select('id, status').eq('parent_task_id', parentId).neq('status', 'cancelled');
if (shouldAutocompleteParent(sibs || [])) {
  const { data: parent } = await supabase.from('tasks')
    .select('id, title, created_by, assigned_to, status')
    .eq('id', parentId).maybeSingle();
  if (parent && parent.status !== 'done') {
    await supabase.from('tasks').update({ status:'done', completed_at:new Date().toISOString(), completed_by: collaborator.id }).eq('id', parentId);
    await notifyTaskCreatorOfAction(parent, collaborator, 'complete'); // delegador (guard created_by===assigned_to já protege)
    // D2: confirma pro executor
    if (collaborator.phone) await whatsapp.sendMessage(collaborator.phone, `✅ você fechou: ${String(parent.title).slice(0,60)} (todos os itens)`);
  }
}
```

- [ ] **Step 3: Desmarcar reabre (sem notificar)** — se `done:false` e o pai estava `done`, reabrir: `update({status:'pending', completed_at:null, completed_by:null})` no pai. SEM notificação.

- [ ] **Step 4: Anti-confab** — só logar/afirmar "concluído" se o update retornar rowcount>0 (chokepoint vigente). Marker real, sem ✅ decorativo.

- [ ] **Step 5: Verificar sintaxe** — `node --check src/engine.js`.

- [ ] **Step 6: Teste (node:test, com supabase fake/stub do padrão do projeto)** — cascade dispara `notifyTaskCreatorOfAction` 1x quando 100%; não dispara em parcial; desmarcar reabre sem notificar.

- [ ] **Step 7: Marco** — F5a/b pronto.

---

### Task 7 — Ponte `/internal/` pra conclusão pelo app (F5c)

**Files:**
- Modify: handler `/internal/*` do engine (localizar via grep `'/internal/'` em `src/`) — novo `/internal/subtask-parent-complete`
- Modify: `web/src/lib/tomEngine.ts` — client `notifySubtaskParentComplete(parentId)`

**Interfaces:**
- Consumes: `notifyTaskCreatorOfAction` (existe). Padrão `/internal/checklist-completed` (`ChecklistCard`) como referência.
- Produces: `POST /internal/subtask-parent-complete {parent_id}` → carrega o pai, **confirma `status==='done'` no banco** (anti-confab), chama `notifyTaskCreatorOfAction(parent, actor, 'complete')` + confirma pro executor. Client `notifySubtaskParentComplete(parentId): Promise<{ok}>`.

> `.deploy-hold` ativo. Coordenar com o outro chat.

- [ ] **Step 1: Endpoint** — espelhar o handler de `/internal/checklist-completed`. Carregar o pai (`id,title,created_by,assigned_to,status`); se `status !== 'done'` → no-op (não confabula). Senão chama `notifyTaskCreatorOfAction(parent, actorCollab, 'complete')` (actor = `assigned_to` resolvido) + confirma pro executor (D2).

- [ ] **Step 2: Client** — em `tomEngine.ts`, adicionar `notifySubtaskParentComplete(parentId)` no mesmo padrão de `notifyTaskUpdated` (`${TOM_BASE}/internal/subtask-parent-complete`, `x-internal-secret`).

- [ ] **Step 3: Sintaxe + tipos** — `node --check` no handler; `cd _remote/web && npx tsc --noEmit`.

- [ ] **Step 4: Marco** — F5c pronto.

---

### Task 8 — Cascade no PWA (`toggleItem`) (F6)

**Files:**
- Modify: `web/src/hooks/useTaskChecklist.ts` — `toggleItem` (linhas 70-80)

**Interfaces:**
- Consumes: `shouldAutocompleteParent` (Task 1); `notifySubtaskParentComplete` (Task 7).
- Produces: marcar a última filha → completa o pai + notifica; desmarcar de 100% → reabre o pai sem notificar.

- [ ] **Step 1: Estender `toggleItem`** — após o update da filha (mantendo o atual), projetar o estado e cascatear:

```ts
import { checklistProgress, shouldAutocompleteParent } from '../lib/taskChecklist';
import { notifySubtaskParentComplete } from '../lib/tomEngine';
// ...dentro do toggleItem mutationFn, depois do update bem-sucedido:
const projected = items.map((i) => (i.id === id ? { ...i, status: done ? 'done' : 'pending' } : i));
if (parent) {
  if (done && shouldAutocompleteParent(projected)) {
    await supabase.from('tasks').update({ status: 'done', completed_at: new Date().toISOString(), completed_by: meId ?? null }).eq('id', parent.id);
    try { await notifySubtaskParentComplete(parent.id); } catch { /* notificação best-effort */ }
  } else if (!done) {
    // desmarcou: se o pai estava done, reabre (sem notificar)
    await supabase.from('tasks').update({ status: 'pending', completed_at: null, completed_by: null }).eq('id', parent.id).eq('status', 'done');
  }
}
```

- [ ] **Step 2: Tipos + build** — `cd _remote/web && npx tsc --noEmit && npx vite build`.

- [ ] **Step 3: Marco** — F6 pronto (deploya via Vercel).

---

### Task 9 — Validação E2E + deploy coordenado + registro (F7)

**Files:** nenhum novo (validação/deploy/registro).

- [ ] **Step 1: Validação local completa** — `cd _remote/web && npx tsc --noEmit && npx vitest run && npx vite build`; `cd _remote && node --test src/services/checklist-render.test.js` (+ teste da Task 6). Tudo verde.

- [ ] **Step 2: Preview E2E** (`localhost:4173`, ficha descartável): criar delegada com 5 itens → bloco+barra no read-view → marcar 4 → `4/5 ▓▓▓▓░` → marcar o 5º → pai conclui (sumir do topo aberto) → conferir no log/dry-run que a ponte chamaria a notificação. `preview_screenshot` de prova.

- [ ] **Step 3: Deploy coordenado** — alinhar com o outro chat (dono do engine). Engine via `scp` + `ssh tom "pm2 restart tom"` (arquivos: `src/services/checklist-render.js`, `src/rituals/dispatcher.js`, `src/prompts/system.js`, `src/engine.js`, handler `/internal`). **Remover `.deploy-hold`** → o Stop hook commita+pusha o `web/` (Vercel).

- [ ] **Step 4: E2E real na VPS** — `ssh tom` + `node --env-file=.env` num script que monta o bloco de uma tarefa real (read-only) e confirma o formato; conferir o alerta de atrasada num dry-run.

- [ ] **Step 5: Registro** — `tom_known_issues` (INSERT do feature/fix se aplicável) + memória (`project_*`): lição durável (3 conceitos de checklist distintos; briefing LLM x alerta determinístico; ponte `/internal` reusada).

- [ ] **Step 6: Marco** — feature entregue, verificada, registrada.

---

## Self-Review (writing-plans)

**Spec coverage:** §2 D1-D3 → Tasks 1/6/8 (cascade, confirmação, reabrir); Q1 cascade → Tasks 6/8; Q2 ambos → Tasks 4/5; Q3 completo → Task 1 (lista inteira); barra UI → Task 3; byte-exato/fiel → Tasks 4/5; ponte → Task 7; reuso → Tasks 4-8. **Sem gaps.**

**Placeholder scan:** os "localizar via grep" (Task 3 badge, Task 6/7 anchors) são por arquivos do outro chat de 12k linhas — vêm com `file:line` conferidos + instrução de ler antes; código novo está completo. Sem TBD/TODO de conteúdo.

**Type consistency:** `renderChecklistBlock(children, opts?)` e `shouldAutocompleteParent(children)` idênticos PWA (Task 1) ↔ engine (Task 2), travados por parity test. `notifySubtaskParentComplete(parentId)` (Task 7) = consumido na Task 8. `notifyTaskCreatorOfAction(task, actor, 'complete')` = assinatura real conferida (`engine.js:4052`).
