# Auditoria de Arquitetura — Fatia A: `src/engine.js` (14.671 linhas)

Metodologia: varredura estrutural via Grep/regex sobre o arquivo inteiro (todas as `function`
top-level mapeadas), leitura direta das seções críticas (parsers/validators de TASK_UPDATE e
EVENT_CREATE, cadeia de intercepts pré-LLM, chokepoint de honestidade pós-LLM), e contagem
quantitativa (catch blocks, console.warn, requires). Todo achado abaixo tem `engine.js:linha`
conferível. Não modifiquei nenhum arquivo.

---

## 1. MAPA ESTRUTURAL

### 1.1 Blocos do arquivo (ordem física, não de execução)

| Faixa de linhas | Conteúdo | Natureza |
|---|---|---|
| 1–230 | requires (81 módulos externos), constantes de validação (`ISO_DATE_RE`, `SHORT_ID_RE`, `VALID_TASK_ACTIONS`, `VALID_EVENT_MODALITIES`...), helpers de onboarding/skill/ritual, `logMarker` (grava em `marker_logs` — a tabela que a dor de 30 dias mede) | Setup |
| 236–1053 | Parsers+appliers: `MEMORY_SAVE`, `PROJECT_CREATE`, `TASK_UPDATE` (434), `CHECKPOINT_BATCH`, `CHECKLIST_ACTION`, `CHECKLIST_ATTACHMENT`, `DERIVE_TASK`, `CHECKLIST_JUSTIFY`, `ANNOUNCEMENT_ACTION/APPROVAL` | Parse+validate+apply por marker (padrão repetido) |
| 1053–2313 | `applyAnnouncementAction` (1053), evento: `buildEventAnnouncementsNode`, `buildEventTaskKit`, `SCHOOL_EVENT_ACTION`, **`COORDINATION_REQUEST`/`RESPONSE`** parse+apply (1543–2057) | Comunicados + coordenação |
| 2193–2792 | **`EVENT_CREATE`**: `inferEventCategory` (2198), `validateEventItem` (2216), `parseEventCreateMarker` (2261), `applyEventActions` (2313–2702), `validateEventUpdateAction`/`parseEventUpdateMarker` | Núcleo de eventos |
| 2785–3257 | `PROJECT_APPROVE/REJECT`, `resolveEventByShortId`, `applyRsvp`, `applyPersonalListActions` | Aprovações + RSVP |
| 3257–3608 | `applyEventUpdates` (reschedule/cancel/complete/update de evento já criado) | Update de evento |
| 3608–3735 | **`validateTaskAction`** (3608) — validação de schema do `TASK_UPDATE` | Núcleo de tarefas (validação) |
| 3735–4330 | Resolução de colaborador por nome/telefone/short-id, gates pedagógicos (`canDelegatePedagogical`), `PREFS_UPDATE` | Helpers de identidade/permissão |
| **4330–5927** | **`applyTaskActions`** — ~1.600 linhas, um único `if/else if` por `action` (complete/cancel/reschedule/create/delegate/extension_*/governance_reassign/snooze_reminders/return/mark-item) | **Núcleo de tarefas (aplicação) — maior função "de negócio" do arquivo** |
| 5927–6069 | `persistMemoryRows`, `persistProject` | Persistência genérica |
| 6069–6515 | `HABIT_ACTION` completo: parse (6069), `validateHabitAction` (6107), resolução por short-id/nome, streak, `applyHabitActions` (6322–6515) | Hábitos |
| 6515–6961 | `DND_SET`, `WEEKLY_PLAN`, onboarding persist, bloco de "accountability score" (`_accQ1..Q4`, `_accScoreFocus`) | DND/planning/score |
| 6961–7429 | Contexto de coordenação ativa, **detecção de duplicata** (temporal/semântica p/ evento e tarefa — `detectTemporalConflict`, `detectDuplicateSemanticEvent/Task`), `tryHandleAnnouncementConfirmation`, `tryDupBypass` | Anti-duplicata (usado pelos intercepts) |
| 7429–7731 | `FINANCE_ACTION` parse (7445/7469), categorização, `stageLaunches`, `stagePayInvoice` | Finanças (parse, tolerante) |
| **7731–8481** | **`handleFinanceAction`** — ~750 linhas, dispatcher de 25+ ações financeiras | Núcleo financeiro (aplicação) |
| **8481–13067** | **`processMessage`** — ~4.587 linhas, **o pipeline inteiro de uma mensagem** (ver 1.2) | **God function** |
| 13068–14000 | Rituais (`sendRitual`), relatórios (`buildTeamSummary`, `buildWeeklyRetrospective`), consolidação de memória, resumo semanal | Cron/relatórios (fora do caminho de mensagem) |
| 14000–14671 | `MONTHLY_PLAN`, `SHOP_ACTION` (loja/inventário via chat) | Módulos menores, mais recentes |

