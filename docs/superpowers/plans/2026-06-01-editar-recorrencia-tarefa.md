# Editar recorrência e série na tarefa — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Ver e editar a repetição (e demais campos) de uma tarefa recorrente existente, com semântica "daqui pra frente" e prompt de 2 vias ("Só este dia" / "Esta e as próximas").

**Architecture:** Orquestração client-side (não há materializador SQL — `rrule` é JS). Planejador puro testável + executor que faz as chamadas supabase reusando `materializeSeriesClient`. UI: `RecurrencePicker` no `EditTaskSheet` (mobile) e `TaskEditDrawer` (desktop) + diálogo de scope. Ritual noturno 00:30 é a rede de segurança.

**Tech Stack:** React+TS+Tailwind (PWA, validado por `tsc`+`vite build`+Preview), `node:test` pra lógica pura, Supabase JS.

**Spec:** `docs/superpowers/specs/2026-06-01-editar-recorrencia-tarefa-design.md`

---

## File Structure
- `web/src/lib/planSeriesEdit.ts` — planejador puro (decisão). Create.
- `web/src/lib/planSeriesEdit.test.cjs` — testes node do planejador. Create.
- `web/src/lib/editTaskSeries.ts` — executor (chamadas supabase). Create.
- `web/src/components/RecurrenceScopeDialog.tsx` — diálogo "Só este dia / Esta e as próximas". Create.
- `web/src/components/EditTaskSheet.tsx` — add RecurrencePicker + scope + chamar editTaskSeries. Modify.
- `web/src/screens/agenda/components/TaskEditDrawer.tsx` — idem desktop. Modify.

> Convenção do repo: PWA não tem runner de teste. O planejador puro é `.cjs` rodável por `node --test` direto (sem TS). O resto valida por `tsc --noEmit` + `vite build` + Preview (375/1440). Deploy do `web/` é automático (Vercel) no fim do turno — NÃO fazer scp/deploy manual.

---

## Task 1: Planejador puro `planSeriesEdit`

**Files:**
- Create: `web/src/lib/planSeriesEdit.ts`
- Create: `web/src/lib/planSeriesEdit.test.cjs`

- [ ] **Step 1: Escrever os testes que falham** — `web/src/lib/planSeriesEdit.test.cjs`:

```js
const { test } = require('node:test');
const assert = require('node:assert');
// importa o .ts transpilado? Não — duplicamos a lógica pura no .ts e testamos
// a cópia .cjs espelho? Não. Em vez disso o .ts exporta JS puro sem tipos em runtime,
// e o teste importa via require do .ts compilado. Como não há build step no teste,
// o .cjs abaixo importa de um require relativo ao .ts NÃO funciona.
// SOLUÇÃO: o planejador é JS puro; manter a fonte em .ts mas o teste exercita
// uma função idêntica importada do arquivo compilado vite NÃO está disponível.
// Portanto: o teste valida o CONTRATO chamando a função exportada do .ts via tsx? Não disponível.
// Decisão final: escrever planSeriesEdit em JS puro dentro do .ts usando só sintaxe
// compatível e exportá-la; o teste .cjs re-declara os casos esperados chamando uma
// cópia carregada por `require('./planSeriesEdit.ts')` — que falha. Use o passo abaixo.
```

> NOTA DE IMPLEMENTAÇÃO (ler antes de codar): para ter TDD real sem build step, escreva a função pura em **`web/src/lib/planSeriesEdit.cjs`** (CommonJS, JS puro) e crie um **`web/src/lib/planSeriesEdit.ts`** de 2 linhas que re-exporta com tipos:
> ```ts
> // @ts-expect-error - fonte JS pura compartilhada com o teste node
> export { planSeriesEdit } from './planSeriesEdit.cjs';
> export type SeriesEditScope = 'only_this' | 'this_and_future';
> ```
> Assim o teste `node --test` importa o `.cjs` direto, e o app importa o `.ts`. Sem duplicar lógica.

Reescreva o teste `web/src/lib/planSeriesEdit.test.cjs` assim:

