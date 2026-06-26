# Subtarefas/Checklist unificado nas tarefas (pessoal/delegada/grupo) — design

**Data:** 2026-06-26
**Autor:** chat de coordenação (Claude) · brainstorm com o Alf
**Status:** design aprovado pelo Alf ("fechado! pode executar") — pronto pra writing-plans

---

## 1. Problema / Intenção

Hoje só a **tarefa de grupo** tem subtarefas (mãe `is_group=true` + filhas via `parent_task_id`).
O Alf quer a MESMA capacidade de **checklist** nas tarefas **pessoais** e **delegadas** —
o líder delega "organizar X" com um checklist de passos; o liderado abre e marca; o
delegador acompanha o progresso. App **e** TOM.

**Princípio cravado pelo Alf:** não criar nada novo, **reusar o que já existe**, e **não pode
ficar overkill** pro app hoje.

## 2. Escopo

**DENTRO (este ciclo):** subtarefas/checklist em tarefas **pessoal**, **delegada** e **grupo**
(grupo já funciona; o ganho é estender pessoal/delegada com o mesmo motor).

**FORA (registrado, fatias futuras):**
- **Compromisso (events):** tabela separada, sem `parent_task_id`; o `event_runbook` existente é
  **project-scoped + offset_minutes** (timeline de evento-escola), NÃO serve de checklist de pauta.
  Precisa de um primitivo leve próprio no `events` → **fatia seguinte**, design próprio.
- **Fusão do módulo Checklists** (`op_checklists` vivo c/ dispatch+Aderência; `personal_checklists`
  dormente): decisão separada, mais cara. **Não tocar a Aderência viva.**

## 3. Decisões do brainstorm (travadas)

1. **Escopo:** leve e faseado (3 tarefas agora; compromisso e Checklists depois).
2. **Sub-item = filha via `parent_task_id`** (o MESMO motor do grupo), renderizado como checklist
   leve (título + check); `due_date`/`remind_at` por item **opcionais**.
3. **Compromisso fora** deste ciclo.
4. **Default (a):** marcar todos os itens **NÃO** conclui o pai automaticamente (checklist é guia;
   conclusão do pai é explícita). Dá pra ligar auto-fechar depois.
5. **Default (b) — permissão na delegada:** quem **marca** os itens = o responsável (liderado),
   igual à regra "só o assignee marca como feita"; o **delegador** (criador) vê o progresso X/N e
   **edita a lista** de itens.

## 4. Modelo de dados — REUSO PURO, zero migration

Sub-item = uma linha em `tasks`:
- `parent_task_id` = id da tarefa-pai (obrigatório no filho)
- `is_group` = **false** (filho nunca é grupo; o CHECK `tasks_no_nested_groups` já garante)
- `context`, `assigned_to`, `assigned_group_id` = **herdados do pai** (o checklist da tarefa de
  fulano é de fulano; o da delegada é do liderado; o do grupo segue o grupo)
- `title` = texto do item · `status` ∈ {pending, done} · `due_date`/`remind_at` = null por padrão
- `sort_position` = ordem do item

**Pai:** continua sendo o que é (pessoal/delegada/grupo). **NÃO** vira `is_group` (isso é só pra
"pacote" de grupo). Pai pode ter `parent_task_id IS NULL` e filhos apontando pra ele — permitido
(o CHECK só proíbe `is_group AND parent_task_id IS NOT NULL`).

