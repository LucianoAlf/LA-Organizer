# Handoff — Bloco Confirmação + Cauda dropped_request (16/08/2026)

> Registro de sessão para retomada limpa (mesmo pós-compact). Estado congelado: **VPS = `bd82b02`**,
> tree limpo, holds removidos, pm2 online. Decisão do Alf ao fechar: **PARAR e deixar o campo medir.**

## 0. AO VOLTAR — primeiro passo

**NÃO abrir frente nova.** Medir o efeito de campo nas auditorias dos próximos dias:
- `CONFIRM_NOEXEC` (marker_logs) — deve cair (as 4 superfícies de confirmação agora resolvem).
- `dropped_request` (tom_audit_findings, status `novo`) — deve cair.
- Falso-fire de composição (chokepoint em turno de rascunho) — deve sumir.

Conferência de fundo, **não gate**. Só depois, se um novo root dominar, atacar.

**O que resta** no `dropped_request` é cauda de **COMPREENSÃO do LLM** (multi-intenção, pergunta
ignorada, negação ignorada) — sem sinal estrutural pros fixes determinísticos desta sessão. Atacar
isso é trabalho de **prompt/skill** (zona de veto do Alf + feature-freeze), não mais
parse-on-open/fail-closed.

## 1. As 8 fatias entregues (todas no ar, TDD verde + suíte VPS fail 3 + replay + restart provado)

| # | Commit | KI | O que fechou |
|---|--------|----|--------------|
| 2 | `00a50fdf`/`d5ed58a` | `NAOREGISTREI-2-FALSEFIRE-COMPOSICAO` | Chokepoint colava "não consegui registrar" em turno de **composição** de mensagem |
| 3 | `b9763ed` | `CONFIRM-DROP-COORD-PARSE-ON-OPEN` | Confirmação de **recado** (coordenação, texto explícito) |
| 4 | `ec92ab1` | `CONFIRM-DROP-COMPLETE-PARSE-ON-OPEN` | Confirmação de **fechamento** (complete/batch) |
| 5 | `d5d9c0a` | `CONFIRM-DROP-DELEG-PARSE-ON-OPEN` | Confirmação de **delegação** |
| #1 | `9c05511` | `REMINDER-HORA-INVISIVEL-NA-CONFIRMACAO` | Hora do lembrete **visível** na confirmação |
| #2 | `b29a726` | `TXN-TARGET-FAILOPEN-APAGA-ERRADO` | Delete/edit financeiro **apagava o alvo errado** (fail-closed) |
| 8 | `bd82b02` | `CONFIRM-RECADO-IMPLICITO-DROPA` | Recado **implícito** confirmado (sem texto citado) despacha |

## 2. As raízes (por família)

### A) Falso-fire do chokepoint em composição (Fatia 2)
O guard da Bianca (09/08) removeu o veto `infoGathering` **inteiro** da camada forte — levou junto a
metade **segura**. `reply-classify` separa `isContentSolicitationReply` ("me manda/pode mandar" =
compõe) de `isConfirmSeekingReply` ("certo?"). `enforceNoMarkerHonesty` veta a camada forte só em
`contentSolicitation && !markerAttempted`. `optimistic-confirm.js` + `reply-classify.js` + engine.

### B) Confirmação não resolve a ação pendente (Fatias 3/4/5/8) — dor #1
**Raiz única:** o TOM faz a pergunta de confirmação **em prosa, sem emitir o marker de estágio**. O
hook genérico de fim-de-turno (`detectConfirmationQuestion`, engine ~13413, roda só quando
`noMarkerEmitted`) abre intent `confirmation` **só-texto** → no "sim" (~10242), sem executor no
payload, cai no `!hasConcrete` (~10279) que **manda o LLM desistir**. Os executores determinísticos
existem (`anchor`@10165, `batch_complete`@10199, `coordination.items`@10221) mas ficam **famintos**.

**Padrão de fix reutilizável (parse-on-open):** parser puro extrai o executor da **própria pergunta
do TOM** (nunca do texto do usuário) → resolve (fail-closed) → grava payload estruturado → o "sim"
resolve determinístico.
- **Coordenação (3):** `coord-question-parse` extrai `{recipient_name, message_body}` (só com texto
  entre aspas — fail-closed no implícito). Executor `applyCoordinationRequestAction`.
- **Complete (4):** `complete-question-parse` extrai títulos em `*negrito*`; `complete-titles-resolve`
  resolve título→short-id via `resolveTaskTarget` (fail-closa em série/linhagem); só estagia
  `batch_complete` se TODOS derem `exato`. Executor `executeBatchComplete` (re-checa dono).
- **Delegação (5):** `delegate-question-parse` extrai `{task_title, to_name}` (2 templates); reusa
  `complete-titles-resolve`. **Branch NOVA** no "sim" reusa o handler `delegate` via `applyTaskActions`.
  Reply nova `📋 Delegado pra *X*.` (OK do Alf).
- **Recado implícito (8):** sem texto extraível → `confirm-coord-gate.podeLiberarRecado` (espelha o
  `confirm-create-gate`) instrui o LLM a compor+emitir `COORDINATION_REQUEST`. Obstáculo do **loop de
  re-estágio** resolvido com `_metrics.recado_preconfirmed` → `shouldStageCoordination(preConfirmed)=
  false` → o `else` de 12562 **despacha direto**. **Semi-determinístico** (LLM compõe o teor).

### C) Cauda dropped_request
- **#1 hora do lembrete:** FALSO ALARME de "hora cai na criação" — o `remind_at` é gravado CERTO
  (07h BRT) e o lembrete dispara; o gap era a **fala omitir a hora**. `reminder-notice.buildReminderNotice`
  anexa "🔔 Lembro às HHh" quando a fala não cita (dedup). **Lição: `remind_at`≠`due_time`; medir
  persistência antes de assumir drop.**
- **#2 apagar o errado:** `resolveTxnTarget` (finance) caía em **fallback CEGO → mais recente** quando
  a especificidade não batia os 10 recentes → apagou o Canva ("apaga fatura Itaú R$950,21"). Fix
  fail-closed: valor/nome-ref sem match → `none` (pergunta), nunca chuta. Afeta delete E edit.
  **Lição: fallback "mais recente" só quando NÃO houve referência; em op destrutiva, especificidade-
  que-não-bate = perguntar.**

## 3. Lições transversais da sessão

- **Medir antes de desenhar mata slices.** 1b/3 (contradição "afirma+desmente") medida ESTANCADA →
  não construída. #1 refutado (não era drop). Refutar economiza trabalho (papel de Catraca).
- **Fail-closed é a regra em ação destrutiva/irreversível** (fechar, delegar, apagar, enviar recado):
  na dúvida, **perguntar**, nunca chutar o alvo/mensagem.
- **Reuso > reinventar:** `resolveTaskTarget`, `applyCoordinationRequestAction`, `applyTaskActions`,
  o `else` de staging, o `confirm-create-gate` — todos reusados.
- **Zero-regressão por construção:** opt/flag ausente → comportamento idêntico ao de hoje.

## 4. Flags de rollback vivas
`TOM_CONFIRM_CREATE_GATE=0` · `TOM_CONFIRM_RECADO_GATE=0` · `TOM_TASK_TARGET_SERIES=1` (liga o
resolveTaskTarget no complete-handler legado).

## 5. Specs/planos versionados (referência)
`_remote/docs/superpowers/specs/2026-08-16-*` e `.../plans/2026-08-16-*` — um por fatia.