```js
const { test } = require('node:test');
const assert = require('node:assert');
const { planSeriesEdit } = require('./planSeriesEdit.cjs');

const TODAY = '2026-06-10';
const anchorTemplate = { id: 'tpl', recurrence_parent_id: null, due_date: '2026-06-10' };
const anchorInstance = { id: 'inst', recurrence_parent_id: 'tpl', due_date: '2026-06-12' };

test('this_and_future com regra nova: cancela futuras e re-materializa', () => {
  const p = planSeriesEdit({ anchor: anchorTemplate, scope: 'this_and_future', newRule: 'FREQ=DAILY', todayYmd: TODAY });
  assert.strictEqual(p.seriesId, 'tpl');
  assert.strictEqual(p.cancelFuture, true);
  assert.strictEqual(p.rematerialize, true);
  assert.strictEqual(p.disable, false);
  assert.strictEqual(p.applyFutureFromYmd, '2026-06-10');
});

test('newRule=null desliga a série (sem recriar)', () => {
  const p = planSeriesEdit({ anchor: anchorTemplate, scope: 'this_and_future', newRule: null, todayYmd: TODAY });
  assert.strictEqual(p.disable, true);
  assert.strictEqual(p.cancelFuture, true);
  assert.strictEqual(p.rematerialize, false);
});

test('newRule=undefined: não mexe na regra (só campos)', () => {
  const p = planSeriesEdit({ anchor: anchorTemplate, scope: 'this_and_future', newRule: undefined, todayYmd: TODAY });
  assert.strictEqual(p.cancelFuture, false);
  assert.strictEqual(p.rematerialize, false);
  assert.strictEqual(p.disable, false);
});

test('only_this: só a âncora, nada de série', () => {
  const p = planSeriesEdit({ anchor: anchorInstance, scope: 'only_this', newRule: undefined, todayYmd: TODAY });
  assert.strictEqual(p.scopeOnlyThis, true);
  assert.strictEqual(p.cancelFuture, false);
  assert.strictEqual(p.rematerialize, false);
});

test('seriesId resolve do parent quando a âncora é instância', () => {
  const p = planSeriesEdit({ anchor: anchorInstance, scope: 'this_and_future', newRule: 'FREQ=WEEKLY;BYDAY=MO', todayYmd: TODAY });
  assert.strictEqual(p.seriesId, 'tpl');
  assert.strictEqual(p.applyFutureFromYmd, '2026-06-12');
});
```

- [ ] **Step 2: Rodar e ver falhar**
Run: `node --test web/src/lib/planSeriesEdit.test.cjs`
Expected: FAIL — cannot find module `./planSeriesEdit.cjs`.

- [ ] **Step 3: Implementar `web/src/lib/planSeriesEdit.cjs`**:

```js
// Planejador puro da edição de série recorrente (sem I/O). Decide O QUE fazer;
// o executor (editTaskSeries.ts) é quem chama o supabase.
function planSeriesEdit({ anchor, scope, newRule, todayYmd }) {
  const seriesId = anchor.recurrence_parent_id || anchor.id;
  const scopeOnlyThis = scope === 'only_this';
  const ruleChanged = newRule !== undefined; // null = desligar; string = nova regra
  const disable = ruleChanged && newRule === null;
  return {
    seriesId,
    scopeOnlyThis,
    // a partir de qual dia os campos se aplicam às futuras pendentes
    applyFutureFromYmd: scopeOnlyThis ? null : String(anchor.due_date),
    // cancelar futuras pendentes (due_date > hoje) só quando a REGRA muda em série
    cancelFuture: !scopeOnlyThis && ruleChanged,
    // recriar instâncias só quando há regra nova não-nula
    rematerialize: !scopeOnlyThis && ruleChanged && newRule !== null,
    disable,
    todayYmd,
  };
}
module.exports = { planSeriesEdit };
```

- [ ] **Step 4: Criar o wrapper TS** `web/src/lib/planSeriesEdit.ts`:

```ts
// @ts-expect-error - fonte JS pura compartilhada com o teste node:test
export { planSeriesEdit } from './planSeriesEdit.cjs';
export type SeriesEditScope = 'only_this' | 'this_and_future';
```

- [ ] **Step 5: Rodar testes (PASS) + tsc**
Run: `node --test web/src/lib/planSeriesEdit.test.cjs` → 5 PASS.
Run: `cd web && npx tsc --noEmit` → sem erros (se o `.cjs` import reclamar, garantir `"allowJs": false` não quebra — o `@ts-expect-error` cobre).

- [ ] **Step 6: Commit** — pular (sem git entre tasks; auto-deploy no fim do turno).

---

## Task 2: Executor `editTaskSeries`

**Files:**
- Create: `web/src/lib/editTaskSeries.ts`

