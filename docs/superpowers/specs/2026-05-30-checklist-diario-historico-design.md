# Design — Checklist Pessoal Diário com Histórico (reset + aderência)

> **Origem:** pedido real do colaborador **Jhonatan** (`collaborators.id = 5d74b86b-da6a-4aa1-8783-4b80a2a6d102`).
> **Status:** design aprovado pelo Alf em 2026-05-30. Próximo passo do chat executor: rodar `brainstorming` (se necessário) → `writing-plans` → executar.
> **Ordem no roadmap:** este é o **1º** dos dois pedidos do Jhonatan (o 2º é "hábito quantitativo"). Fazer este primeiro.

---

## 1. Problema (na voz do usuário)

Jhonatan tem 2 listas pessoais ativas:

- **Alimentação** (`list_id 11ff1cc7-a954-47b1-b40c-a1a3defdb292`) — `recurrence_type='daily'`, 6 itens (Refeição da manhã, Almoço, Refeição da tarde, Pré treino, Jantar, ZMA).
- **Treino** (`list_id 7b89b5ab-e824-4923-acff-3b94b0e76a3a`) — `recurrence_type='weekly'`, `days_of_week=[2,3,4,5,6]` (ter–sáb), 3 itens.

Dor relatada: *"Marco um item como feito e ele fica marcado pra sempre. No dia seguinte preciso desmarcar na mão. E se num dia fiz só 2 de 6, essa informação some — não tem como ver o histórico dia a dia."*

Confirmado no banco: `personal_checklist_items.is_done` da "Refeição da manhã" está `true` (marcado hoje 13:52) e **nunca reseta**. `personal_checklist_completions` tem **0 linhas** — ou seja, zero histórico.

---

## 2. Diagnóstico — NÃO é feature nova, é uma sprint que foi explicitamente adiada

O modelo de "execução diária com histórico" **já existe e funciona**, mas só foi ligado para as listas **de trabalho** (`op_checklists`). As listas pessoais foram deixadas de propósito no modelo estático.

Prova no próprio código:

- `web/src/screens/checklists/hooks/useChecklistsHoje.ts:7-9` e `:175-176`:
  > *"Pra esta sprint, listas pessoais usam o modelo simples (is_done direto no item). Recorrência (personal_checklist_completions) entra em sprint futura quando todo o fluxo Hoje/reset diário for adaptado."*
- `web/src/screens/checklists/hooks/useToggleItem.ts`:
  - **work** → `upsert op_checklist_item_completions` (snapshot por dia). ← implementação de referência.
  - **personal** → `update personal_checklist_items.is_done` direto (estático, sem histórico). ← o que causa a dor.

### Infra que JÁ existe (não recriar)

- **Colunas de recorrência** em `personal_checklists`: `recurrence_type` ('once'|'daily'|'weekly'|'monthly'), `days_of_week` (int[]), `day_of_month` (int). Migration `20260527010000_personal_checklists_recurrence.sql`. Já preenchidas nas listas do Jhonatan.
- **Tabelas de histórico** (migration `20260527010100_personal_checklist_completions.sql`):
  - `personal_checklist_completions` — UNIQUE **(checklist_id, user_id, reference_date)**; colunas `started_at, completed_at, channel`. ⚠️ a coluna é `user_id` (= id do colaborador), **não** `collaborator_id`.
  - `personal_checklist_item_completions` — UNIQUE **(completion_id, item_id)**; colunas `is_checked, checked_at, notes, derived_task_id`.
- **`RecurrenceField.tsx`** já existe e é usado no sheet de criar/editar lista pessoal.
- Modelo de referência idêntico no op: `dispatchChecklists()` em `src/rituals/dispatcher.js:461` cria 1 `op_checklist_completions` por (checklist, collab, dia), com idempotência por `checklist_id + reference_date`.

**Conclusão:** o trabalho é *ligar* as listas pessoais recorrentes no modelo de completion que já roda no trabalho + construir a tela de histórico. Reaproveitar o branch `work` como molde.

---

## 3. Objetivo

Para listas pessoais com `recurrence_type` ∈ {daily, weekly, monthly}:

1. **Reset automático diário** — todo dia (ou na primeira abertura do dia) os itens voltam a "pendente".
2. **Histórico por data** — ao virar o período, fica salvo "30/05 — 4 de 6 concluídos", com quais itens.
3. **Tela de histórico** — lista dia a dia: % de conclusão + itens feitos/pendentes.

Listas com `recurrence_type='once'` **mantêm** o comportamento atual (`is_done` estático, sem reset).

---

## 4. Design proposto

### 4.1 Estratégia de reset: *lazy ensure* (sem cron)

Ao contrário do op (que tem `dispatch_time` e dispara WhatsApp via cron), listas pessoais não precisam de cron — basta criar a completion do dia **na primeira interação do dia** (get-or-create). Isso resolve reset e recorrência de uma vez:

```
ensurePersonalCompletion(checklistId, collabId, today):
  1. carrega a lista (recurrence_type, days_of_week, day_of_month)
  2. se recurrence_type='once' → retorna null (usa modelo legado is_done)
  3. recurrenceAppliesToday()?
       daily   → sempre true
       weekly  → days_of_week inclui dow(today)   (0=dom … 6=sáb — CONFIRMAR convenção usada no RecurrenceField/dispatcher)
       monthly → day_of_month === dom(today)
     se não aplica hoje → retorna null (lista não aparece em "Hoje")
  4. upsert personal_checklist_completions (checklist_id, user_id=collabId, reference_date=today)
     onConflict (checklist_id, user_id, reference_date) → retorna a row existente/criada
```

