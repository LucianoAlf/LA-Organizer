# C — Pacote / grupo de tarefas no chat de grupo do TOM — Design

**Data:** 2026-06-12
**Autor:** TOM dev (sessão com Alf) — disparado pelo caso Rose (grupo Financeiro)
**Status:** Aprovado (design) — pendente review da spec escrita
**Relacionado:** [[project_groupchat_fase4_wa_mirror]], known issues `GROUPCHAT-TASK-DUP-WEEKDAY`, `GROUP-RECUR-TEMPLATE-VISIBLE-TO-TOM`

---

## 1. Contexto e motivação

A Rose (gerente, grupo Financeiro) pediu ao TOM, pelo WhatsApp, **grupos de tarefas**
("Conciliação de Cartões" com cada cartão; "Planilha do financeiro" com Recreio/Barra/CG;
"Aplicar cashbacks" com Recreio/Barra/CG), cada subtarefa com prazo/lembrete próprio. O TOM
criou **tudo solto** (flat), porque o applier do chat de grupo (`group-chat-tasks.js`) só
sabe `create`/`complete` de tarefa individual. O próprio TOM admitiu no grupo: *"nos markers
que tenho disponíveis hoje, não tem formato de grupo de tarefas com subtarefas"*.

Além disso, o reparo automático de um chip (`GROUPCHAT-TASK-DUP-WEEKDAY`) deletou a
**instância visível de junho** do pacote "Conciliação de Cartões" e manteve a **template
oculta**, deixando os 6 cartões pendurados numa mãe que o app esconde → o grupo "sumiu" pra
Rose (regressão de dados).

O app **já tem** o conceito de pacote: `web/src/lib/taskGroups.ts createGroup`. Falta dar
essa capacidade ao TOM e consertar os dados.

## 2. Decisões (confirmadas no brainstorm)

1. **v1 cobre CRIAR pacote novo E ADICIONAR subtarefa a pacote existente** (o fluxo
   incremental da Rose).
2. **Reparo do "Conciliação de Cartões": recriar limpo** com o motor (cancela a árvore
   emaranhada, recria consistente, preservando o status `done` dos 2 cartões já feitos).
3. Motor backend **único** (`createTaskGroup`/`addSubtasksToGroup`), reusado pelo TOM e pelo
   reparo de dados.
4. **A** (dedup de recorrente) e **B** (ação `cancel`) entram como correções irmãs no mesmo
   applier.
5. `weekend_adjust:"previous_friday"` no grupo mensal (caso "dia 4 ou sexta anterior") — o
   motor traduz pra RRULE, o LLM não inventa RRULE.

## 3. Arquitetura

```
WhatsApp / app (Rose pede "cria grupo X com sub A, B, C")
  → group-chat-engine.js  (monta prompt c/ dateAnchor; chama IA)
  → IA emite <<TASK_GROUP>>{...}<<END>>
  → group-chat-engine.js  parseia o marker → chama o applier
  → group-chat-tasks.js   (applier): valida + delega ao MOTOR
  → src/services/task-groups.js  (MOTOR único)
       createTaskGroup     → mãe is_group (+ template+instância se mensal) + filhas + materializeSeries
       addSubtasksToGroup  → resolve instância visível + insere filha no template e na instância
  → group-chat-engine.js  renderiza confirmação ("📦 Pacote X criado com 3 itens")
```

O reparo de dados (script one-off) chama o **mesmo** `src/services/task-groups.js`.

## 4. Motor backend — `src/services/task-groups.js` (NOVO)

Porta fiel do `createGroup` do PWA (`web/src/lib/taskGroups.ts`), adaptada ao backend
(supabase injetado, sem `task_reminders` do PWA — usa `remind_at` na própria task, como o
`group-chat-tasks.js` já faz).

### 4.1 `createTaskGroup({ supabase, groupId, createdBy, input })`
`input`:
```js
{
  title: string,
  recurrence: 'monthly' | null,     // null = grupo simples (uma vez)
  groupDay: number | null,          // dia-do-mês âncora do pacote (mensal); 1..28
  weekendAdjust: 'previous_friday' | null,
  subtasks: [
    { title, day?: number, dueDate?: 'YYYY-MM-DD', remindAt?: ISO }
  ]
}
```
- **Simples** (`recurrence=null`): insere mãe `is_group=true` (+ `due_date` opcional do
  grupo) e cada filha (`parent_task_id=mãe`, `due_date`, `remind_at`, `sort_position`).
