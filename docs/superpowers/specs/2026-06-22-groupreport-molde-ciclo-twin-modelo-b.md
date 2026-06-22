# GROUPREPORT-MOLDE-CICLO-TWIN — fix coeso (Modelo B)

- **Data:** 2026-06-22
- **Status:** design aprovado pelo Alf (Modelo B). Aguardando review desta spec antes do plano.
- **Família:** ciclo de vida da recorrência / pacote ([[project-recurrence-lifecycle-rootcause]]). Irmãos: GROUP-RECUR-TEMPLATE-VISIBLE-TO-TOM, GROUPPKG-CONTAINER-PHANTOM-FLATLIST, RECUR-TEMPLATE-DUP.
- **Known-issue:** `GROUPREPORT-MOLDE-CICLO-TWIN` (já registrado, reparo de dados parcial feito).

## Problema

No grupo Financeiro, a mesma tarefa de pacote aparecia **em dobro** no relatório do grupo: "Venc 20" como atrasada (21/06) **e** como hoje (22/06), depois que o TOM moveu a data a pedido da Rose. Caso visível: digest "Bom dia"/"Semana"/"atrasadas"/"Em aberto".

## Causa-raiz (confirmada no código)

Um pacote recorrente cria, **por design**, 4 tipos de linha na MESMA data D:
- **container template** (`is_group=true, recurrence_rule!=null, recurrence_parent_id=null`)
- **subtarefa-do-molde** (`parent_task_id=template, recurrence_rule=null, recurrence_parent_id=null, is_group=false`)
- **container ciclo** (`is_group=true, recurrence_rule=null, recurrence_parent_id=template`)
- **subtarefa-do-ciclo** (`parent_task_id=cicloContainer, recurrence_parent_id=subtarefa-do-molde, is_group=false`)

A **subtarefa-do-molde** e a **subtarefa-do-ciclo** são ambas `is_group=false, recurrence_rule=null` → têm o mesmo título.

**As 3 superfícies leem isso de jeitos diferentes (a doença):**
| Superfície | Esconde subtarefa-do-molde? | Como |
|---|---|---|
| View de pacote (PWA/desktop, `fetchPackages`) | ✅ sim | mostra só containers de ciclo + filhas-do-ciclo |
| Contexto do TOM (`system.js`) | ✅ sim | `filterVisibleGroupTasks` (esconde container template + filhas cujo `parent_task_id` é template) |
| **Relatório do grupo** (`group-report-builder.js`) | ❌ **não** | `queryGroupTasks` só faz `.is('recurrence_rule', null)` (esconde container) + `shapeOpenTasks` esconde `is_group` — a **subtarefa-do-molde escapa** |

No relatório, o `dedupeTasks(título|data|responsável)` **mascarava** o par enquanto molde e ciclo estavam na MESMA data. O reschedule da Rose moveu UMA das duas → datas diferentes → dedup não casa mais → **as duas aparecem**.

**Por que o reschedule moveu a errada:** `pickInstanceTarget` (group-chat-tasks.js) só exclui `recurrence_rule!=null` (o container). A subtarefa-do-molde tem `rule=null` → não foi excluída → o reschedule mexeu no **molde** (que as outras superfícies escondem) em vez do **ciclo** (a ocorrência visível). Por isso a mudança "sumiu" pro app e duplicou no relatório.

**O modelo correto = Modelo B (o que o app JÁ usa):** o **ciclo é a ocorrência**; o molde é blueprint escondido. O relatório é o único fora da curva.

## Objetivo

Fazer o **relatório do grupo conformar ao Modelo B** (esconder a subtarefa-do-molde, reusando o MESMO helper do `system.js`/PWA) + fazer o reschedule/cancel/complete **mirarem o ciclo** (não o molde) + **reconciliar os dados** que meu reparo anterior deixou invertidos. Resultado: relatório == app == contexto do TOM (uma fonte de verdade — "resolve um, resolve tudo").

## Escopo

**Dentro:**
1. Código: `queryGroupTasks` (group-report-builder.js) esconde a subtarefa-do-molde reusando `filterVisibleGroupTasks`.
2. Código: `pickInstanceTarget` (group-chat-tasks.js) prefere o **ciclo** (`recurrence_parent_id!=null`) ao **molde** (`recurrence_parent_id=null`) quando ambos são subtarefas — cobre cancel + complete + reschedule (refinamento do "mira a instância visível").
3. Dados (com OK do Alf): desfazer meu reparo invertido (descancelar os 4 ciclos) + aplicar a intenção da Rose no **ciclo** (Venc 20 → 22) + restaurar o anchor do molde p/ "dia 21".

**Fora (não fazer agora):**
- `createTaskGroup` NÃO muda — ele está correto (molde blueprint + ciclo ocorrência). O molde DEVE existir (anchor pra materializar futuros).
- NÃO materializar ocorrências de junho pra Venc 05/08/10 — elas são **passado em relação à criação do pacote** (21/06); a 1ª ocorrência real delas é julho. Mostrar só julho é o comportamento correto (igual ao app hoje).
- Sem migration (só leitura/dado).

## Design

### Parte 1 — Relatório esconde a subtarefa-do-molde (group-report-builder.js)