### 1.2 Ordem de execução dentro de `processMessage` (o pipeline real)

`processMessage(phone, text, raw)` roda, em sequência:

1. **8481–8520** — decompositor de áudio longo (mini-LLM se transcript grande), classificação de intenção (`classifyIntent`, feature-flag `TOM_MAPA`), resolução do colaborador por telefone (`8520`: se não achar, `return` imediato com mensagem genérica).
2. **8530–8550** — leitura única de `pending_intents` abertos (`_openIntents`) — estado compartilhado pelo resto da função.
3. **8481–10416 — cadeia de ~25 intercepts determinísticos, cada um podendo `return` antes do LLM.** Rodam em sequência fixa; a ORDEM importa (comentários no próprio código confirmam isso — ex. linha 8767: "sem o LLM chutar contra a intent concorrente mais fresca"). Nomeados por incidente histórico, em ordem física/aproximada de execução:
   - `undo_launch` determinístico (8538–8550)
   - `TASK-RESCHEDULE-CONFIRM-NOOP` resume (8552–8588)
   - `EVENT-CREATE-CONFIRM-NOOP` resume (8588+)
   - **Closing-interceptor** (fechamento numerado) + sub-guards `CLOSING-INTERCEPTOR-OVERCAPTURE`, `CLOSING-FRESHER-OUTBOUND-BIND`, `CLOSING-CANCEL-IGNORED` (8767–8895)
   - RSVP bare + guard `BUG-JORDAN` (8903–8948)
   - Funil de vocabulário de aprovação (Fase F2) + `FIN-CONFIRM-CONFAB-NOOP` (8948–9054)
   - Fechamento de projeto confirm-first (`KRISSYA-PROJECT-CLOSE-NO-HANDLER`, 9130)
   - Detectores financeiros: guard `FINEDIT-QUOTE-SCAFFOLD-MISROUTE` (9231), fatura/comprovante/boleto/PIX intercepts (9340–9840, múltiplos blocos: `[Fatura] intercept A/A0/B`, `[Boleto] intercept`, `[PIX] intercept`), desambiguação de cartão (9632–9780)
   - `ReplyRef` interceptor / `TASKDONE-QUOTE-REMINDER-NOOP` (9809–9837)
   - `GUARD-CONFIRM-LOOP`, `CONFIRM-ANCHOR-WRONGBIND`, `BATCH-COMPLETE-CONFIRM-NOOP`, `COORD-CONFIRM-NOOP` (9851–9975) — todos ligados ao velocímetro `CONFAB_NOEXEC`
   - `COORD-RESPONSE-STATE-STUCK` / `COORD-RESPONSE-WRONG-BIND` recency gate (10347–10416)
4. **10434–10472** — monta o system prompt (`buildSystemPrompt`) e injeta hints de contexto.
5. **`10472`: `response = await ai.chat(systemPrompt, msgs)` — A ÚNICA chamada ao LLM no turno normal.** Tudo antes é pré-LLM; tudo depois é pós-LLM.
6. **10472–12869 — parse e dispatch dos markers da resposta**, em ordem: `TASK_UPDATE` (10608) → `EVENT_CREATE` (10922) → `CHECKLIST_ACTION/ATTACHMENT/JUSTIFY` (11217–11283) → `ANNOUNCEMENT_ACTION/APPROVAL` (11283–11360) → `COORDINATION_REQUEST` (11949) → `FINANCE_ACTION` (12282–12330) → limpeza de markers desconhecidos (`UNKNOWN_MARKER_STRIPPED`, 12468–12491) → métrica `ACTIONABLE_NO_MARKER` + **auto-retry mecânico só-de-TASK_UPDATE** (12652–12800, ver §3).
7. **12869–12939 — `CONFAB-NOMARKER-CHOKEPOINT`**: gate universal de honestidade que roda por ÚLTIMO, sobre a reply já montada, e pode reescrevê-la (`redirected`) se detectar que o TOM prometeu algo que não persistiu.
8. Envio da resposta, log outbound, métricas.