⚠️ **Confirmar a convenção de `days_of_week`** (0–6 começando domingo vs segunda) lendo `RecurrenceField.tsx` + como `dispatchChecklists` resolve dia da semana, e usar a MESMA. Divergência aqui = lista some no dia errado.

### 4.2 Toggle de item (PWA) — `useToggleItem.ts`, branch personal

Trocar o `update is_done` por upsert na completion do dia (espelhando o branch work):

```ts
// personal recorrente:
const completion = await ensurePersonalCompletion(checklistId, collabId, today);
await supabase.from('personal_checklist_item_completions').upsert({
  completion_id: completion.id,
  item_id: itemId,
  is_checked: isChecked,
  checked_at: isChecked ? nowISO : null,
  // notes opcional
}, { onConflict: 'completion_id,item_id' });
```

Para `recurrence_type='once'` → mantém o `update is_done` atual.

### 4.3 Leitura do "Hoje" — `useChecklistsHoje.ts`, branch personal

Hoje o branch personal (linha 177+) lê `personal_checklist_items.is_done`. Mudar para: dado a completion de hoje, montar `is_checked` a partir de `personal_checklist_item_completions` (igual o branch work faz com `op_checklist_item_completions`). Item sem row de completion = não marcado. Lista `once` continua lendo `is_done`.

### 4.4 Tela de Histórico

Nova aba/tela "Histórico" da lista pessoal (ou linha do tempo geral). Para cada `personal_checklist_completions` ordenado por `reference_date` desc:

- `% = count(is_checked=true) / total de itens da lista`
- badge de data + barra de progresso
- expandir → itens feitos (✓) e pendentes (○)

Reaproveitar padrões já existentes: `web/src/screens/checklists/AderenciaTabela.tsx`, `useAderencia.ts`, e `web/src/screens/Historico.tsx`. **Não** inventar componente de gráfico novo (sem recharts aqui).

### 4.5 TOM (engine) — paridade WhatsApp

Quando o TOM marca item de lista pessoal recorrente via WhatsApp, precisa escrever em `personal_checklist_item_completions` (mesma `ensurePersonalCompletion`), não em `is_done`. Localizar o caminho atual de toggle de checklist pessoal no `src/engine.js` e adaptar. O realtime do PWA já invalida em mudanças (ver §4.6).

### 4.6 Realtime — gap a corrigir

`useChecklistsHoje.ts` hoje assina `personal_checklist_items` (linha ~88). Como o toggle passa a escrever em `personal_checklist_item_completions` / `personal_checklist_completions`, **adicionar subscriptions** a essas duas tabelas — senão o PWA não atualiza ao vivo quando o TOM marca via WhatsApp. Garantir também que as duas tabelas estão na **publication `supabase_realtime`** (migration), senão `postgres_changes` falha em silêncio.

---

## 5. Migrations

1. (Se faltar) adicionar `personal_checklist_completions` e `personal_checklist_item_completions` à publication `supabase_realtime`.
2. Conferir RLS owner-only nas duas tabelas de completion (filtro por `user_id = current_collab_id()` — verificar se já existe; a migration de criação provavelmente já fez).
3. (Opcional, recomendado) **Backfill do dia corrente**: para não perder o que o Jhonatan já marcou hoje no modelo antigo, criar a completion de hoje das listas recorrentes e semear `item_completions.is_checked` a partir do `is_done` atual. Depois disso, parar de depender de `is_done` para listas recorrentes.

---

## 6. Edge cases

- **Item adicionado/removido no meio do período:** a completion guarda `item_completions` por `item_id`. Item novo sem row = não marcado naquele dia (correto). Histórico de dias passados não muda.
- **`is_done` legado:** para listas recorrentes, `is_done` deixa de ser fonte de verdade. Decidir: ignorar ou manter sincronizado por compat. Recomendação: ignorar para recorrentes (fonte = item_completions) e documentar.
- **Fuso:** usar o mesmo cálculo de "hoje" (America/Sao_Paulo) que o resto do app/dispatcher usa (`todayOffsetSP`/equivalente), não `new Date().toISOString()` cru — senão vira o dia à meia-noite UTC (21h BRT).

---

## 7. Fora de escopo

- Streaks/gamificação para checklist (isso é do módulo Hábitos).
- Compartilhar lista pessoal / permissões (segue owner-only).
- Notificação/cron de lembrete da lista pessoal (pode virar follow-up; hoje não tem `dispatch_time`).

---

## 8. Anchors de código (para o chat executor)

| O quê | Arquivo |
|---|---|
| Branch work (molde de completion) | `web/src/screens/checklists/hooks/useChecklistsHoje.ts` (work) |
| Toggle work vs personal | `web/src/screens/checklists/hooks/useToggleItem.ts` |
| Helpers personal (legado is_done) | `web/src/lib/personalChecklists.ts` |
| Criação op_checklist_completions/dia | `src/rituals/dispatcher.js:461` (`dispatchChecklists`) |
| RecurrenceField (convenção days_of_week) | `web/src/screens/checklists/RecurrenceField.tsx` |
| Aderência/histórico (molde de UI) | `web/src/screens/checklists/AderenciaTabela.tsx`, `useAderencia.ts`, `web/src/screens/Historico.tsx` |
| Migrations base | `supabase/migrations/20260527010000_personal_checklists_recurrence.sql`, `20260527010100_personal_checklist_completions.sql` |

**Deploy:** PWA via Vercel (auto-deploy no push). Engine (`src/`) via scp + `pm2 restart tom`. Validar no Preview (localhost:4173) com o reset de dia simulado antes de pedir retest ao Jhonatan.
