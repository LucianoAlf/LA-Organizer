# Spec — Staged Reschedule (persistência determinística de reagendamento confirmado)

**Data:** 2026-07-15
**Origem:** Audit 15/07 — caso Matheus (RESCHEDULE-CONFIRM-NOOP). Ver `memory/project_audit_1507.md`.
**Autor/chat:** builder 4a512f65 · **Revisor:** Alf · **Deploy:** catraca (bind, engine.js).

## 1. Problema

Reagendar tarefa **não tem staging determinístico**. Coord (`staged_coord`) e finance (`staged_launch`) usam `pendingIntents.openIntent` + preview + resume na confirmação. TASK_UPDATE/reschedule depende 100% do LLM **re-emitir** o marker na confirmação.

Caso Matheus 14/07 (UTC): 11:32 (áudio) reagenda 4 tarefas → 11:33 TOM *"Tá certo isso?"* (propôs, **sem marker**) → 11:36 *"Isso"* → TOM *"✅ Fechou"* (**sem marker**) → tarefas seguem vencidas → 16:00 quatro cobranças de atraso → 22:15 TOM admite *"confirmei sem salvar de verdade"* e só então persiste (**11h depois**). Nada determinístico existia pra retomar no "Isso".

## 2. Modelo de comportamento (decidido: A)

- **Reagendamento inequívoco** ("joga a X pra amanhã") → executa NA HORA (como hoje). Sem fricção; respeita o jeito do TOM.
- **Reagendamento que o TOM precisa confirmar** (áudio ambíguo, multi-item, data relativa) → **estagia** e o "Isso" retoma determinístico.

Rejeitados: (B) sempre-confirmar (fricção em tudo); (C) só-recência (parsear prosa livre é frágil — mordeu no `coord_response_wrong_bind`).

## 3. Mecanismo primário (i) — flag de confirmação no marker

**Contrato do marker:** todo reagendamento **emite o TASK_UPDATE**. Quando o TOM quer confirmar, emite com `confirm: true` (ou `mode:"confirm"`). O engine:

1. **Turno da PROPOSTA** — vê `confirm:true` → **NÃO executa**; resolve as datas relativas AGORA (ver Trap B), abre `pendingIntents.openIntent(kind, {actions_resolvidos}, preview)`, mostra o preview inline (ver §6).
2. **Turno da CONFIRMAÇÃO** ("Isso"/"Sim"/"Pode") — o engine **resume** o intent aberto e executa o TASK_UPDATE com o payload **já resolvido**. Determinístico; o LLM não precisa re-emitir.

Ganho: a dependência do LLM sai do turno terso do "Isso" e vai pro turno da PROPOSTA (mesmo turno em que ele já formula). Sem flag → executa na hora.

## 4. Redes de segurança (degradação honesta)

### Rede 1 — chokepoint `nothingPersisted` (OBRIGATÓRIA) — ✅ IMPLEMENTADA (TDD verde)
Teto de dano **independente de (i)**. Se a flag não vier / o LLM não emitir: no turno da afirmação, se **nada persistiu** E há claim de conclusão, o TOM **não** dá close positivo — degrada honesto (*"não consegui salvar, me repete as datas?"*).
- **Eixo primário:** `nothingPersisted` (`!marker_emitted && !auto_retry`) — eixo nativo do chokepoint.
- **Camada fraca** ("Fechou/Combinado/Beleza/Show", 3ª pessoa fora do `COMPLETION_CORE`): só dispara sob `pendingActionRecent` (a última virada do TOM foi pergunta-de-confirmação de ação). **NÃO** gated por `actionable_intent` — este é FALSO no turno-alvo (engine.js:12294: `inputActionable("Isso")=false`, `replyHasPromise("Fechou")=false`) e é **circular** (depende do mesmo detector que a Rede 1 estende). Anti-padrão do Task 4.
- **Auto-compõe com (i):** staging OK → resume persiste → `nothingPersisted=false` → não fira (correto); staging falha → nada persiste → fira honesto.
- **Entregue:** `lib/optimistic-confirm.js` (camada fraca + `includeWeak` no sanitize) 27/27; `lib/confirm-question.js` (`isActionConfirmQuestion`) 5/5. Fiação no engine = hunk da §7 (bind, catraca).

### Rede 3 — recência (OPCIONAL, não load-bearing)
Se sobrar valor: "sim" após proposta parseável reconstrói. Ranqueada **abaixo** da Rede 1 (parsear prosa livre é frágil). O desenho **não depende** dela.

## 5. Armadilhas cravadas (a spec não tropeça)

