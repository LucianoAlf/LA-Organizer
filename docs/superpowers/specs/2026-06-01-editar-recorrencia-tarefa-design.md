# Editar recorrência e série na tarefa — Design

**Data:** 2026-06-01
**Origem:** Ao abrir uma tarefa recorrente pra editar, o campo "Repetição" não aparece — `EditTaskSheet` (mobile) e `TaskEditDrawer` (desktop) têm **0 referências** a recorrência (só o `QuickCreateSheet` tem o `RecurrencePicker`). O usuário não consegue ver nem mudar a repetição de uma tarefa existente.

**Objetivo:** Permitir ver e editar a repetição (e demais campos) de uma tarefa recorrente já existente, com semântica previsível ("daqui pra frente"), sem bagunçar passado nem o mês inteiro por acidente.

---

## Decisões (do brainstorm)
1. **Mudar a repetição** aplica **daqui pra frente** (cancela futuras pendentes + re-materializa; "Não repete" desliga a série).
2. **Editar campos** (título, hora, lembretes, prioridade) numa ocorrência **pode propagar pra série**.
3. **Como o usuário escolhe:** ao salvar uma tarefa que se repete, prompt de **2 vias** — **"Só este dia"** vs **"Esta e as próximas"** (default). Padrão Google/Apple/Todoist. Tarefa não-recorrente salva direto, sem prompt.
4. **Passado e concluídas nunca são alteradas.**
5. **Backend atômico** (RPC numa transação).

---

## Contexto técnico (o que já existe)
- `tasks.recurrence_rule` (RRULE string) no template; instâncias têm `recurrence_parent_id` e `recurrence_rule = NULL`.
- Materialização **eager**: ao criar recorrente, o cliente chama `materializeSeriesClient('tasks', {id, recurrence_rule})` (`web/src/lib/materialize-recurrence.ts`) que gera todas as ocorrências. No servidor há `recurrence-engine.js` + ritual 00:30.
- `RecurrencePicker` (`web/src/components/RecurrencePicker.tsx`): props `value`, `onChange`, `startDate`.
- `QuickCreateSheet` já usa o picker + materialização. `EditTaskSheet`/`TaskEditDrawer` NÃO.
- Lembretes em `task_reminders`; clonados por ocorrência (`_cloneRemindersForInstances`).

## Conceito-chave: o "anchor" e a série
- A tarefa aberta pode ser o **template** (tem `recurrence_rule`) ou uma **ocorrência** (tem `recurrence_parent_id`).
- O **série_id** = `recurrence_parent_id ?? id`. Toda operação "de série" resolve pra esse id.
- "Futuras pendentes" = tarefas da série (`id = série_id` OU `recurrence_parent_id = série_id`) com `due_date >= data_da_ocorrência_aberta`, `status = 'pending'`.

---

## Arquitetura — 3 camadas

### 1. UI
- Adicionar `RecurrencePicker` ao **`EditTaskSheet`** (mobile) e **`TaskEditDrawer`** (desktop), abaixo de "PARA QUANDO", igual ao Criar. `value` = regra da série (se a tarefa é instância, busca a regra do template via `recurrence_parent_id`), `startDate` = `due_date`.
- Rótulo quando recorrente: *"🔁 Tarefa recorrente — alterações valem desta data em diante."*
- Permite também **ligar** recorrência numa tarefa que era "Não repete".
- **Prompt de 2 vias** ao salvar (só se a tarefa pertence a uma série OU passou a ter regra): um `AdaptiveSheet`/diálogo pequeno com **"Só este dia"** e **"Esta e as próximas"** (default destacado). Cancelar volta sem salvar.

### 2. Orquestração client-side (NÃO RPC)
**Decisão revista:** a materialização vive 100% em JS (`rrule`) — `materializeSeriesClient` (PWA) e `recurrence-engine.js` (servidor). NÃO há materializador em SQL. Uma RPC plpgsql exigiria reimplementar o `rrule` em SQL (duplicação arriscada). Então a edição de série é orquestrada **client-side**, espelhando o padrão de criação que já existe. Rede de segurança: o **ritual noturno 00:30** re-materializa do template se uma etapa cliente falhar no meio.