- [ ] **Step 1: Ler dependências reais**
Ler `web/src/lib/materialize-recurrence.ts` (assinatura `materializeSeriesClient('tasks', {id, recurrence_rule, due_date})`) e `web/src/lib/supabase.ts` (export `supabase`). Ler `web/src/utils/date.ts` pra achar `todaySP()` (YYYY-MM-DD em SP).

- [ ] **Step 2: Implementar** `web/src/lib/editTaskSeries.ts`:

```ts
import { supabase } from './supabase';
import { todaySP } from '../utils/date';
import { planSeriesEdit, type SeriesEditScope } from './planSeriesEdit';
import { materializeSeriesClient } from './materialize-recurrence';

export interface AnchorTask {
  id: string;
  recurrence_parent_id: string | null;
  due_date: string;
}
export type TaskPatch = Partial<{
  title: string; due_time: string | null; priority: string | null;
  context: string; eisenhower_quadrant: string | null; description: string | null;
}>;

export interface EditSeriesResult { ok: boolean; error?: string; }

/**
 * Edita uma tarefa recorrente. scope decide só-esta-ocorrência vs esta-e-futuras.
 * newRule: string = nova regra · null = desligar recorrência · undefined = não mexe.
 * reminderTimes: ["13:00",...] aplica novos lembretes; undefined = não mexe.
 */
export async function editTaskSeries(
  anchor: AnchorTask,
  scope: SeriesEditScope,
  patch: TaskPatch,
  newRule: string | null | undefined,
  reminderTimes?: string[],
): Promise<EditSeriesResult> {
  const todayYmd = todaySP();
  const plan = planSeriesEdit({ anchor, scope, newRule, todayYmd });
  const hasPatch = Object.keys(patch).length > 0;

  try {
    if (plan.scopeOnlyThis) {
      if (hasPatch) {
        const { error } = await supabase.from('tasks')
          .update({ ...patch, recurrence_excluded: true }).eq('id', anchor.id);
        if (error) throw error;
      }
      if (reminderTimes) await replaceReminders([anchor.id], anchor.due_date, reminderTimes);
      return { ok: true };
    }

    // this_and_future — alvos: template + futuras pendentes (due_date >= âncora)
    const ids = await futurePendingIds(plan.seriesId, plan.applyFutureFromYmd!);
    if (hasPatch && ids.length) {
      const { error } = await supabase.from('tasks').update(patch).in('id', ids);
      if (error) throw error;
    }
    if (reminderTimes && ids.length) {
      for (const id of ids) {
        const due = await dueOf(id);
        await replaceReminders([id], due, reminderTimes);
      }
    }
    if (newRule !== undefined) {
      // cancela futuras pendentes estritamente após hoje
      const cancelIds = await futurePendingIds(plan.seriesId, addDay(todayYmd));
      if (cancelIds.length) {
        const { error } = await supabase.from('tasks')
          .update({ status: 'cancelled' }).in('id', cancelIds);
        if (error) throw error;
      }
      const { error: upErr } = await supabase.from('tasks')
        .update({ recurrence_rule: newRule }).eq('id', plan.seriesId);
      if (upErr) throw upErr;
      if (plan.rematerialize && newRule) {
        const { data: tpl } = await supabase.from('tasks')
          .select('id, recurrence_rule, due_date').eq('id', plan.seriesId).single();
        if (tpl) await materializeSeriesClient('tasks', tpl as { id: string; recurrence_rule: string });
      }
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

async function futurePendingIds(seriesId: string, fromYmd: string): Promise<string[]> {
  const { data } = await supabase.from('tasks')
    .select('id')
    .or(`id.eq.${seriesId},recurrence_parent_id.eq.${seriesId}`)
    .eq('status', 'pending')
    .gte('due_date', fromYmd);
  return (data ?? []).map((r) => (r as { id: string }).id);
}
async function dueOf(id: string): Promise<string> {
  const { data } = await supabase.from('tasks').select('due_date').eq('id', id).single();
  return String((data as { due_date: string } | null)?.due_date ?? todaySP());
}
async function replaceReminders(taskIds: string[], dueYmd: string, times: string[]): Promise<void> {
  for (const taskId of taskIds) {
    await supabase.from('task_reminders').delete().eq('task_id', taskId).is('sent_at', null);
    const rows = times.map((hhmm) => ({
      task_id: taskId,
      remind_at: `${dueYmd}T${hhmm}:00-03:00`,
      label: hhmm.replace(':00', 'h'),
    }));
    if (rows.length) await supabase.from('task_reminders').insert(rows);
  }
}
function addDay(ymd: string): string {
  const d = new Date(`${ymd}T12:00:00-03:00`); d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}
```