**Achado de mapa**: o pipeline é linear e de fato tem uma ordem clara — mas essa ordem vive inteiramente em comentários e na posição física do código dentro de uma função de 4.587 linhas, não em uma estrutura declarativa (lista de handlers, prioridade explícita). Qualquer reordenação futura (inserir um novo intercept) depende de o autor ler e entender ~2000 linhas de contexto sequencial pra saber onde encaixar.

---

## 2. PONTOS DE QUEBRA

**P1 — Três "god functions" concentram quase todo o risco.**
`processMessage` (`engine.js:8481-13067`, ~4.587 linhas), `applyTaskActions` (`engine.js:4330-5927`, ~1.600 linhas) e `handleFinanceAction` (`engine.js:7731-8481`, ~750 linhas) somam ~7.000 das 14.671 linhas do arquivo. `applyTaskActions` é um único `if/else if` por `action` com 74 pontos de `failCount++`/`REJECTED` diferentes (contagem exaustiva feita via scan) — nenhum deles isolável ou testável fora da função inteira.

**P2 — Zero teste unitário para o que fica dentro de `engine.js`; 210 testes para tudo que já foi extraído.**
`Glob` por `*.test.js` no repo encontra 210 arquivos de teste, um para praticamente cada módulo em `src/finance/*`, `src/lib/*`, `src/coordination/*`, `src/events/*` (ex.: `src/lib/dup-choice.test.js`, `src/coordination/coord-recency.test.js`, `src/finance/launch-confirm.test.js`). Não existe `engine.test.js` nem qualquer teste para `parseTaskUpdateMarker`, `validateTaskAction`, `applyTaskActions`, `parseEventCreateMarker`, `validateEventItem`, `applyEventActions` ou `processMessage`. Isso não é acidente — é o padrão comprovado do próprio time: toda vez que lógica sai de `engine.js` para um arquivo dedicado, ela ganha teste. O que ainda mora em `engine.js` é exatamente o que nunca foi testado — e é validado hoje só por incidente em produção (ver os ~40 nomes de bug tipo `CLOSING-INTERCEPTOR-OVERCAPTURE`, `COORD-RESPONSE-WRONG-BIND` espalhados pelos comentários).

**P3 — 297 blocos `catch` no arquivo; 51 são vazios/silenciosos na mesma linha (`catch (_) {}` ou comentário só).**
Contagem exaustiva (regex sobre o arquivo inteiro). Exemplos concretos de catch silencioso em caminho de notificação (não é só telemetria):
- `engine.js:8997` — `try { await whatsapp.sendMessage(mp.requester_phone, ...aprovada...) } catch (_) {}` — se o envio falhar, ninguém sabe que a aprovação de manutenção não chegou ao solicitante.
- `engine.js:9003` — mesmo padrão para rejeição de manutenção.
- `engine.js:11713` — notificação a aprovador de manutenção, mesmo padrão.
- `engine.js:12905` — catch vazio dentro do próprio bloco do chokepoint de honestidade (a trava que existe pra pegar mentira do TOM tem, ela mesma, um ponto cego).

**P4 — Validação duplicada e já divergente: regra de reschedule existe em dois lugares com duas implementações diferentes.**
`validateTaskAction` (`engine.js:3644-3646`) exige `new_due_date` (via `ISO_DATE_RE`) OU `new_remind_at` pra aceitar a action no schema. `applyTaskActions` (`engine.js:4772-4778`) refaz a MESMA checagem com OUTRA função (`isValidISODate`, definida em `engine.js:5983`, não confirmada como idêntica a `ISO_DATE_RE`). Efeito colateral concreto: se `new_due_date` existe mas falha em `isValidISODate` **e** `new_remind_at` também existe e é válido, nenhum `else if` das linhas 4772-4778 dispara — `update.due_date` fica silenciosamente sem ser setado (nem erro, nem `failCount++`, nem log), só o remind_at é aplicado. Regra duplicada em dois pontos = drift silencioso, exatamente o padrão que a MEMÓRIA do projeto já cataloga (`project_categorizacao_fatura.md`, `project_boleto_conta_pagar.md`: "kind novo = 2 portas").

