# Snooze / silêncio de lembrete POR TAREFA — design

- **Data:** 2026-06-19
- **Status:** SPEC (aguarda OK / brainstorm do Alf — **não implementar**)
- **Origem:** Item #5 do audit 15/06 (ver `project_audit_0615_lotes`)
- **Caso-âncora:** Jereh — pediu "só me lembra às 15h" / "silêncio até as 15h" para **uma** tarefa, e o TOM continuou mandando lembrete ANTES das 15h.

---

## 1. Problema

Hoje, quando o usuário diz **"só me lembra às 15h"** ou **"para de me lembrar antes das 15h"** sobre uma tarefa, isso vira **apenas um ACK do LLM** ("Beleza!") — nenhuma ação é executada. A grade de lembretes já materializada (`task_reminders`, gerada a partir de `reminders_at[]`, tipicamente a cada 30/60 min) **continua disparando** normalmente antes das 15h.

É mais um caso da síndrome descrita em `project_tom_nega_capacidade`: o TOM "concorda" mas não tem motor para a ação, então o efeito prático é nulo. A diferença aqui é que **nem ACK derrotista existe** — o pedido simplesmente evapora.

### Por que o cron NÃO é o culpado (não mexer nele)

`checkTaskReminders` ([dispatcher.js:4926](../../../src/rituals/dispatcher.js)) já está correto:

- Filtra `sent_at IS NULL` + `remind_at <= now` ([L4931-4932](../../../src/rituals/dispatcher.js)).
- Respeita **DND** (defere sem consumir — `sent_at` fica `null`, retry no próximo tick) ([L4997-5002](../../../src/rituals/dispatcher.js)).
- Respeita **quiet** com `defaultNightGate:false` ([L5007-5011](../../../src/rituals/dispatcher.js)) — porque o horário do lembrete foi escolhido pelo próprio usuário; pedido explícito > janela noturna default.
- Guard de staleness `remind_at < created_at` (REMINDER-STALE-PAST) ([L4991-4996](../../../src/rituals/dispatcher.js)).

O ponto: **quiet/DND são GLOBAIS por colaborador**. O caso Jereh é **por-tarefa, em horário comercial** (não há quiet às 14h). Os rows `remind_at < 15h` têm `sent_at IS NULL` e `remind_at <= now`, então disparam — corretamente, do ponto de vista do cron.

**Conclusão:** não é gatear o cron. Falta uma **ação nova** que reorganize os `task_reminders` daquela tarefa quando o usuário pede o piso de horário.

---

## 2. Como funciona hoje (investigação read-only)

### 2.1 Dois caminhos de lembrete de tarefa

| Caminho | Tabela / campo | Cron | Semântica |
|---|---|---|---|
| **Grade** (multi) | `task_reminders` (N rows) | `checkTaskReminders` ([dispatcher.js:4926](../../../src/rituals/dispatcher.js)) | Vários alertas pré-prazo de uma tarefa real. Dispara WA, **não** mexe no status. **← é o caso Jereh.** |
| **One-shot** | `tasks.remind_at` (singular) | `checkReminders` ([dispatcher.js:5041](../../../src/rituals/dispatcher.js)) | "Me lembra de X em 30 min". Dispara WA; se a task **não** tem `due_date`, auto-conclui ([L5137](../../../src/rituals/dispatcher.js)). |

A distinção é feita no `applyTaskActions` na criação ([engine.js:4653-4658](../../../src/engine.js)): `reminders_at[]` → N rows em `task_reminders`; `remind_at` sozinho → campo one-shot em `tasks`.

### 2.2 Schema `task_reminders` (Supabase `cesnbnrynvxvgdhfmaua`)

| Coluna | Tipo | Nota |
|---|---|---|
| `id` | uuid (pk) | `gen_random_uuid()` |
| `task_id` | uuid (NOT NULL) | FK → tasks |
| `remind_at` | timestamptz (NOT NULL) | quando disparar |
| `sent_at` | timestamptz (nullable) | **NULL = pendente**; preenchido = consumido (enviado OU descartado) |
| `label` | text (nullable) | até 40 chars |
| `created_at` | timestamptz | `now()` |

