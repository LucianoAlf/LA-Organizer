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

### 2. Backend — RPC `edit_task_series`
Função Postgres (SECURITY DEFINER, valida `auth`/ownership) numa transação:
```
edit_task_series(
  p_anchor_id uuid,        -- a ocorrência/tarefa aberta
  p_scope text,            -- 'only_this' | 'this_and_future'
  p_patch jsonb,           -- campos alterados: title, due_time, priority, context, eisenhower_quadrant, description
  p_new_rule text,         -- RRULE nova OU null pra desligar OU '__unchanged__' pra não mexer
  p_reminders jsonb        -- lista de horários (HH:MM) da série, ou null = não mexer
)
```
Comportamento:
- **`only_this`**: aplica `p_patch` (e `p_reminders`, se vier) só na linha `p_anchor_id`. Não toca regra. (Marca a ocorrência como "exceção" — ver Edge.)
- **`this_and_future`**:
  - Resolve `série_id`. Aplica `p_patch` em todas as futuras pendentes (`due_date >= anchor.due_date`) + no template.
  - Se `p_reminders` veio: substitui os `task_reminders` das futuras pendentes (apaga os pendentes não enviados e recria nos horários novos, preservando HH:MM por dia).
  - Se `p_new_rule != '__unchanged__'`: cancela futuras pendentes (`due_date > today`), grava a regra no template, e **re-materializa** do dia seguinte em diante com a nova regra (reusa a lógica de materialização). `null` = desliga (não re-materializa; template vira tarefa simples mantendo a ocorrência de hoje).
- Nunca altera linhas `status IN ('done','cancelled')` nem `due_date < today`.
- Retorna `{ updated, cancelled, created }` pra UI dar feedback.

### 3. Cliente
- `EditTaskSheet`/`TaskEditDrawer` chamam a RPC via `supabase.rpc('edit_task_series', {...})` com o scope escolhido no prompt; depois invalidam as queries (react-query) pra atualizar a lista. Substitui o `update` direto atual quando a tarefa é de série.

---

## Edge cases
- **Exceção de ocorrência** (`only_this` num campo): a linha fica destoando da série — comportamento aceito (é o ponto do "só este dia"). A coluna `recurrence_excluded` já existe; usada se necessário pra não ser sobrescrita por re-materialização futura.
- **Desligar recorrência** ("Não repete"): cancela futuras pendentes, zera `recurrence_rule` do template, mantém a ocorrência de hoje/passado.
- **Editar ocorrência passada/de hoje**: `this_and_future` parte da data da ocorrência aberta; se for hoje, inclui hoje em diante.
- **Re-materialização vs eager existente**: cancelar antes de recriar evita duplicatas; idempotência por (série_id, due_date).
- **Conflito com guardrail anti-bomba**: a RPC materializa internamente (não passa por `applyTaskActions`), então o teto de 10 não interfere.

## Testes
- **RPC (pgTAP ou node+service_role):** `this_and_future` propaga título só pra futuras pendentes (passado/concluídas intactas); troca de regra cancela futuras + recria certo; `only_this` não vaza; desligar mantém a de hoje; reminders substituídos preservam HH:MM.
- **UI:** picker popula da regra da série (inclusive quando abre instância); prompt 2-vias só em série; ligar recorrência em tarefa simples funciona; mobile 375 + desktop 1440 intactos.

## Fora de escopo
- Opção "Todas (inclusive passadas)" — só "só este dia" e "esta e as próximas".
- Editar recorrência de **eventos** (este spec é só tarefas; eventos ficam pra depois se necessário).
- Mudar a feature de criação (já funciona).