- **Trap A — CHECK-constraint drift → null silencioso.** O kind do `pending_intents` (novo `reschedule_confirm` OU reuso de `task_update`) **entra no CHECK do banco ANTES do código**. Senão `openIntent` retorna `null` sem throw e voltamos ao Matheus **sem nem erro no log** (revivido no confirm de fatura, `project_invoice_confirm_intent_constraint`). Migration primeiro, deploy depois.
- **Trap B — data relativa resolvida na PROPOSTA.** "Segunda que vem" → `2026-07-20` via `todaySP()/localYmd()` **no momento de estagiar**. O payload guarda **YMD absoluto**. O preview mostra a data absoluta (o user confirma o que vai persistir). O resume **só grava o já-resolvido** — nunca re-parseia prosa, **nunca** `toISOString().slice(0,10)` (`project_localymd_utc_shift`).

## 6. Preview (decidido: inline estruturado, engine-generated)

- **Sem cerimônia de card financeiro** — reagendar é baixo risco.
- **Inegociável 1:** o preview lista **cada tarefa → data absoluta resolvida** (estruturado, não prosa vaga).
- **Inegociável 2:** a string do preview é **montada pelo engine a partir do payload resolvido**, NUNCA re-narrada pelo LLM — senão o confab sobe uma camada (LLM diz "movi pra segunda", payload tem outra data).

## 7. Fiação no engine (hunks p/ catraca — bind)

**Rede 1** (~12503, antes do `enforceNoMarkerHonesty`): só paga o fetch quando há claim fraco sem persistência. **BOUNDARY por timestamp (não `limit(1)` cru).** O `limit(1)` cru é invariante de ordem implícito (classe Task 4): se alguém mover o save do outbound pra antes do chokepoint (hoje é em 12814, DEPOIS), ou entrar um proativo/race, o `limit(1)` pega o próprio "✅ Fechou" (`isActionConfirmQuestion`=false) → gate morre em silêncio. O idioma do `coord-recency` (10058-10065) filtra por boundary; aplico igual. `_t0` está em escopo (12281).
```js
let _pendingActionRecent = false;
try {
  const _np = !_metrics.marker_emitted && !_metrics.auto_retry_succeeded;
  if (_np && hasWeakCompletionClaim(reply) && !hasCompletionClaim(reply)) {
    const _turnStartIso = new Date(_t0).toISOString();
    const { data: _lt } = await supabase.from('conversation_history')
      .select('content').eq('collaborator_id', collab.id).eq('direction','outbound')
      .lt('created_at', _turnStartIso)                 // < início do turno → nunca pega o "Fechou" atual
      .order('created_at',{ascending:false}).limit(1).maybeSingle();
    _pendingActionRecent = isActionConfirmQuestion(_lt && _lt.content);
  }
} catch (_) {}
// passar pendingActionRecent: _pendingActionRecent no opts do enforceNoMarkerHonesty
```
Requires: `hasWeakCompletionClaim, hasCompletionClaim` de `./lib/optimistic-confirm`; `isActionConfirmQuestion` de `./lib/confirm-question`.
**Fallback** se `_t0` sair de escopo num refactor: buscar as 2 últimas outbound e pular a de `content === reply`.
**Limitação conhecida (não-bloqueante):** se um proativo/lembrete saiu ENTRE a confirm-question e o "Isso", o last-outbound vira o lembrete → `pendingActionRecent=false` → Rede 1 não fira. Erra pro lado conservador (sem falso-fire); o (i) é o mecanismo primário. Nota, não trava.
**Sequência de deploy:** libs NÃO vão sozinhas (sem a fiação, `enforceNoMarkerHonesty` roda sem `pendingActionRecent` → `weak=false` → inerte/seguro). Deploy = libs + fiação JUNTOS, hunk cirúrgico de bind, revisado, retido pelo `.deploy-hold` até fechar.

**(i) staging** (no parser/executor do TASK_UPDATE): interceptar `confirm:true` → resolver datas → `openIntent(kind, {actions}, preview)` → `logMarker(...,'skipped','staged_reschedule:N')`. Resume no handler de confirmação. (Detalhe fica no plano.)

## 8. Testes

- **Rede 1** (feito): matriz (a) Fechou✅ sem persist após confirm-question → fira; (b) banter → não fira; (c) com marker → não fira; (d) verbo forte intocado; weak sem ✅; infoGathering/awaitingConfirm; zero-regressão.
- **(i)** (a fazer no plano): resolver data relativa na proposta (YMD absoluto no payload); openIntent com kind no CHECK; resume executa payload resolvido; preview engine-generated == payload; sem flag → executa na hora; "não" no resume → cancela sem persistir.

## 9. Sub-decisões (DECIDIDAS — Alf 15/07)