**Não há** coluna de snooze/mute/floor. A grade é "append-only" na prática (só INSERT em [engine.js:4778](../../../src/engine.js); UPDATE só para marcar `sent_at`).

### 2.3 Caminho de escrita do engine = service_role (ignora RLS)

`checkTaskReminders` e o INSERT da grade usam o **mesmo `supabase`** (admin/service_role do engine). As policies RLS de `task_reminders` (INSERT/UPDATE/DELETE com `is_task_assignee`, migration `2026-06-07-fatiaE-...`, known issue **FATIA-E-REMINDER-RLS**) existem **para o PWA** (client authenticated), **não** para o engine. Ver `feedback_sensitive_data_service_role` e `reference_supabase_mcp`.

→ **Uma ação de snooze rodando no engine não precisa de migration RLS nova.** Mas, justamente por ignorar RLS, a **autorização** (quem pode silenciar qual tarefa) vira responsabilidade explícita da própria action.

### 2.4 Como o usuário "fala" hoje

- **Lembrete de tarefa:** marker `<<TASK_UPDATE>>` ([parseTaskUpdateMarker, engine.js:403](../../../src/engine.js)), validado por `validateTaskAction` ([engine.js:3346](../../../src/engine.js)) contra `VALID_TASK_ACTIONS` = `complete, cancel, reschedule, create, delegate, extension_request, extension_decision, governance_reassign` ([engine.js:143](../../../src/engine.js)). Toda action aceita `id` (short-id) **ou** `title` (resolve `title→id` no `applyTaskActions`). Skill: `checklist-tarefas.md`.
- **Silêncio / preferências GLOBAIS:** marker `<<PREFS_UPDATE>>` (`parsePrefsMarker` no engine), persistindo em `user_preferences` (`quiet_days`, `quiet_start_time`, e — desde o fix **TASKCHECKIN-NOOFF-DEFEATIST**, 15/06 — `task_checkin_times`, array `HH:MM`, `[]` = desligar). Skill: `configurar-preferencias.md`.

→ **Não existe hoje** nenhuma action/marker que mexa em `task_reminders` por-tarefa a pedido do usuário (snooze / clear / silenciar). É feature nova (confirmado: nenhum known issue de "snooze por-tarefa").

### 2.5 Reuso disponível

`src/services/reschedule-reminders.js` (funções puras, testadas):
- `shiftTaskRemindAt(oldDue, newDue, remindAtIso)` — desloca `tasks.remind_at` por delta de **dias** (preserva a hora). TASK-RESCHED-ONESHOT.
- `shiftRemindersByReschedule(reminders, oldStartIso, newStartIso)` — desloca `event_reminders` por delta exato. RESCHED-REMINDER.

Nenhuma das duas faz exatamente o que a feature precisa (estabelecer um piso de horário), mas o módulo é o lar natural de um novo helper puro.

---

## 3. Protocolo de bugs — caso-irmãos consultados (`tom_known_issues`)

| Código | Relação com esta feature |
|---|---|
| **TASKCHECKIN-NOOFF-DEFEATIST** (15/06) | Padrão **exato** de "desligar lembrete por chat", porém GLOBAL (`task_checkin_times` via `PREFS_UPDATE`). Modelo de UX/anti-derrotismo a espelhar. |
| **REMINDER-STALE-PAST** (10/06) | Mexeu no `checkTaskReminders` (staleness + janela noturna). A ação nova **não pode** criar row com `remind_at < created_at` (seria consumido pelo guard). |
| **FATIA-E-REMINDER-RLS** (07/06) | RLS de `task_reminders` é do PWA, não do engine (ver §2.3). |
| **TASK-RESCHED-ONESHOT** (04/06) | `reschedule-reminders.js` já existe e é o lar do helper novo. |
| **BULK-RECUR** (01/06) | A grade pode ter muitos rows; cuidado com "amontoar" (ver Abordagem B rejeitada). |

→ **Nenhuma regressão.** Feature genuinamente nova.

---

## 4. Abordagens consideradas

### A — CLEAR-abaixo-do-piso + ensure-one ✅ **RECOMENDADA**