**P5 — Estado implícito compartilhado via `Map` em memória de processo.**
`pendingDupEvents` e `pendingDupTasks` (`engine.js:184-185`) são `Map`s globais no módulo, chaveados por `collaboratorId`, usados pelo fluxo de "microconfirmação 1/2/3" de duplicata. Não são persistidos — um restart do PM2 (ou rodar 2 réplicas) perde o estado pendente sem aviso, e a *mesma* classe de problema (estado que devia ser DB mas é `Map`) já causou incidentes de recorrência documentados na memória do projeto.

**P6 — O gate de honestidade final (`CHOKEPOINT`) é uma pilha de heurísticas de regex acumuladas incidente-a-incidente, sem teste, decidindo se a resposta do LLM é confabulação.**
`engine.js:12630-12683`: `ACTIONABLE_RE`, `REPLY_PROMISE_RE`, `hasTrailingQuestion`, `isInfoGatheringReply`, mais duas regex **inline** só ali (`_replyIsDecline` linha 12650, `_inputSelfReport` linha 12658) — cada uma nasceu de um caso real (comentários citam "Bug 01/06 Esfera/Grava", "Sprint 31.10"). É lógica de linguagem natural em português, sensível a pontuação/negação/pergunta, sem suíte de teste dedicada dentro de `engine.js` (ao contrário de `promise-honesty.js`/`reply-classify.js`, que SÃO módulos com teste — mas a composição final delas, aqui, não tem).

**P7 — Auto-repair pós-falha existe só pra `TASK_UPDATE`, criando assimetria estrutural com `EVENT_CREATE`.**
Quando `ACTIONABLE_NO_MARKER` dispara com promessa explícita, o engine faz uma SEGUNDA chamada de LLM (mini-prompt "conversor mecânico", `engine.js:12688-12739`) que só sabe emitir `<<TASK_UPDATE>>` (exemplos hard-coded nas linhas 12725/12734). Não existe equivalente para `EVENT_CREATE` — o que é consistente com `EVENT_CREATE` ter a pior taxa de rejeição (16,7%) sem nenhuma rede de segurança de segunda chance.

---

## 3. POR QUE `TASK_UPDATE` E `EVENT_CREATE` FALHAM TANTO

O contrato documentado no próprio arquivo (`engine.js:160-164`) é **fail-closed por design**: schema inválido → `malformed: true` → nenhum side effect. Isso é uma escolha de segurança correta, mas tem DOIS portões independentes que cada um pode rejeitar, e a métrica de "rejeitado" mistura os dois:

**Portão 1 — validação de schema no parse** (`validateTaskAction` `engine.js:3608-3726`, `validateEventItem` `engine.js:2216-2259`): enums fechados (`VALID_TASK_ACTIONS`, `VALID_EVENT_MODALITIES`), regex ISO estritas (`SHORT_ID_RE`, `ISO_DATE_RE`, `ISO_DATETIME_RE` — esta última exige timezone explícito, `engine.js:205`), campos obrigatórios por tipo de ação (11 branches de `action` diferentes para task, cada uma com sua própria lista de campo obrigatório). `EVENT_CREATE` tem MAIS obrigatoriedade cruzada que `TASK_UPDATE`: título + `start_at` válido + `end_at` (com fallback, mas ainda checado) + `modality` + checagem de contradição (`presencial_with_meeting_url`, `engine.js:2244`) + `end_before_start` (`engine.js:2226`) — mais "jeitos de errar" por item, o que é consistente com a pior taxa (16,7% vs 14,1%).