- **Mensal**:
  - `rrule`: sem ajuste → `FREQ=MONTHLY;BYMONTHDAY=${groupDay}`. Com `weekendAdjust='previous_friday'` → `FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYMONTHDAY=1..${groupDay};BYSETPOS=-1` (= último dia útil **até** o dia-âncora; se o dia-âncora cai em fim de semana, recua pra sexta). O motor monta o range `1,2,…,groupDay`.
  - **template**: mãe `is_group=true`, `recurrence_rule=rrule`, `due_date=ymd(groupDay)`;
  - **filhas-template**: `parent_task_id=template`, `due_date=ymd(child.day)`;
  - **instância** (ciclo corrente, visível): mãe `is_group=true`, `recurrence_parent_id=template`, `due_date=ymd(groupDay)`, **sem** `recurrence_rule`;
  - **filhas-instância**: `parent_task_id=instância`, `due_date=childDueDateForCycle(...)`, `recurrence_parent_id=filha-template`, `remind_at`;
  - `materializeSeries('tasks', templateRow)` pros próximos ciclos.
- Campos base de toda task: `assigned_group_id=groupId`, `assigned_to=null`,
  `created_by=createdBy`, `context='work'`, `status='pending'`, `source='manual'`,
  `priority='medium'`, `data_classification='real'`.
- Retorna `{ groupId: <id da instância visível (ou da mãe simples)>, motherTemplateId, childIds }`.
- `ymd(dia)` = dia-do-mês → 'YYYY-MM-DD' do mês corrente em SP (helper de fuso fixo -03:00,
  ver [[project_localymd_utc_shift]]).

### 4.2 `addSubtasksToGroup({ supabase, groupId, subtasks })`
`groupId` = id da **instância visível** (ou mãe simples). Para cada subtask:
- **simples**: insere filha sob a mãe (`parent_task_id=groupId`).
- **mensal**: descobre o `recurrence_parent_id` da instância (= template); insere
  filha-template (sob o template) + filha-instância (sob a instância, `recurrence_parent_id`
  = filha-template) + `materializeSeries` da filha-template? (não — materialização é por mãe;
  basta inserir nas duas mães do ciclo corrente; ciclos futuros já materializados ganham a
  nova filha no próximo tick do materializador OU ficam sem ela — **decisão v1: a nova filha
  vale do ciclo corrente em diante; ciclos já materializados não são retro-preenchidos**,
  documentado).
- Retorna `{ added: [...ids] }`.

> O applier resolve o `groupId` a partir do nome do pacote (`group` no marker) buscando a
> mãe `is_group=true` visível (recurrence_rule null) do grupo por título (ilike). Ambíguo/não
> achado → `failed` com motivo claro (o TOM pede esclarecimento, não inventa).

## 5. Marker `<<TASK_GROUP>>`

Parseado em `group-chat-engine.js` (espelha o bloco do `<<TASK_UPDATE>>`/`<<GROUP_REPORT>>`).

**Criar:**
```
<<TASK_GROUP>>
{"action":"create","title":"Conciliação de Cartões","recurrence":"monthly","group_day":1,
 "subtasks":[
   {"title":"Cartão 8516 (Barra)","day":12,"remind_at":"2026-06-12T09:00:00-03:00"},
   {"title":"Cartão 2270 (EMLA)","day":12}
 ]}
<<END>>
```
**Adicionar subtarefa:**
```
<<TASK_GROUP>>
{"action":"add_subtasks","group":"Conciliação de Cartões",
 "subtasks":[{"title":"Cartão Novo (CG)","day":15}]}
<<END>>
```
**Grupo simples (uma vez):**
```
<<TASK_GROUP>>
{"action":"create","title":"Preparar reunião de fechamento",
 "subtasks":[{"title":"Reservar sala","due_date":"2026-06-20"},{"title":"Enviar pauta","due_date":"2026-06-19"}]}
<<END>>
```
Validação no engine: `action` ∈ {create, add_subtasks}; `title`/`group` presente; `subtasks`
array não-vazio; `recurrence` ∈ {monthly, ausente}; `group_day`/`day` inteiro 1..28;
`weekend_adjust` ∈ {previous_friday, ausente}. JSON malformado → rejeita com erro claro
(mesmo padrão dos outros markers).

