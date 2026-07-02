# Devolutiva da delegação ("a volta") — Design

**Data:** 2026-07-02
**Origem:** Pedido da Fabíola (staff de cliente) via áudio WhatsApp, 02/07. Ela delegou "Aluno novo faltoso" pra Gabi com o gerente **Jereh em cópia**; a Gabi concluiu (01/07, pelo app) e a Fabi **não recebeu nada** — nem a conclusão, nem um retorno. O Jereh tentou dar o retorno pelo TOM ("envia essa mensagem pra Fabi") e furou (relay ad-hoc sem conteúdo).
**Autor:** Catraca (sessão revisor/implementador).
**Relacionado:** fatia futura já prevista na spec [2026-06-29-delegacao-em-copia](2026-06-29-delegacao-em-copia-design.md) §4 ("Notificar o observador 'o executor concluiu' — pode virar fatia futura").

---

## 1. Problema (confirmado na auditoria)

A delegação em cópia (`task_watchers`, entregue 30/06) construiu a **ida** — quem entra em cópia **acompanha e cobra**. Faltou a **volta**:

- **App:** concluir uma tarefa delegada faz `update({status:'done'})` direto no Supabase, **sem avisar ninguém**. Só o caso checklist-pai chama o bridge `/internal/subtask-parent-complete`. → a Gabi concluiu no app e a Fabi ficou no escuro.
- **Zap:** `notifyTaskCreatorOfAction('complete')` ([engine.js:4150](../../../src/engine.js)) avisa **só o `created_by`** — nunca os watchers, nunca com uma nota.
- **Não existe canal estruturado de devolutiva.** O Jereh improvisou um relay e furou.

A Fabíola quer **controle**: quando a pessoa conclui (ou quer dar um retorno), isso chega **automático** pra quem delegou e pra quem está em cópia — com uma nota ("uma caixinha de resposta"), não só um status que some.

## 2. Modelo conceitual (decisões travadas com o Alf)

O conceito é o **círculo da tarefa** = **delegador** + **executor** + **em cópia (0..N)**.

1. **Aviso de conclusão (automático).** Quando o **executor conclui** uma tarefa **delegada** (executor ≠ delegador), o círculo é avisado: delegador **+ todos em cópia**. Vale pra **toda tarefa delegada** (com ou sem cópia), no app **e** no zap.
2. **Devolutiva (nota opcional).** Junto da conclusão, o executor pode anexar uma nota curta ("feito — fiz assim"). Sem nota, vai só o aviso de conclusão.
3. **Devolutiva vem dos dois lados.** **Tanto o executor quanto quem está em cópia** podem mandar uma devolutiva — na conclusão (executor) **ou avulsa, a qualquer momento** (executor ou em cópia). Quem está em cópia **dá devolutiva mas continua não concluindo** (regra do em-cópia intacta: só o executor fecha).
4. **Destinatário da devolutiva:** **o círculo inteiro menos quem escreveu**. O **delegador sempre recebe**.
5. **Não é chat encadeado.** Devolutiva é **push** (chega como mensagem + fica no histórico da tarefa). O delegador não responde num fio; se quiser falar, usa o canal normal (coordenação já existe).

## 3. Arquitetura

### 3.1 Helper central de broadcast (backend) — camada única

`notifyTaskReturn({ task, author, kind, note })` — **chokepoint único** da volta. Nunca remendar por-handler (memória: chokepoint único).

- `kind`: `'completion'` (conclusão, com/sem nota) ou `'return'` (devolutiva avulsa).
- Resolve o **círculo**: delegador (`governance_owner_id` → fallback `created_by`) + executor (`assigned_to`) + watchers (`task_watchers.collaborator_id`). **Remove o autor** e **dedup** por `collaborator_id`.
- Só dispara com colaborador `is_active` + `phone`. Envia WhatsApp (voz atual) + grava `conversation_history` (outbound) pra cada destinatário — mesma convenção do `notifyTaskCreatorOfAction`.
- **Anti-confab:** pra `kind='completion'`, só dispara se o **banco confirma `status='done'`** (igual `/internal/subtask-parent-complete` já faz). Se o update não persistiu, não confabula.
- **Transacional** (ação humana, não job proativo): envia na hora, sem gate de quiet-hours — mesma classe do `task-delegated`/`task-cobrar`.

**Texto (voz do TOM intacta — reusa o padrão atual):**
```
✅ {nome}, o {executor} concluiu a tarefa que você pediu:
_"{título}"_
💬 Devolutiva: _"{nota}"_        ← só quando há nota
```
- Pro **em cópia**, o mesmo com enquadramento "_tarefa que você acompanha_".
- Devolutiva **avulsa** (kind='return'): `💬 {nome}, o {autor} deixou um retorno em _"{título}"_:\n_"{nota}"_`.

### 3.2 Persistência da devolutiva — `task_comments` (zero tabela nova)

A tabela `task_comments` (id, task_id, content, comment_type, created_by, created_at) já existe. A devolutiva é gravada com `comment_type='return'`. Dá o **histórico/controle** que a Fabi pediu e alimenta a leitura no app.
- **RLS:** garantir SELECT pro círculo (delegador/executor/watchers) e INSERT pelo executor/watcher. Engine escreve via service_role (ignora RLS); `created_by` resolvido no backend a partir do remetente, nunca de marker cru (memória: dado sensível no service_role).

### 3.3 Gatilhos (onde o helper é chamado)