Mexe só nos **rows** de `task_reminders` da tarefa-alvo:
1. **Clear:** marca `sent_at = now()` nos rows pendentes (`sent_at IS NULL`) com `remind_at < piso` — "consome sem enviar", exatamente o padrão já usado no guard de staleness e no branch done/cancelled ([dispatcher.js:4984,4993](../../../src/rituals/dispatcher.js)).
2. **Ensure-one:** se, após o clear, **não** restar nenhum row pendente com `remind_at >= piso` no dia-alvo, INSERT 1 row em `piso` (atende "só me lembra às 15h").
3. **One-shot:** se a tarefa usa `tasks.remind_at` e ele é `< piso` e `reminded_at IS NULL`, seta `tasks.remind_at = piso`.

**Prós:** alinhado ao "não gatear o cron"; reusa padrão existente (`update sent_at`); zero migration; zero coluna nova; determinístico e idempotente; preserva a grade que já existia acima do piso.
**Contras:** "consome" rows passados (não recupera a grade antiga — mas é o comportamento desejado).

### B — Reschedule (mover rows < piso para o piso) ❌

Desloca cada row `< piso` para `piso`. **Rejeitada:** amontoa N rows no mesmo instante → o usuário recebe 8 mensagens às 15h. Para evitar isso teria que deduplicar, virando A na prática.

### C — Nova coluna gate (`reminders_floor_at` em `tasks`) ❌

Adiciona coluna e faz `checkTaskReminders`/`checkReminders` pularem rows abaixo do piso. **Rejeitada:** é literalmente "gatear o cron", que o Alf descartou; mexe em área sensível (REMINDER-STALE-PAST é recente); migration + 2 pontos de cron alterados. Mais invasiva sem ganho real sobre A.

> **Recomendação:** **Abordagem A.** É a leitura literal do pedido ("AÇÃO NOVA de snooze/clear de `task_reminders` por-tarefa") e a de menor superfície de risco.

---

## 5. Design recomendado (Abordagem A)

### 5.1 Regra explícita

> Dado o pedido **"só me lembra às Xh"** / **"para de me lembrar antes das Xh"** / **"não me lembra mais dessa tarefa (hoje)"** sobre **uma tarefa identificável**, o TOM estabelece um **piso de horário** (`not_before`) para os lembretes **daquela tarefa**:
> - silencia (consome sem enviar) todo lembrete pendente com `remind_at < not_before`;
> - garante **pelo menos um** lembrete em `not_before` (quando o pedido tem hora) se nada pendente sobrou em/depois do piso;
> - **não** altera o prazo (`due_date`/`due_time`), **não** conclui a tarefa, **não** mexe em preferências globais.

Modo "silenciar tudo" (sem hora): consome todos os pendentes da tarefa, sem criar novo.

### 5.2 Marker / action

Nova action **`snooze_reminders`** dentro do marker existente `<<TASK_UPDATE>>`:

```
<<TASK_UPDATE>>
{ "action": "snooze_reminders", "id": "<short-id>" | "title": "<título>",
  "not_before": "2026-06-19T15:00:00-03:00",   // piso (ISO 8601 c/ tz). Omitir = silenciar tudo.
  "clear_all": false }                          // true (ou not_before ausente) = silenciar todos, sem ensure-one
<<END>>
```

- Resolução de alvo: **reusa** o mecanismo `id` OU `title` das actions existentes (`complete`/`reschedule` já fazem `title→id`). Zero invenção.
- `not_before`: o LLM resolve "às Xh" → ISO com `-03:00` usando a âncora temporal já existente do prompt (`resolveTemporalRef`/auto-align). Validação **em BRT** (ver `project_localymd_utc_shift` e known issue AMANHA-POS-MEIA-NOITE).

### 5.3 Onde aplica (pontos de extensão, todos FORA do Balde A)