- [ ] **Step 3: Validar tipos + build**
Run: `cd web && npx tsc --noEmit && npx vite build` → sem erros. Se `todaySP` tiver nome diferente, ajustar o import ao nome real visto no Step 1.

- [ ] **Step 4: Commit** — pular.

---

## Task 3: Diálogo de scope `RecurrenceScopeDialog`

**Files:**
- Create: `web/src/components/RecurrenceScopeDialog.tsx`

- [ ] **Step 1: Ler um componente DS de modal** existente (`AdaptiveSheet.tsx` ou `BottomSheet.tsx`) pra seguir o padrão de overlay/props.

- [ ] **Step 2: Implementar** `web/src/components/RecurrenceScopeDialog.tsx`:

```tsx
import { Button } from './Button';
import { AdaptiveSheet } from './AdaptiveSheet';

interface Props {
  open: boolean;
  onClose: () => void;
  onChoose: (scope: 'only_this' | 'this_and_future') => void;
}

export function RecurrenceScopeDialog({ open, onClose, onChoose }: Props) {
  return (
    <AdaptiveSheet open={open} onClose={onClose} title="Tarefa recorrente">
      <div className="space-y-md">
        <p className="text-[13px] text-fg-muted">
          Esta tarefa se repete. Onde aplicar as alterações?
        </p>
        <div className="flex flex-col gap-2">
          <Button variant="primary" onClick={() => onChoose('this_and_future')}>
            Esta e as próximas
          </Button>
          <Button variant="secondary" onClick={() => onChoose('only_this')}>
            Só este dia
          </Button>
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
        </div>
      </div>
    </AdaptiveSheet>
  );
}
```
> Se `AdaptiveSheet` exigir props diferentes (ver Step 1), adaptar. Manter os 3 botões e os labels exatos.

- [ ] **Step 3: Validar** — `cd web && npx tsc --noEmit` (sem erros).

- [ ] **Step 4: Commit** — pular.

---

## Task 4: Integrar no `EditTaskSheet` (mobile)

**Files:**
- Modify: `web/src/components/EditTaskSheet.tsx`

- [ ] **Step 1: Ler o arquivo inteiro** pra entender estado, `onSave`, e como `task` chega (campos `recurrence_rule`, `recurrence_parent_id`, `due_date` no tipo `Task`).

- [ ] **Step 2: Buscar a regra da série ao abrir**
Quando `task.recurrence_parent_id` existe, buscar a regra do template:
```tsx
const [recurrenceRule, setRecurrenceRule] = useState<string | null>(task?.recurrence_rule ?? null);
useEffect(() => {
  let cancelled = false;
  (async () => {
    if (task?.recurrence_rule) { setRecurrenceRule(task.recurrence_rule); return; }
    if (task?.recurrence_parent_id) {
      const { data } = await supabase.from('tasks')
        .select('recurrence_rule').eq('id', task.recurrence_parent_id).single();
      if (!cancelled) setRecurrenceRule((data as { recurrence_rule: string | null } | null)?.recurrence_rule ?? null);
    } else {
      setRecurrenceRule(null);
    }
  })();
  return () => { cancelled = true; };
}, [task?.id, task?.recurrence_rule, task?.recurrence_parent_id]);
```

- [ ] **Step 3: Renderizar o `RecurrencePicker`** abaixo de "PARA QUANDO" (importar `import { RecurrencePicker } from './RecurrencePicker';`):
```tsx
<div>
  <label className="text-[10px] uppercase tracking-wider text-fg-muted font-semibold">Repetição</label>
  <RecurrencePicker value={recurrenceRule} onChange={setRecurrenceRule} startDate={/* due_date state var */ dueDate} />
  {(task?.recurrence_rule || task?.recurrence_parent_id) && (
    <p className="text-[11px] text-fg-muted mt-1">🔁 Tarefa recorrente — alterações valem desta data em diante.</p>
  )}
</div>
```
(usar a variável de estado de due_date que já existe no componente — ver Step 1.)