Nova função em `web/src/lib/editTaskSeries.ts`, dividida em duas partes:
- **Planejador puro** `planSeriesEdit({ anchor, scope, newRule, todayYmd })` → `{ seriesId, applyFutureFilter, cancelFuture: boolean, rematerialize: boolean, disable: boolean }`. Sem I/O, testável via `node:test`.
- **Executor** `editTaskSeries(anchor, scope, patch, newRule, reminderTimes)` → roda as chamadas supabase na ordem segura abaixo.

Assinatura/contrato:
- `scope`: `'only_this' | 'this_and_future'`.
- `newRule`: RRULE nova, `null` (desliga) ou `undefined` (regra não mudou — não mexe).
- `patch`: campos alterados (`title`, `due_time`, `priority`, `context`, `eisenhower_quadrant`, `description`).
- `reminderTimes`: `string[]` de "HH:MM" da série, ou `undefined` (não mexe nos lembretes).

Comportamento:
- **`only_this`**: aplica `patch` (+ reminders, se vier) só na linha `anchor.id`. Não toca regra. Seta `recurrence_excluded = true` pra não ser sobrescrita por re-materialização.
- **`this_and_future`** (`seriesId = anchor.recurrence_parent_id ?? anchor.id`):
  1. Atualiza `patch` nas futuras pendentes (`due_date >= anchor.due_date`, `status='pending'`, da série) + no template.
  2. Se `reminderTimes` veio: apaga `task_reminders` pendentes (`sent_at IS NULL`) das futuras e recria nos horários novos (preserva HH:MM por dia).
  3. Se `newRule !== undefined`: cancela futuras pendentes (`due_date > todayYmd`), grava `newRule` no template; se `newRule` não é `null`, chama `materializeSeriesClient` pra recriar. `null` = desliga (não recria; mantém a de hoje).
- Nunca altera `status IN ('done','cancelled')` nem `due_date < todayYmd`.

### 3. Cliente (sheets)
- `EditTaskSheet`/`TaskEditDrawer` adicionam o `RecurrencePicker` (regra da série; se a tarefa é instância, busca a regra do template via `recurrence_parent_id`). Ao salvar: se a tarefa é de série (tem regra OU `recurrence_parent_id`) OU passou a ter regra, abre o **prompt 2-vias** e chama `editTaskSeries(...)`; senão, mantém o `update` direto atual. Depois invalida as queries (react-query).

---

## Edge cases
- **Exceção de ocorrência** (`only_this` num campo): a linha fica destoando da série — comportamento aceito (é o ponto do "só este dia"). A coluna `recurrence_excluded` já existe; usada se necessário pra não ser sobrescrita por re-materialização futura.
- **Desligar recorrência** ("Não repete"): cancela futuras pendentes, zera `recurrence_rule` do template, mantém a ocorrência de hoje/passado.
- **Editar ocorrência passada/de hoje**: `this_and_future` parte da data da ocorrência aberta; se for hoje, inclui hoje em diante.
- **Re-materialização vs eager existente**: cancelar antes de recriar evita duplicatas; idempotência por (série_id, due_date).
- **Conflito com guardrail anti-bomba**: a materialização usa `materializeSeriesClient` (insert direto), não passa por `applyTaskActions`, então o teto de 10 não interfere.

## Testes
- **Planejador puro `planSeriesEdit` (node:test):** `this_and_future` com regra nova → `cancelFuture=true, rematerialize=true`; `newRule=null` → `disable=true, rematerialize=false`; `newRule=undefined` → não mexe na regra; `only_this` → só a âncora, sem cancelar/recriar; `seriesId` resolve do parent quando é instância.
- **Executor (node + service_role, dados de teste):** `this_and_future` propaga título só pra futuras pendentes (passado/concluídas intactas); troca de regra cancela futuras + recria certo; `only_this` não vaza; desligar mantém a de hoje; reminders substituídos preservam HH:MM.
- **UI:** picker popula da regra da série (inclusive quando abre instância); prompt 2-vias só em série; ligar recorrência em tarefa simples funciona; mobile 375 + desktop 1440 intactos.

## Fora de escopo
- Opção "Todas (inclusive passadas)" — só "só este dia" e "esta e as próximas".
- Editar recorrência de **eventos** (este spec é só tarefas; eventos ficam pra depois se necessário).
- Mudar a feature de criação (já funciona).