1. `VALID_TASK_ACTIONS` ([engine.js:143](../../../src/engine.js)) — adicionar `'snooze_reminders'`.
2. `validateTaskAction` ([engine.js:3346](../../../src/engine.js)) — branch novo: exige `id|title`; exige `not_before` ISO válido **OU** `clear_all === true`.
3. `applyTaskActions` (engine.js) — branch novo que executa o fluxo §5.4 (chama o helper puro).
4. `src/services/reschedule-reminders.js` — novo helper puro `planReminderFloor({ rows, taskRemindAt, taskRemindedAt, notBefore, clearAll, nowIso })` → retorna `{ toConsume: [ids], toInsert: [{remind_at,label}], taskRemindAtUpdate: iso|null }`. Testável isolado (sem DB).
5. `skills/checklist-tarefas.md` — regra de quando emitir `snooze_reminders` + **veto anti-app** (`project_tom_nega_capacidade`): nunca "vai no app desligar"; o TOM TEM a ação. Confirmação humana: "Limpei os lembretes dessa tarefa até as 15h — te chamo só às 15h."
6. (opcional) `skills/configurar-preferencias.md` — 1 linha apontando: "silenciar UMA tarefa é `snooze_reminders` (por-tarefa); silêncio recorrente/global continua em `quiet_*`."

### 5.4 Fluxo de execução (`applyTaskActions`)

```
1. Resolve task (id|title). Não achou / ambíguo → erro amigável (NÃO confabular).
2. Autorização: a task pertence ao remetente (assigned_to/created_by) ou ao grupo do remetente. Senão → recusa.
3. Busca rows pendentes: task_reminders WHERE task_id=? AND sent_at IS NULL.
4. clearAll (ou not_before ausente):
     → UPDATE sent_at=now() em TODOS os pendentes. Fim (sem ensure-one).
5. not_before presente:
     a. UPDATE sent_at=now() nos pendentes com remind_at < not_before.   (clear)
     b. Se NENHUM pendente restou com remind_at >= not_before  E  not_before > now:
          INSERT row { task_id, remind_at: not_before, label: <herda do último limpo|null> }.  (ensure-one)
        Se not_before <= now: NÃO cria no passado; TOM avisa e oferece outro dia.
     c. One-shot: se tasks.remind_at < not_before E tasks.reminded_at IS NULL:
          UPDATE tasks.remind_at = not_before.
6. Responde verbatim-friendly o que foi feito (quantos silenciados, próximo lembrete).
```

---

## 6. Diferença clara para o silêncio GLOBAL (não duplicar)

| Eixo | `quiet_hours`/`quiet_start_time`/`quiet_days` | `task_checkin_times` | **`snooze_reminders` (novo)** |
|---|---|---|---|
| Escopo | Colaborador inteiro | Colaborador inteiro | **1 tarefa** (`task_id`) |
| Duração | Recorrente (toda noite / dia marcado) | Recorrente (grade diária) | **Pontual / one-off** |
| Persistência | `user_preferences` | `user_preferences` | **`task_reminders` (dados); zero prefs** |
| O que afeta | TUDO (proativos, rituais, reminders) | check-ins de horário | **só os lembretes daquela tarefa** |
| Como o cron trata | `isQuietNow` defere (não consome) | grade própria | rows consumidos/criados; **cron intacto** |
| Marker | `<<PREFS_UPDATE>>` | `<<PREFS_UPDATE>>` | `<<TASK_UPDATE>>` |

**Regra de não-sobreposição:** se o usuário pede silêncio **recorrente** ("toda noite", "domingos", "nunca de manhã") → continua sendo `quiet_*` global via `PREFS_UPDATE`. `snooze_reminders` é **só** para "essa tarefa, agora". As duas camadas são ortogonais e compõem (depois do snooze, os rows restantes ainda passam pelo gate de quiet/DND normalmente).

---

## 7. Edge cases