**Portão 2 — resolução/permissão no apply, que `FINANCE_ACTION` majoritariamente NÃO tem**: uma vez que o marker passa no schema, `applyTaskActions`/`applyEventActions` ainda podem rejeitar por:
- **Resolução de short-id restrita e sem desambiguação** (`resolveTaskByShortId`, `engine.js:3816-3857`): busca só tarefas com `assigned_to = collaboratorId` (+ tarefas de grupos de trabalho do remetente) dos ÚLTIMOS 60 DIAS (`engine.js:3821,3826`). Se o LLM referenciar um id de tarefa fora dessa janela, delegada para outra pessoa, ou já concluída/fora do filtro, o resultado é `null` → **"REJECTED — not owned or not found"**. E se o prefixo hex curto colidir com mais de uma tarefa (`matches.length > 1`, `engine.js:3852-3855`), a função **rejeita tudo** em vez de tentar desambiguar — sem fallback.
- Dos 74 pontos de falha catalogados em `applyTaskActions` (scan exaustivo), a esmagadora maioria segue o padrão `"REJECTED id=... (not owned by X or not found)"` — presente em `complete` (4423), `cancel` (4672), `reschedule` (4766), `snooze_reminders` (4901), `delegate` (5651), `extension_request` (5506), `mark-item` (4943) — ou seja, **a causa dominante e repetida é resolução de ID/posse falhando**, não formato de JSON.
- Gates de permissão adicionais: `create-for-other` exige aprovação de `taskGate`/`evGate` (`engine.js:5066`, `2438`) — Farmer/director bloqueado por regra de Sprint 28 mencionada em comentário.

**Por contraste, `FINANCE_ACTION` (1,3% de rejeição) valida quase nada no parse** — `parseFinanceMarker`/`parseFinanceMarkers` (`engine.js:7445-7487`) só checam se `action` (após `canonFinanceAction`, um normalizador de aliases) está na lista `FINANCE_ACTIONS`; não há checagem de campo obrigatório, formato de data, ou enum de `params` no parser. A validação de categoria (`safeCategory`, `engine.js:7494`) tem fallback (nunca rejeita, sempre mapeia pra algo). Ou seja: **finanças é tolerante por design (canonicaliza + tenta corrigir); tarefa/evento são estritos por design nos dois portões — e o segundo portão (resolução de ID + posse) não existe de forma comparável em finanças.** Essa assimetria estrutural — não "bug" pontual — é a explicação central da diferença de taxa entre os dois grupos.

---

## 4. PROPOSTA DE FATIAMENTO POR FEATURE

Ordem recomendada = maior dor resolvida primeiro, com o menor raio de explosão possível, seguindo o padrão que ESTE MESMO time já provou funcionar 60+ vezes (todo módulo extraído em `services/`, `lib/`, `finance/`, `coordination/` ganhou teste; o que ficou em `engine.js` nunca ganhou).