`queryGroupTasks` passa a **incluir os containers** na query (pra `filterVisibleGroupTasks` montar o set de templates) e aplica o helper ANTES de `shapeOpenTasks`:

```js
async function queryGroupTasks(supabase, groupId, now = new Date()) {
  const { data } = await supabase.from('tasks')
    .select('id, title, due_date, status, is_group, recurrence_rule, recurrence_parent_id, parent_task_id, ' +
            'created_by, created_at, creator:collaborators!tasks_created_by_fkey(preferred_name, full_name)')
    .eq('assigned_group_id', groupId)
    .neq('status', 'cancelled')
    .order('due_date', { ascending: true, nullsFirst: false });
  const { filterVisibleGroupTasks } = require('../utils/group-task-visibility');
  return shapeOpenTasks(filterVisibleGroupTasks(data || []), spYmd(now));
}
```

- Removido o `.is('recurrence_rule', null)` da query (o `filterVisibleGroupTasks` agora cuida do container template; o `shapeOpenTasks` segue escondendo `is_group` p/ o container de ciclo).
- `filterVisibleGroupTasks` (já existe, usado pelo system.js) esconde: container template + subtarefa cujo `parent_task_id` é um container template presente na lista. → a subtarefa-do-molde some; a do ciclo fica.
- Reuso garante **consistência por construção** com o contexto do TOM e o PWA.

### Parte 2 — `pickInstanceTarget` prefere o ciclo (group-chat-tasks.js)

Hoje exclui só `recurrence_rule!=null`. Estender: entre candidatos, **preferir o que tem `recurrence_parent_id!=null`** (ciclo) ao `recurrence_parent_id=null` (molde/raiz). Se não houver ciclo, cai no atual (tarefa simples/one-off não quebra). Cobre cancel, complete e reschedule (todos chamam `pickInstanceTarget`) → todos passam a mirar a ocorrência visível.

### Parte 3 — Reconciliação de dados (com OK do Alf, reversível)

1. **Descancelar** os 4 ciclos que cancelei por engano: `de4da539` (Venc 20), `f55fad59` (Barra), `e2bb112a` (CG), `1e4ab7cd` (Recreio) → `status=pending`.
2. **Venc 20:** mover o **ciclo** `de4da539` p/ `due_date=2026-06-22` (intenção da Rose) e **restaurar o molde** `be2ac59c` p/ `due_date=2026-06-21` (anchor, casa o título "prazo dia 21"; futuros ciclos voltam a nascer dia 21).
3. Verificar (read-only) que nenhuma outra gêmea molde+ciclo de data-diferente sobrou no grupo.

## Testing (TDD)

- **`group-report-builder` (novo/estendido teste):** dado um pacote com [container template, subtarefa-do-molde@D, container ciclo, subtarefa-do-ciclo@D'], `queryGroupTasks` (mockando supabase) retorna **só a subtarefa-do-ciclo** (1, não 2), inclusive com molde e ciclo em datas DIFERENTES (o caso que escapava do dedup).
- **`pickInstanceTarget` (estender `group-chat-tasks.test.js`):** entre [molde `recurrence_parent_id=null`, ciclo `recurrence_parent_id=X`] retorna o **ciclo**; com só um one-off (`parent_id=null`, sem ciclo) retorna o one-off (não regride); nunca retorna container `rule!=null`.
- **Não-regressão:** rodar a suíte de `group-report-builder` + `group-task-visibility` + `group-chat-tasks` existentes (verde antes/depois).
- **E2E na VPS (read-only + reconciliação):** após o fix + reconciliação, `queryGroupTasks` do grupo Financeiro retorna Venc 20 **uma vez @22**, Barra/CG/Recreio **uma vez @30**, Venc 05/08/10 só **julho**; nenhuma duplicata; bate com o que o app (`fetchPackages`) mostra.

## Riscos & rollback

- **Risco baixo-médio.** `filterVisibleGroupTasks` é battle-tested (system.js desde 12/06). `pickInstanceTarget` é refinamento aditivo (preferência, com fallback). Reconciliação é reversível (descancelar = pending; mover data = re-mover).
- **Outros callers de `queryGroupTasks`:** digest (buildGroupReport) + card de fechamento (group-chat-closing.js) + pool do chat — TODOS querem esconder molde (são surfaces "tarefas abertas do grupo"). O fix beneficia os 3 igual (fonte única, como diz o comentário do shapeOpenTasks). Verificar na execução que não há caller que QUER o molde.
- **Rollback:** reverter os 2 arquivos (git) + re-cancelar os 4 ciclos se preciso. Backup dos arquivos antes do deploy.
- **Deploy:** `.deploy-hold` ANTES de editar `src/` (concorrência) + scp + pm2 restart só com OK do Alf.

## Critérios de sucesso

1. Relatório do grupo mostra cada tarefa de pacote **uma vez** (testado com molde+ciclo em datas diferentes).
2. Relatório == view de pacote do app == contexto do TOM (mesmo helper).
3. Reschedule/cancel/complete miram o **ciclo** (a mudança da Rose reflete na tela).
4. Venc 05/08/10 mostram **julho** (1ª ocorrência pós-criação), sem junho-fantasma.
5. Suítes verdes (sem regressão); minha regressão anterior (TOM não via Barra/CG/Recreio) resolvida.
6. Deploy só com OK do Alf.