1. **Piso já passou hoje** (são 16h, pediu "às 15h"): faz o clear normalmente, mas **não** cria row no passado (ensure-one só com `not_before > now`); TOM avisa "já passou das 15h, quer pra amanhã?".
2. **BRT sempre:** resolver "às Xh"/"amanhã" em America/Sao_Paulo; pós-meia-noite usa dia civil (AMANHA-POS-MEIA-NOITE; `project_localymd_utc_shift`).
3. **Idempotência:** 2ª chamada igual = no-op (rows `< piso` já consumidos; ensure-one vê o row `>= piso` e não duplica).
4. **Não colidir com REMINDER-STALE-PAST:** o row do ensure-one tem `remind_at = not_before` (futuro) > `created_at` → o guard de staleness não o mata. (Garantido por `not_before > now`.)
5. **Tarefa de grupo** (`assigned_group_id`): a action opera por `task_id` (vale para a grade do grupo, que faz fan-out). Autorização = membro do grupo. Decidir no brainstorm se "silenciar tarefa do grupo" some para **todos** ou se é por-pessoa (hoje a grade é uma só, compartilhada → some para todos).
6. **Não é reschedule:** `snooze_reminders` **não** altera `due_date`/`due_time` nem conclui a tarefa. Se o usuário quer mudar o prazo, isso é `reschedule` (action separada).
7. **One-shot já disparado** (`reminded_at` preenchido): nada a silenciar; TOM responde que o lembrete já foi.
8. **Sem hora e sem "tudo"** ("me lembra mais tarde"): **fora do escopo v1** — TOM pede a hora (não usar `active-window` aqui; YAGNI). Reavaliar depois.

---

## 8. Restrições

- **NÃO implementar.** Aguarda OK / brainstorm do Alf (`feedback_brainstorm_before_big_features`).
- **HOLD de deploy ativo** (`.deploy-hold`): nada de deploy/SCP/restart.
- **Balde A intocável:** esta feature **não** toca `recurrence-engine.js`, `utils/recurring-dedup.js`, `utils/task-update-result.js`, o `complete`/`cancel` `scope:"series"` do `engine.js`, nem o dedup em `system.js`/`dispatcher.js`. Opera **na instância materializada** (`task_id` concreto) — **nunca** no template/série de recorrência. (Área vizinha sob observação — ver `project_recurrence_lifecycle_rootcause`.)
- **Escrita via service_role** (engine ignora RLS) — sem migration RLS; **autorização explícita na action** (§5.4 passo 2).
- **PT-BR** em toda comunicação.

---

## 9. Pontos para o brainstorm do Alf decidir

1. **Nome da action/campo:** `snooze_reminders` + `not_before` está bom, ou prefere `mute_before`/`reminders_floor`?
2. **`clear` = `sent_at=now()` (consome, mantém histórico) vs `DELETE` (limpa de vez)?** Recomendo `sent_at` (espelha o código atual e preserva auditoria).
3. **Tarefa de grupo:** silenciar some para **todos** os membros (grade única) ou por-pessoa? (Hoje a grade é compartilhada.)
4. **Modo "silenciar tudo"** (`clear_all`): incluir no v1 ou só o piso com hora?
5. **Escopo do one-shot** (`tasks.remind_at`): cobrir no v1 (recomendo) ou só a grade `task_reminders`?
6. **Semântica de "só às Xh":** tratar como **piso** (limpa antes, mantém a grade depois — recomendo, é o menos destrutivo) ou como **exclusivo** (exatamente 1 lembrete em X, limpando também os posteriores)? "para de me lembrar antes das Xh" é inequivocamente piso; "só às Xh" é o ambíguo.

---

## 10. Plano de validação (quando for implementar — fora deste escopo)

- Teste unitário puro do helper `planReminderFloor` (sem DB): grade de 8 rows, piso no meio → 4 consumidos, 4 mantidos, ensure-one não dispara; grade toda abaixo do piso → todos consumidos + 1 criado em `not_before`; piso no passado → clear sem criar; `clear_all` → todos consumidos.
- Reproduzir o caso Jereh no Preview / E2E na VPS (`node --env-file=.env`) antes de qualquer deploy.
- Registrar em `tom_known_issues` ao concluir (código sugerido: `TASK-REMINDER-SNOOZE-PERTASK`).

---

## Referências de código

- `src/rituals/dispatcher.js:4926` — `checkTaskReminders` (grade)
- `src/rituals/dispatcher.js:5041` — `checkReminders` (one-shot)
- `src/engine.js:143` — `VALID_TASK_ACTIONS`
- `src/engine.js:403` — `parseTaskUpdateMarker`
- `src/engine.js:3346` — `validateTaskAction`
- `src/engine.js:4653-4781` — materialização de `reminders_at[]` → `task_reminders`
- `src/services/reschedule-reminders.js` — helpers puros de deslocamento
- `skills/checklist-tarefas.md`, `skills/configurar-preferencias.md`
