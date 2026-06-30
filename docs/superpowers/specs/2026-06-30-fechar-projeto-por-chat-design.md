# Fechar/Cancelar Projeto por Chat — Design

**Data:** 2026-06-30
**Origem:** Auditoria 30/06, caso Krissya (`KRISSYA-PROJECT-CLOSE-NO-HANDLER`).
**Status:** aprovado por Alf (design) — pronto para virar plano.

## Problema

O balanço de aderência (dispatcher 19h) detecta projetos cujas tarefas do colaborador
já foram concluídas (`readyProjects` em `src/utils/adherence-projects.js`) e, antes do
interim de 30/06, oferecia "Fecho? 🚀". Mas **não existe nenhum caminho de WhatsApp pra
mudar o status de um projeto** — só `PROJECT_CREATE` / `PROJECT_APPROVE` / `PROJECT_REJECT`
(engine 9625-9710). O usuário respondia "Fecha o X" e o pedido ficava largado (cheque sem
fundo). O interim deployado fez o ritual só **informar** o status, parando o sangramento.

Esta spec cria a capacidade que faltava: **concluir** ou **cancelar** um projeto por chat,
de forma segura (confirmar-primeiro + executor determinístico), espelhando o que o kanban
do PWA já faz (`update({ status })`).

Buraco-irmão coberto na mesma entrega: o ritual oferece "Reagenda? Cancela?" para projetos
*parados*, e "cancela o projeto" também não tinha handler.

## Decisões travadas (brainstorm 30/06)

1. **Autoridade + guarda de abertas.** Só o **dono** (criou) ou **líder** (governança) fecha.
   Antes de concluir/cancelar, o TOM conta as tarefas **abertas de terceiros** no projeto;
   se houver, **não fecha sozinho** — avisa quantas e de quem, e exige confirmação explícita.
2. **Paridade com o PWA.** "Fechar" = `projects.status = 'completed'`; "cancelar" =
   `'cancelled'`. **Não toca nas tarefas** (igual arrastar pra "Concluído" no kanban). As
   abertas continuam visíveis na pessoa — não viram lixo. Zero comportamento destrutivo novo.
3. **Verbos:** concluir (`completed`) + cancelar (`cancelled`). Fora de escopo: pausar/reativar.
4. **Arquitetura:** confirmar-primeiro + executor determinístico. O "sim" dispara um handler
   determinístico; o LLM **não** re-emite marker. Espelha a família anti-confab já fechada
   (`FIN-CONFIRM-CONFAB-NOOP`, `PLANNING_CLAIM`/planning-confirm-no-create).

## Modelo de dados (existente, nada a migrar)

`projects.status ∈ { pending_approval, planning, active, paused, completed, cancelled }`
(ver `web/src/screens/projetos/constants.ts`). Fechar/cancelar é um `update({ status })`
em `id`. Não há `completed_at` no fluxo do kanban hoje — não introduzir um (paridade).

`pending_intents`: a confirmação reusa o kind genérico **`confirmation`** (já presente no
`VALID_KINDS` do JS **e** no CHECK do banco) com o padrão de **âncora** já existente
(`payload.anchor = { type, id, title }`) e o ciclo pergunta→"sim"→resolve
(`wasAnchorAskedRecently`, `resolveAnchoredIntents`). **Não criar kind novo** — isso evita
o drift código-vs-CHECK que causou o `project_invoice_confirm_intent_constraint`
("confirmar não funciona" = `openIntent` retornava null sem throw).

## Componentes

### 1. `src/lib/detect-project-status-intent.js` (NOVO, puro)

Detector determinístico, irmão de `src/events/detect-approval-reply.js`.

- Entrada: texto cru do usuário (com possível reply-scaffold).
- Lê a fala REAL via `stripReplyScaffold(text).userText` (reusa o helper de
  `detect-approval-reply.js`) — nunca o texto cru (família `FINEDIT-QUOTE-SCAFFOLD-MISROUTE`).
- Verbos: `complete` = `/\b(fecha(r)?|conclui(r)?|encerra(r)?|finaliza(r)?)\b/`;
  `cancel` = `/\b(cancela(r)?)\b/`.