- [ ] **Step 4: Ajustar o `onSave`** — detectar série e abrir o diálogo
Adicionar estado `const [scopeOpen, setScopeOpen] = useState(false);` e um ref/estado com o patch pendente. Lógica:
```tsx
const isSeries = Boolean(task?.recurrence_parent_id || task?.recurrence_rule) ||
  (recurrenceRule && !task?.recurrence_rule && !task?.recurrence_parent_id);
const ruleChanged = (recurrenceRule ?? null) !== (seriesRuleOriginal ?? null); // seriesRuleOriginal = regra carregada no Step 2

function handleSave(e: FormEvent) {
  e.preventDefault();
  if (isSeries) { setScopeOpen(true); return; }   // pergunta scope
  void doSave('only_this');                         // tarefa simples: salva direto
}

async function doSave(scope: 'only_this' | 'this_and_future') {
  setScopeOpen(false);
  const patch = buildPatch(); // title/due_time/priority/context/eisenhower/description alterados
  const newRule = ruleChanged ? recurrenceRule : undefined;
  const reminderTimes = remindersChanged ? remindersToHHMM(reminders) : undefined;
  const res = await editTaskSeries(
    { id: task.id, recurrence_parent_id: task.recurrence_parent_id ?? null, due_date: task.due_date },
    scope, patch, newRule, reminderTimes,
  );
  if (!res.ok) { showToast('Não consegui salvar: ' + res.error); return; }
  queryClient.invalidateQueries({ queryKey: ['tasks'] });
  notifyTaskUpdated(task.id);
  showToast('Tarefa atualizada');
  onClose();
}
```
Importar `editTaskSeries` e `RecurrenceScopeDialog`. Renderizar `<RecurrenceScopeDialog open={scopeOpen} onClose={() => setScopeOpen(false)} onChoose={doSave} />` no fim do JSX. Manter o caminho atual de `update` direto APENAS pro caso não-série (pode reusar `doSave('only_this')`, que já cobre).
> Se nomes locais diferirem (`dueDate`, `reminders`, `buildPatch`), adaptar ao real do arquivo. NÃO inventar campos — derivar do que já existe no `onSave` atual.

- [ ] **Step 5: Validar** — `cd web && npx tsc --noEmit && npx vite build` (sem erros).

- [ ] **Step 6: Commit** — pular.

---

## Task 5: Integrar no `TaskEditDrawer` (desktop)

**Files:**
- Modify: `web/src/screens/agenda/components/TaskEditDrawer.tsx`

- [ ] **Step 1: Ler o arquivo** e replicar EXATAMENTE o mesmo wiring da Task 4 (estado de `recurrenceRule`, fetch da regra do template, `RecurrencePicker`, `RecurrenceScopeDialog`, `editTaskSeries` no save). Mesmos imports, mesmos labels.

- [ ] **Step 2: Implementar** o mesmo padrão (código idêntico ao da Task 4, adaptado aos nomes locais do drawer).

- [ ] **Step 3: Validar** — `cd web && npx tsc --noEmit && npx vite build` (sem erros).

- [ ] **Step 4: Commit** — pular.

---

## Task 6: Validação visual + verificação E2E

**Files:** nenhum.

- [ ] **Step 1: Rodar o teste puro de novo** — `node --test web/src/lib/planSeriesEdit.test.cjs` → 5 PASS.

- [ ] **Step 2: Preview (controlador)** — em `localhost:4173`, validar mobile (375) e desktop (1440):
  - Abrir uma tarefa recorrente → o bloco "Repetição" aparece preenchido + aviso 🔁.
  - Salvar → diálogo "Só este dia / Esta e as próximas" aparece.
  - Tarefa NÃO-recorrente → salva direto, sem diálogo.
  (Limpar SW cache antes de navegar, padrão do projeto.)

- [ ] **Step 3: E2E de dados (controlador, via MCP/VPS)** — criar uma série de teste curta, abrir uma ocorrência, mudar a regra "esta e as próximas", e conferir no banco: futuras pendentes canceladas + re-materializadas com a nova regra; passado/concluídas intactas; `only_this` não vaza. Depois cancelar a série de teste.

- [ ] **Step 4: Fechar** — auto-deploy publica o `web/` (Vercel) no fim do turno. Sem scp manual.

---

## Notas
- **Sem git entre tasks** (auto-deploy commita o `_remote/` no fim do turno).
- **Guardrail desktop:** `EditTaskSheet` (mobile) e `TaskEditDrawer` (desktop) são arquivos separados — manter os dois em paridade; testar 375 e 1440.
- **Rede de segurança:** se uma etapa do executor falhar no meio, o ritual 00:30 (`recurrence-engine.js`) re-materializa do template — estado nunca fica permanentemente quebrado.