**1 nível só:** sub-item não tem sub-item — travado na UI e no marker (não oferecer "adicionar
subtarefa" dentro de um sub-item).

**Sem colunas novas. Sem tabela nova. Sem migration.** (Reuso é o ponto.)

**Recorrência:** fora do escopo do checklist v1. Subtarefas de tarefa pessoal/delegada são
não-recorrentes (a maquinaria template/materialização do grupo NÃO é acionada aqui —
`recurrence_rule`/`recurrence_parent_id` ficam null nos itens).

## 5. ⚠️ Linchpin de zero-regressão (a parte delicada)

Hoje as filhas de grupo já são escondidas do topo. Mas filha de tarefa **pessoal**
(`context=personal, assigned_to=eu, parent_task_id=pai`) **apareceria solta na agenda** se a
query de topo não filtrar.

**Mudança central:** as listas de **topo** passam a filtrar **`parent_task_id IS NULL`**; as filhas
só aparecem **dentro** do pai (read-view/edit). Pontos a tratar (mapear no plano, com prova de
que NADA que aparece hoje some):
- `Hoje.tsx` → `fetchTasksToday` / `fetchDelegatedTasks` (abas Trabalho/Pessoal/Delegadas)
- `Semana.tsx` → query da semana
- `AgendaDesktop` → `useAgendaTasks`
- Workspace de grupo já trata filhas (não regredir `filterVisibleGroupTasks`)
- Contadores ("PRA HOJE/ATRASADAS") devem contar só topo (não inflar com itens de checklist)

**Teste obrigatório:** snapshot do que cada lista mostra ANTES e DEPOIS com tarefas SEM checklist
→ idêntico (zero item somindo). E: criar uma tarefa com 3 itens → os 3 NÃO aparecem soltos.

## 6. UI (PWA) — reusa o read-view recém-entregue

- **Leitura:** `TaskDetailSheet` (o read-view) ganha seção **Checklist** — itens com checkbox +
  progresso **X/N**. Tocar a tarefa → abre → vê e marca os itens.
- **Edição:** o sheet de edição ganha **adicionar / remover / reordenar / marcar** itens.
- **Linha da agenda:** badge **"X/N"** (igual ao "0/3" do grupo) quando a tarefa tem itens.
- **Reuso:** os componentes de subtarefa/linha que o grupo (`useGroupWorkspace` / PoolRow / o
  render de filhas) já usa — generalizar pra fora do contexto de grupo, sem duplicar.
- **Permissão na UI (delegada):** checkbox dos itens habilitado pro responsável; pro delegador,
  itens read-only mas a lista é editável (ele é o criador) + vê X/N.

## 7. TOM (engine) — generaliza o motor que o grupo já usa

- `src/services/task-groups.js` tem `addSubtasksToGroup` / a lógica de criar filhas. Generalizar
  pra um helper **sem o acoplamento a `assigned_group_id`** (a "versão LITE"): dado um `parentId`
  + lista de textos, cria filhas herdando context/assigned do pai.
- **Marker:** estender o fluxo de **TASK** com um campo opcional `subtasks: ["...", "..."]` →
  o engine cria o pai e as filhas no mesmo turno. E ações pra **adicionar item** / **marcar item**
  numa tarefa existente (via `TASK_UPDATE` ou ação dedicada — decidir no plano, reusando o parser).
- **Anti-confab:** persistência real antes de "✅ criei o checklist" (a Camada-1 já cobre o
  no-marker; garantir que o caminho de subtasks emite marker/telemetria de verdade).
- **Conclusão:** marcar item = `TASK_UPDATE status=done` no filho; NÃO cascateia pro pai (default a).

## 8. Plano de teste (TDD)

- **Puro (PWA):** helper que separa topo × filhas (`parent_task_id IS NULL`) + cálculo de progresso
  X/N. Casos: tarefa sem itens (topo, X/N ausente), tarefa com itens (itens fora do topo, X/N certo),
  filha não vaza, item done conta no N.
- **Puro (engine):** o helper LITE de criar filhas herda context/assigned do pai; 1-nível (recusa
  filho-de-filho); item done não cascateia pro pai.
- **Regressão (o linchpin §5):** as 5 listas mostram o MESMO conjunto pra tarefas sem checklist
  (antes == depois). Grupo intocado (`filterVisibleGroupTasks`).
- **E2E:** criar tarefa pessoal com 3 itens (app) → read-view mostra 3 + X/N, agenda não duplica;
  delegar com checklist → liderado marca, delegador vê X/N; TOM cria "tarefa com checklist" no 1:1.

## 9. Riscos

| Risco | Mitigação |
|---|---|
| Filha de tarefa pessoal vaza na agenda como tarefa solta | Filtro `parent_task_id IS NULL` no topo + teste de regressão antes/depois (§5) |
| Contadores PRA HOJE/ATRASADAS inflam com itens | Contar só topo; teste de contador |
| Generalizar `task-groups.js` quebra o grupo | Helper LITE separado/parametrizado; não tocar o caminho group+recorrência; TDD do grupo |
| TOM diz "criei checklist" sem persistir | Marker/telemetria real no caminho subtasks; Camada-1 de honestidade |
| Concorrência de deploy (multi-chat no _remote) | `.deploy-hold` antes de editar `src/`; deploy coordenado no fim |

## 10. Resumo de uma linha

Reusar o `parent_task_id` (que já existe) pra dar checklist leve às tarefas pessoal/delegada/grupo,
renderizado no read-view recém-entregue, com o ÚNICO ponto delicado sendo esconder as filhas do
topo da agenda (zero-regressão provada antes/depois). Sem migration, sem conceito novo; compromisso
e fusão do Checklists ficam pra fatias seguintes.