**A) Conclusão pelo zap** — estender o ramo `complete` de `applyTaskActions` ([engine.js](../../../src/engine.js) ~4428): trocar `notifyTaskCreatorOfAction('complete')` por `notifyTaskReturn({kind:'completion', note})`. A nota vem do que o executor disser ao concluir (o parser de conclusão passa o texto livre como `note`, se houver).

**B) Conclusão pelo app** — novo endpoint `/internal/task-complete-return` (irmão do `subtask-parent-complete`, [internal-api.js](../../../src/internal-api.js)): body `{ task_id, actor_id, note? }`; valida `done` no banco → grava `task_comments` (se nota) → chama o helper. O app chama esse endpoint **depois** de concluir uma tarefa **delegada** (executor ≠ delegador). Conclusão de tarefa própria não chama.

**C) Devolutiva avulsa pelo zap** — TOM ganha entendimento de "devolutiva/retorno sobre a tarefa X" (executor **ou** em cópia). Resolve a tarefa por contexto (tarefa recente que a pessoa acompanha/executa; short_id; **pergunta se ambíguo — anti-confab**), grava `task_comments`, chama `notifyTaskReturn({kind:'return'})`. É o caminho limpo que o Jereh não teve. Marker/ação nova `TASK_RETURN` (nome a confirmar no plano), skill + system prompt atualizados expondo a capacidade ("manda devolutiva", "avisa quem delegou que…", "deixa um retorno"). **Voz intacta.**

**D) Devolutiva avulsa pelo app** — ação "Deixar devolutiva" na leitura da tarefa (`TaskDetailSheet`), disponível nas visões **Delegadas** (executor/delegador) e **Em cópia** (watcher). Campo de texto → POST `/internal/task-return` `{task_id, author_id, note}` → grava + broadcast.

### 3.4 UI (app)

- **Nota na conclusão:** nas telas de concluir tarefa **delegada**, um campo opcional "recado pra quem delegou" antes de confirmar. Superfícies: TaskRow/EditTaskSheet/TaskDetailSheet (agenda Hoje/Semana/Mês mobile + desktop), workspace de grupo é fora de escopo (tarefa de grupo não delegada 1:1). Implementação enxuta: um mini-sheet de confirmação com campo opcional só quando a tarefa é delegada — **não** mexer no "1 toque" das tarefas próprias.
- **Devolutivas na leitura:** `TaskDetailSheet` mostra as devolutivas (`task_comments` type='return') da tarefa — quem escreveu + quando + texto. Reusa a view de leitura que já existe (TASKDESC-READVIEW-EXPAND).
- **Design System:** inputs/botões do DS (Field/Button/BottomSheet), tokens `tom`. Sem HTML nativo.

## 4. Fora de escopo (YAGNI)

- Delegador **responder num fio / reabrir** a tarefa (devolutiva é push, não thread).
- Devolutiva em **tarefa de grupo** (`assigned_group_id`) e em **eventos**.
- Devolutiva em **cancelar/reagendar** (o `notifyTaskCreatorOfAction` já cobre esses avisos ao criador; esta fatia foca conclusão + devolutiva). Estender pra watchers nesses casos = fatia futura.

## 5. Plano de validação

1. **Funções puras (TDD):** montagem da lista de destinatários do círculo (dedup + remove autor) e montagem do texto por `kind`. Backend: helper puro testável.
2. **Migration/RLS `task_comments`:** conferir/ajustar RLS pro círculo; **provar no banco** (insert/select como executor, watcher, delegador).
3. **Anti-confab:** forçar no banco `status≠done` e confirmar que o endpoint de conclusão **não** notifica.
4. **Dedup:** conclusão pelo app **e** pelo zap não pode notificar 2×; garantir que só um caminho dispara por conclusão.
5. **Preview do app** (localhost:4173): campo de nota na conclusão de tarefa delegada; ação "deixar devolutiva"; devolutivas na leitura. Sem mutar dado real (ficha descartável).
6. **E2E do engine na VPS** com ficha descartável: (a) executor conclui com nota → delegador + watcher recebem; (b) watcher manda devolutiva avulsa → delegador + executor recebem; (c) `task_comments` gravado. **Sem WhatsApp real** (soft-cancel / número de teste).
7. Só então **deploy** (PWA via auto-deploy; engine via scp+pm2 no checkpoint). Registrar em `tom_known_issues`.

## 6. Riscos

- **Território do engine (2-chat coordination):** `engine.js` + `internal-api.js` são do outro chat. Mitigação: `.deploy-hold` na raiz **antes** de editar `src/`; verificar hash local==VPS antes do scp.
- **Dedup app×zap:** conclusão dispara 1× só. Mitigação: o app-path (endpoint) e o zap-path (engine) são mutuamente exclusivos por conclusão; garantir idempotência (não reprocessar a mesma conclusão).
- **Resolução da tarefa na devolutiva avulsa (zap):** ambiguidade de "qual tarefa". Mitigação: resolver por contexto/short_id e **perguntar se ambíguo** (anti-confab), reusando `resolveCollaboratorByName`/short_id do delegate.
- **UX "1 toque":** não adicionar fricção à conclusão de tarefa própria. Mitigação: campo de nota só aparece em tarefa delegada.
- **Voz do TOM:** sagrada. Mitigação: reusa o texto do `notifyTaskCreatorOfAction`, só acrescenta a linha de devolutiva e o destinatário.