1. **Kind `reschedule_confirm` novo** ✅ — CHECK explícito, telemetria limpa, resume/handler dedicado. **Trap A = task 1 do plano** (migration do CHECK ANTES do código).
2. **Resume = afirmação curta + TTL, reusando `pendingIntents.detectUserConfirmation`** ✅ (engine.js:8556, já tunado — fix Clayton "S"→`\bs\b`, audit 10/07). NÃO inventa matcher novo. Consistência > parser novo.
3. **"Não"/emenda → cancela o intent → fluxo normal** ✅. Nuance: emenda com dado novo ("não, quarta") **também** cancela + re-propõe (re-estagia com a data nova) — NÃO costura a emenda no intent aberto (mesma razão do (C) ser frágil).
4. **Multi-item = 1 intent com N actions** ✅ (o "Isso" confirma o pacote — casa com as 4 do Matheus). **Cravar: resolução PARCIAL** — se 3 de 4 datas resolvem e 1 é ambígua, o preview mostra a ambígua distinta e pergunta ("as 3 pra tal data; a X não peguei — qual?"), NUNCA dropa em silêncio.
5. **Flag `confirm` no marker** ✅ (não marker separado — reusa o parse). **Nível-BATCH** (o reagendamento inteiro estagia ou não), NÃO por-item — misturar item confirmado com item direto no mesmo marker = ambiguidade.

---

## 10. ⚠️ REVISÃO PÓS-BIND (catraca 15/07, cópia FRESCA da VPS) — Tasks 4/5 BLOQUEADAS

A spec/plano foram escritos contra o `_remote` local, que **diverge** da VPS. Ao bindar sobre a cópia fresca, 2 achados invalidam o mecanismo (i) como especificado. **Rede 1 (Task 6) foi deployada e está no ar; Tasks 4/5 voltam pro builder com o contrato corrigido abaixo.**

### F1 — o `confirm` batch-level é IMPOSSÍVEL no formato do marker
`parseTaskUpdateMarker` (engine.js:455-469) trata o payload como **array puro de actions** e retorna `{actions, cleanText, malformed}`. **Não existe envelope top-level** onde pendurar `confirm` → `parsedTask.confirm` é sempre `undefined` → staging nunca dispara. Pior: se o LLM emitir objeto-envelope `{confirm, actions}`, vira `[{confirm,actions}]`, `validateTaskAction` rejeita por `unknown_action` → **marker malformado**.

**→ Correção da §9.5 (substitui "nível-BATCH"):** `confirm:true` **por-action**, estagia **sse `actions.every(a => a.confirm === true)`**. `validateTaskAction` (engine.js:3606-3694) tolera chave extra (verificado) → sobrevive. Isso preserva o **espírito** da §9.5 (proíbe batch misto: se nem toda action tem confirm, NÃO estagia → cai no fluxo normal), sem depender de envelope inexistente.

### F2 — falta a task que ENSINA o LLM a EMITIR o flag
O plano tem quem *lê* (Task 4) mas ninguém que faz o TOM *escrever* `confirm` ao propor-e-perguntar. Sem isso, (i) é **inerte** com fiação perfeita. **Nova task (builder, domínio de skill/prompt):** ensinar o TOM a emitir `confirm:true` em cada action de reschedule quando está propondo-e-perguntando (não quando executa direto). É o *ensino* mecânico, não o tom — a voz fica intocada.

### Fatos da cópia fresca (corrigem o plano; ancoragem REAL p/ o re-plan de 4/5)
- `todaySP()` **NÃO existe** no engine → a guarda de passado (Task 2b) precisa de um `todayYmdSP()` exportado de `utils/dates` (reusar a lógica Intl de `buildBrtDateAnchor`, que hoje só devolve string de prompt).
- `_t0` (turn-start) está em **engine.js:8473**, não 12281. Boundary de recência usa `new Date(_t0 - 1000)` (idioma provado em `_sinceTurn`, 12549).
- A var do parser é **`parsedTask`** (não `parsedTU`); o apply é `applyTaskActions(collab, parsedTask.actions, {inboundText})` em **engine.js:10369**, retorno `{okCount, failCount, integrityPayload, failMessages, groupNotices}`.
- **Task 4 NÃO usa `return`** (puxaria pra fora do send). Entra como **novo `else if (parsedTask && stagingApplies)` ANTES do `else if (parsedTask)` (10306)**, seta `reply = preview` + `_metrics.awaiting_user_confirm = true`, e **cai no fluxo normal de saída** (sem `applyTaskActions`).
- **Task 5 (resume)** entra na região 8551-8615 (junto do `launch_confirm`); idioma de saída = `whatsapp.sendMessage(phone, out)` + `logConversation(collab.id,'outbound',out)` + `logMarker(...)` + `console.log(... DONE)` + `return`. `resolveIntent(id, 'confirmed'|'denied', detail)` é 3-arg; `'confirmed'/'denied'` já válidos no CHECK de `resolution`.
- Kind `reschedule_confirm` (Task 1) **já aplicado no CHECK** e no ar (dormante e inofensivo até 4/5 subirem).