## 6. A + B — correções no `group-chat-tasks.js`

- **A (dedup de recorrente):** hoje `const dup = recur ? null : findDuplicate(title)` pula
  recorrente. Passa a: se `recur` e achar pacote/tarefa recorrente recente de título
  parecido → **atualiza** `recurrence_rule`/`due_date`/`remind_at` da mãe/tarefa existente e
  **re-materializa** (apaga instâncias futuras não-concluídas e regenera), em vez de criar
  outra série. (Caso "ajusta o lembrete dos Depósitos" da Rose.)
- **B (ação `cancel`):** nova `action:'cancel'` no applier + marker `TASK_UPDATE` (ou
  `TASK_GROUP`): resolve por título no grupo, **só** tarefas/grupos `created_at` nas últimas
  24h e `status != done` (escopo seguro contra cancelar coisa antiga), soft-cancel
  (`status='cancelled'`). Cancelar uma mãe cancela as filhas (cascade no applier). Render:
  "🗑️ Removi: X".

## 7. Prompt — `group-chat-prompt.js`

Novo bloco "### Pacote / grupo de tarefas" documentando `<<TASK_GROUP>>` + **heurística**:
> Se o pedido tem um TEMA-PAI e vários SUB-ITENS (escolas, cartões, unidades, etapas) →
> **pacote** (`<<TASK_GROUP>>`). Se é UM item → tarefa solta (`<<TASK_UPDATE>>`). NUNCA crie
> várias tarefas soltas quando a pessoa pediu "grupo/pacote de tarefas com subtarefas".

E a regra do `cancel`: "se você duplicou/errou, use `cancel` pra remover você mesmo — NUNCA
peça pro Alf/usuário excluir no banco."

## 8. Reparo de dados (script one-off `scripts/repair-rose-groups.js`)

Usa o motor. Com OK do Alf (já dado):
1. **Conciliação de Cartões:** soft-cancel da árvore emaranhada (template `82ea87e7` +
   instância julho `e1eea34d` + todas as filhas); recria via `createTaskGroup` (mensal,
   group_day=1, 6 cartões com seus dias); re-aplica `done` nos 2 cartões concluídos
   (8516 Barra, 2270 EMLA do ciclo de junho).
2. **Planilha do financeiro do mês finalizada (Relatório):** cria pacote mensal (group_day=5)
   → subtarefas Recreio/Barra/CG (+ lembretes escalonados dias 2/3/4 conforme pedido);
   cancela as 4 tarefas soltas que o TOM criou.
3. **Aplicar cashbacks do mês anterior:** cria pacote mensal `weekend_adjust=previous_friday`
   → subtarefas Recreio/Barra/CG; cancela as 3 soltas.
4. Idempotente (checa se já recriado) + dry-run (`--dry`).

## 9. Testes

- **Motor** (`node --test`): grupo simples (mãe+filhas); mensal (template+instância+filhas+
  `recurrence_parent_id` corretos); `weekend_adjust` → RRULE esperada; `addSubtasksToGroup`
  insere nas duas mães; `ymd` fuso SP.
- **Applier**: dedup recorrente atualiza-no-lugar; `cancel` só pega recente+não-done.
- **Marker** (`group-chat-engine`/prompt): parse válido/ inválido; heurística pacote vs solta.
- **e2e VPS** grupo Financeiro: pedir um pacote pelo chat → card de confirmação + grupo
  visível no app + espelho WhatsApp; rodar o script de reparo → grupos da Rose corretos na UI.

## 10. Riscos

- **Materialização recorrente** é a parte sensível (já causou regressões). Mitiga: motor é
  porta FIEL do `createGroup` validado; testes cobrem os vínculos `recurrence_parent_id`;
  reparo via motor (não SQL solto); validação no preview antes de devolver pra Rose.
- **`addSubtasksToGroup` em ciclos futuros já materializados:** v1 não retro-preenche
  (documentado); aceitável (a nova subtarefa vale do ciclo corrente em diante).
- **`cancel` cancelar algo errado:** escopo de segurança (24h + não-done + dentro do grupo).