- **Duas vias de disparo** (e só essas — fora delas, `null`):
  1. **Via explícita:** verbo **+** token `projeto` na fala real. `nameHint` = trecho após
     "projeto" ("fecha o projeto Marketing" → "Marketing"). Funciona com ou sem reply.
  2. **Via reply-bare:** verbo **+** reply-scaffold presente, **sem** token `projeto`
     ("pode fechar", "fecha esse"). `nameHint = null`; a resolução fica por conta do
     `quotedText` (a mensagem citada do ritual nomeia o projeto). Se o quote não casar
     **exatamente um** projeto vivo do caller → `none`/`ambiguous` (ação inofensiva).
  - Sem token `projeto` **e** sem reply-scaffold → `null` (protege contra colisão com
    complete de tarefa: "fechei a tarefa", "conclui isso", e o "Cancela?" de reagendamento).
  - A confirmação obrigatória (confirm-first) é a rede final: mesmo um disparo indevido só
    gera uma pergunta que o usuário declina — nunca muda status sem "sim".
- Pergunta (`/\?\s*$/`) → `null` (lição EVENT-CONFAB: pergunta não é comando).
- Lê a fala real e o quote via `stripReplyScaffold(rawText)`.
- Retorno: `{ action: 'complete'|'cancel', nameHint: string|null, quotedText: string|null } | null`.

**Assinatura:** `detectProjectStatusIntent(rawText) -> {action, nameHint, quotedText} | null`

### 2. `src/lib/project-status.js` (NOVO, puro — padrão `adherence-projects.js`)

Funções puras (recebem dados já buscados; testáveis sem Supabase):

- `resolveProjectByName(aliveProjects, nameHint, quotedText) -> { status:'match', project } | { status:'ambiguous', candidates } | { status:'none' }`
  - `aliveProjects`: `[{ id, name, status, created_by }]` — projetos do caller em status
    "vivo" (`pending_approval|planning|active|paused`).
  - Normaliza (lower, sem acento, trim) e casa `nameHint` por igualdade → contains.
  - Se `nameHint` é null, tenta extrair nome do `quotedText` (caso-reply ao ritual): casa
    nomes de `aliveProjects` que apareçam no quote. 0 → `none`; 1 → `match`; >1 → `ambiguous`.
  - `nameHint` com >1 match → `ambiguous` (lista `candidates: [{id,name}]`).
- `canChangeStatus(collab, project, leaderIds) -> boolean`
  - `true` se `project.created_by === collab.id` OU `leaderIds.includes(collab.id)`.
  - `leaderIds` vem do resolvedor de governança existente (engine injeta).
- `summarizeOpenWork(openTasks) -> { total, byPerson: [{ name, count }] }`
  - `openTasks`: tarefas do projeto com status aberto (`!== 'done' && !== 'cancelled'`),
    **de qualquer pessoa**. Agrupa por nome do assignee; ordena count desc.
- `buildStatusConfirm(project, action, openSummary) -> string`
  - Texto na voz do TOM. Sem abertas: `"Fecho o projeto *X*? 🎉"` / `"Cancelo o projeto *X*?"`.
  - Com abertas: acrescenta `⚠️ Ainda tem N tarefa(s) aberta(s) (Fulano, Ciclano).` antes
    da pergunta. (Texto-âncora do aviso é determinístico; a voz pode embalar, mas os números
    saem daqui — anti-confab de contagem.)
- `buildStatusResult(project, action, openSummary) -> string`
  - `"✅ Projeto *X* concluído!"` / `"Projeto *X* cancelado."` — com nota honesta se ficaram
    abertas (`_Deixei as N tarefas abertas como estavam._`).
- `STATUS_BY_ACTION = { complete: 'completed', cancel: 'cancelled' }`.

### 3. `src/services/project-status-exec.js` (NOVO, thin — toca Supabase)

- `applyProjectStatusChange(collab, { projectId, newStatus }) -> { ok, project?, reason? }`
  - **Re-checa**: projeto existe e ainda está em status vivo (idempotência contra "sim"
    duplo / corrida); autoridade (re-resolve dono/líder). Se já fechado/cancelado →
    `{ ok:false, reason:'already_closed' }`.
  - `update({ status: newStatus }).eq('id', projectId)`.
  - Loga marker `PROJECT_STATUS` executed (`name:<nome> status:<novo>`).
  - **Determinístico** — chamado no "sim", nunca por marker do LLM.

### 4. Engine (território do chat Financeiro Pessoal; spec especifica o fio)

Detecção **fora do LLM** (determinística), espelhando o caminho do `detectApprovalReply`:

```
intent = detectProjectStatusIntent(userText)
if intent:
  alive = projetos vivos do caller (id, name, status, created_by)
  res = resolveProjectByName(alive, intent.nameHint, intent.quotedText)
  if res.none      -> "não achei um projeto com esse nome aberto pra você"
  if res.ambiguous -> lista candidatos, "qual deles?"
  if res.match:
    if !canChangeStatus(collab, res.project, leaderIds) -> "só quem criou ou lidera fecha"
    open = summarizeOpenWork(tarefas abertas do projeto, de todos)
    confirmText = buildStatusConfirm(res.project, intent.action, open)
    openIntent(collab.id, 'confirmation',
               { anchor:{type:'project', id:res.project.id, title:res.project.name},
                 action:intent.action }, confirmText)
    reply = confirmText   // determinístico; sem roundtrip de LLM
```

No turno do "sim":

```
yes = detectUserConfirmation(userText)            // já existe
if yes === 'yes' and há intent 'confirmation' aberta com anchor.type==='project':
  r = applyProjectStatusChange(collab, { projectId: anchor.id,
                                         newStatus: STATUS_BY_ACTION[payload.action] })
  resolveAnchoredIntents(collab.id, anchor.id, 'confirmed')
  reply = r.ok ? buildStatusResult(...) : (already_closed -> "esse já tá fechado")
if yes === 'no': resolveIntent(intentId, 'denied'); reply = "beleza, deixei como tá"
```

**O dispatcher do "sim" decide pelo `anchor.type`** — o branch de projeto **não** intercepta
confirmações ancoradas em task/event (essas têm `anchor.type` próprio). Zero-regressão.

### 5. Skill `skills/fechar-projeto.md` + regra curta no prompt

Skill operacional carregada quando há intent de fechar/cancelar projeto. Orienta a voz e
deixa claro que o TOM **confirma antes** e **só executa no "sim"** (nunca confabula "fechei").
Regra no `system.js`: "fecha/cancela o projeto X" → caminho de confirmação (não inventar
conclusão; não emitir marker de status fora do executor).

## Casos de borda

| Caso | Comportamento |
|---|---|
| Projeto já `completed`/`cancelled` | "esse projeto já tá fechado/cancelado" (resolve não o lista como vivo; e o exec re-checa) |
| 0 tarefas abertas de terceiros | confirma limpo (🎉, sem ⚠️) |
| Nome ambíguo (>1 match) | lista candidatos, pergunta qual |
| Sem autoridade | explica que só dono/líder fecha |
| Reply ao ritual ("pode fechar") | resolve por `quotedText`; se o ritual citou >1 projeto → ambíguo → pergunta |
| Reply-scaffold | lê fala real via `stripReplyScaffold` |
| "sim" duplo / corrida | `applyProjectStatusChange` idempotente (re-checa status vivo) |
| "cancela" colidindo com tarefa | exige token `projeto`; sem ele, não dispara |

## Zero-regressão

- Não altera `PROJECT_CREATE`/`APPROVE`/`REJECT` nem seus handlers.
- Reusa kind `confirmation` (sem migration, sem CHECK-drift).
- Dispatch do "sim" gated por `anchor.type` — não toca os consumidores de task/event.
- Paridade PWA: só `update({ status })`, não mexe em tarefas.

## Testes

**Puros (locais — `node:test`/vitest):**
- `detect-project-status-intent`: complete/cancel; exige `projeto`; `?`→null; scaffold
  separa fala real; sem colisão com "fechei a tarefa"/"conclui isso"; nameHint extraído;
  bare ("pode fechar") expõe quotedText.
- `project-status`: `resolveProjectByName` (match/ambiguous/none, por nome e por quote);
  `canChangeStatus` (dono, líder, negado); `summarizeOpenWork` (agrupa por pessoa, ordena);
  `buildStatusConfirm`/`buildStatusResult` (com e sem ⚠️/abertas); `STATUS_BY_ACTION`.

**E2E live na VPS** (`node --env-file=.env`, padrão local-vs-VPS): `applyProjectStatusChange`
em projeto descartável — vira `completed`/`cancelled`; idempotência no 2º "sim"; autoridade
negada não persiste.

**Smoke no zap (ficha/projeto descartável):** "fecha o projeto <descartável>" → confirma com
contagem certa → "sim" → status muda no PWA; "não" → não muda; nome ambíguo → pergunta.

## Fora de escopo (YAGNI)

Pausar/reativar projeto; cascata (cancelar/concluir as tarefas abertas); fechar projeto de
terceiro sem ser líder; `completed_at`/auditoria de fechamento.

## Registro de known-issue

Ao concluir: atualizar `KRISSYA-PROJECT-CLOSE-NO-HANDLER` em `tom_known_issues` para
`corrigido` (de interim → handler real), com `fix_resumo` apontando os módulos.