1. **FATIA 1 — `EVENT_CREATE`** (`validateEventItem`+`parseEventCreateMarker`+`applyEventActions`, `engine.js:2198-2702`, ~500 linhas). Risco **BAIXO**: bloco fisicamente contíguo, poucas dependências cruzadas, já isolável hoje. Maior taxa de rejeição do lote (16,7%) e ainda sem rede de segurança (P7) — extrair é o momento natural de decidir se vale dar a ele o mesmo auto-retry que `TASK_UPDATE` tem. Ganho rápido e mensurável, baixo risco de regressão.
2. **FATIA 2 — Chokepoint de honestidade** (`engine.js:12447-12939`, ~500 linhas, incluindo `ACTIONABLE_NO_MARKER` e `CONFAB-NOMARKER-CHOKEPOINT`). Risco **MÉDIO-ALTO** (é heurística de linguagem natural, sensível), mas é código COMPARTILHADO por todos os markers — extraído e testado agora, sem mudar comportamento, ele deixa de ser terreno movediço para as fatias seguintes (task/coordenação), que hoje reabrem esse arquivo toda vez que investigam uma rejeição. Fazer isso ANTES da Fatia 3 (task) reduz o risco dela.
3. **FATIA 3 — `TASK_UPDATE`** (`validateTaskAction`+`parseTaskUpdateMarker`+`applyTaskActions`, `engine.js:3608-3726` + `4330-5927`, ~1.700 linhas). Risco **MÉDIO**: é a maior fatia (maior volume absoluto de dor, 411 usos/14,1%), mas o `if/else if` por `action` já é uma fronteira natural de decomposição em 11 sub-módulos testáveis (complete/cancel/reschedule/create/delegate/extension_*/governance_reassign/snooze/return/mark-item). Prioridade alta por volume, mas depois das duas fatias menores acima porque é on de mais coisa pode quebrar.
4. **FATIA 4 — `COORDINATION_REQUEST`/`RESPONSE`** (`engine.js:1543-2057`, `1640-1831`, dispatch em `11949-12140`). Risco **MÉDIO**: terceiro maior volume (99 usos/11,1%), mas acoplado a gates de permissão (`hasCoordLevel`, `canDelegatePedagogical`) que precisam de teste de regressão cuidadoso antes de mexer.
5. **FATIA 5 — Cadeia de intercepts pré-LLM** (`engine.js:8481-10472`, os ~25 guards nomeados). Risco **ALTO** — deixar por último de propósito: é aqui que ordem errada quebra tudo (o próprio código admite isso em comentário), o acoplamento via `_openIntents`/`_metrics`/`text` mutável é denso, e não há hoje nenhum teste de integração do pipeline inteiro. Extrair exige primeiro caracterizar (testes de aprovação) o comportamento atual guard-a-guard antes de mover uma linha.
6. **NÃO MEXER AGORA — `handleFinanceAction`** (`engine.js:7731-8481`) e `HABIT_ACTION` (`engine.js:6069-6515`). Finanças tem a MENOR taxa de rejeição (1,3%) — não é "o que mais quebra" — e a memória do projeto já registra que é a área com mais histórico de bugs e é recurso disputado entre dois chats concorrentes (`.deploy-hold`). Mexer nela agora por "arquitetura" sem dor atual que justifique é risco sem retorno proporcional. `HABIT_ACTION` tem volume baixo (19 usos) — pegar como fatia oportunista de baixo custo quando sobrar tempo, não como prioridade.

Cada fatia acima é testável de forma independente porque o padrão de teste já existe no repo (ex.: `src/lib/dup-choice.test.js`) — o trabalho real de cada fatia é (a) mover parse+validate+apply pra um arquivo `src/markers/<nome>.js`, (b) escrever testes de caracterização ANTES de qualquer mudança de comportamento, (c) `processMessage` passa a só chamar `require('./markers/<nome>').dispatch(...)`.

---

## 5. O QUE FICOU SEM COBRIR

- **Não li linha a linha** as faixas 13068–14671 (rituais/relatórios/consolidação de memória, `MONTHLY_PLAN`, `SHOP_ACTION`) — são fora do caminho de mensagem-em-tempo-real (rodam via cron/rituais), então priorizei o pipeline de mensagem conforme o pedido. Mapeei as funções por nome/linha mas não auditei fragilidade interna delas.
- **Não abri os ~25 intercepts pré-LLM (§1.2) um a um em detalhe** — mapeei todos por nome/linha/ordem e li o início da função (8481-8560), mas não fiz leitura linha-a-linha de cada guard individual (ex.: não confirmei o corpo exato de `CLOSING-INTERCEPTOR-OVERCAPTURE` ou dos intercepts de fatura/boleto/PIX). Dado que a Fatia 5 é a de maior risco e menor prioridade na proposta, isso não deveria bloquear a decisão de ordem, mas quem for executar essa fatia especificamente vai precisar desse mergulho que eu não fiz.
- **Não auditei os módulos externos** (`services/short-id-match.js`, `finance/action-aliases.js`, `lib/promise-honesty.js`, etc.) — só confirmei que existem e são chamados de `engine.js`. `matchRowsByShortId` (o "tolerante a UUID alucinado") em particular merece uma olhada própria, já que é central pra resolução de ID em tarefas E eventos.
- **Não tenho os dados reais de `marker_logs`** — trabalhei com os números agregados que você me deu; não rodei query no Supabase pra cruzar `reason` por rejeição e confirmar que "not owned or not found" é de fato o motivo dominante em volume real (é a hipótese mais bem sustentada pelo código, mas não está verificada contra o banco).
