# Lote D — Reply-quote a um proativo "largado" (vínculo mensagem-de-saída → tarefa)

> **Status: EM IMPLEMENTAÇÃO (19/06).** HOLD liberado pelo Alf; Balde A destravado.
> Esta spec é o "Lote D" já nomeado em `2026-06-15-lote-a-pedido-largado-design.md`
> (item #8 do audit 15/06: *"#8 / reply-quote a proativos (→ Lote D)"*).
> **Ajuste verificado no banco:** a coluna `whatsapp_message_id` já existe em
> `conversation_history` (era "ID externo UAZAPI", nunca escrita pelo código) —
> **reusada**; a migration adiciona só `ref_type`+`ref_id`. Onde a spec disser
> `wa_message_id`, ler `whatsapp_message_id`.

## 1. Problema

Caso Alf (audit 15/06, item #8): o usuário **respondeu CITANDO (reply-quote)** uma
mensagem **proativa** do TOM — um lembrete — com *"muda pra amanhã o prazo / me lembra
amanhã"*. O pedido foi **largado**: o TOM não reagendou. A verificação adversarial
REPROVOU o fix ingênuo do Lote A porque, no teste, não havia outro proativo competindo
— e a raiz só aparece quando há.

**Raiz (confirmada no código), dois elos perdidos:**

1. **Na saída, o proativo não registra a qual tarefa pertence.**
   - `whatsapp.sendMessage()` retorna `response.data` da UAZAPI (que **contém o id da
     mensagem enviada**), mas [`sendProativo`](../../../src/services/send-proativo.js)
     e os lembretes do [`dispatcher.js`](../../../src/rituals/dispatcher.js) **descartam
     esse retorno**.
   - `logConversation()` ([engine.js](../../../src/engine.js)) e os `insert` diretos
     gravam apenas `collaborator_id, direction, message_type, content` (+ `media_*` no
     inbound). **Não há `wa_message_id`, nem `task_id`/`event_id`.** Nenhuma migration
     local cria coluna de vínculo.

2. **No inbound, o id da mensagem citada é extraído e jogado fora.**
   - [`extractQuotedMessage()`](../../../src/services/whatsapp.js) **já lê o `stanzaID`**
     (id da mensagem citada, em `contextInfo.stanzaID`) e retorna `{ id, text, type }`.
   - Mas o [`webhook.js`](../../../src/webhook.js) **usa só o `.text`** (lookup textual
     por prefixo em `conversation_history` p/ enriquecer o trecho) e **descarta o `.id`**.
     O engine recebe só o scaffold textual `[O usuário está RESPONDENDO...: "..."]`.

**Consequência:** ao citar o lembrete e pedir "muda pra amanhã", o engine só tem o
**texto** do lembrete (o título). O casamento determinístico que já existe —
aprovação ([engine.js, `quotedText.includes('APROVA '+token)`](../../../src/engine.js))
e fechamento ([`shouldClosingInterceptorFire`](../../../src/utils/closing-reply.js)) —
funciona porque aqueles cards **carregam token/short_id no próprio texto**. O lembrete
proativo genérico não carrega. Sobra o LLM adivinhar o alvo; com proativos competindo,
ele erra ou larga.

**A chave:** o WhatsApp **já entrega o `stanzaID`** da mensagem citada. Se gravarmos
esse id no envio (ligado ao `task_id`/`event_id`), o reply-quote casa **por id exato** —
a ambiguidade desaparece e não depende de texto.

## 2. Princípio

- **Ancorar o alvo por id, nunca deixar o LLM chutá-lo** — mesma filosofia de
  `FECHAMENTO-ITEM-NO-ANCHOR` e `ALVO-FUTURO-RESPOSTA-CURTA`.
- **O problema nunca foi interpretar "amanhã"; foi saber QUAL tarefa.** Logo o
  mecanismo determinístico só **resolve + ancora o alvo**; a leitura da data/intenção
  fica no LLM, mas travada no id certo. **Sem parser de intenção novo** (YAGNI).
- **Fail-safe:** qualquer falha/ausência de id → cai no comportamento atual (scaffold
  textual + LLM). Zero regressão fora do caso coberto.

## 3. Decisões aprovadas (brainstorm 19/06)

- **(Q1) Vínculo:** gravar o `wa_message_id` (stanzaID) do proativo **na própria
  `conversation_history`** + `ref_type`/`ref_id`. Inbound casa pelo stanzaID exato;
  fallback textual quando faltar id. Mínima superfície nova, reusa o lookup existente.
- **(Q2) Aplicar a ação:** **ancorar o alvo e deixar o LLM emitir o marker** (padrão
  `pending_intents`/anchor, ex. [engine.js âncora de complete](../../../src/engine.js)).
  O engine **não** escreve `due_date`/`remind_at` direto. **Não toca a máquina de
  recorrência.**

## 4. Escopo

**Dentro (v1) — resolve o caso do Alf:**
- Vínculo gravado nos **lembretes one-shot / T-1 de TAREFA e EVENTO** (lista em §5.4).
- Resolução determinística do alvo no inbound por stanzaID + ancoragem inline no turno.

**Fora (v1) — superfície incremental (a coluna já suporta; instrumentar depois):**
- Cobranças/escalações/digests (`checkDeadlineAlerts`, `detectStaleTasks`,
  `sendGovernanceDigest`, `checkTaskCheckins`, etc.).
- Respostas **reativas** do TOM que criam/mencionam objetos (o mesmo mecanismo serve;
  basta gravar o vínculo nelas no futuro).
- Reply-quote a proativo de **grupo** (chat de grupo tem pipeline próprio).
- Detecção determinística da intenção (reschedule vs remind) — fica no LLM.

## 5. Componentes

### 5.1. Migration — `conversation_history` ganha o vínculo (idempotente)
```sql
ALTER TABLE public.conversation_history
  ADD COLUMN IF NOT EXISTS wa_message_id text,
  ADD COLUMN IF NOT EXISTS ref_type      text,   -- 'task' | 'event' (nullable)
  ADD COLUMN IF NOT EXISTS ref_id        uuid;   -- alvo do proativo (nullable)
CREATE INDEX IF NOT EXISTS conversation_history_wa_message_id_idx
  ON public.conversation_history (wa_message_id) WHERE wa_message_id IS NOT NULL;
```
- Sem `CHECK` que o código não conheça (lição `FIN-INVOICE-INTENT-KIND-CONSTRAINT`:
  drift código↔DB). `ref_type`/`ref_id` opcionais → linhas antigas e mensagens sem
  alvo seguem válidas.

### 5.2. `whatsapp.js` — expor o id da mensagem enviada (função PURA nova)
- `extractSentMessageId(responseData)` → `string|null`, **espelhando** o
  `extractMessageId` que já existe (testa `data.id`, `messageid`, `message_id`,
  `key.id`). Não altera `sendMessage`; apenas dá um leitor estável do retorno.

### 5.3. `services/proactive-link.js` — helper de gravação (novo, fino)
- `record(supabase, { collaboratorId, waMessageId, refType, refId, content })` →
  grava UMA linha em `conversation_history` (`direction:'outbound'`, `message_type:'text'`)
  já com o vínculo. Substitui o `insert`/`logConversation` ad-hoc **apenas** nos
  call-sites instrumentados (§5.4). Tolerante a `waMessageId` nulo (grava sem vínculo,
  comportamento atual).

### 5.4. Instrumentação dos emissores (call-sites v1)
Padrão por call-site (aditivo, ~2 linhas, **sem** tocar dedup/recorrência):
```js
const res = await whatsapp.sendMessage(phone, msg);
await proactiveLink.record(supabase, {
  collaboratorId, waMessageId: whatsapp.extractSentMessageId(res),
  refType: 'task', refId: task.id, content: msg,
});
```
Call-sites (todos em `dispatcher.js`, exatos — ver §10 sobre o HOLD):
| Função | Linha | Ref |
|---|---|---|
| `checkReminders` | ~5041 | task + event |
| `checkTaskReminders` | ~4926 | task |
| `checkEventReminders` | ~5178 | event |
| `remindEventTasks` | ~1099 | task (de evento) |
| `remindOperationalTasks` | ~1156 | task |
| `remindPersonalTasks` | ~1219 | task |
| `remindGroupTasks` | ~1053 | task (grupo — opcional na v1) |

### 5.5. Inbound — resolução do alvo por stanzaID
- **Local:** no `engine.js`, **novo interceptor determinístico pré-LLM**
  (`REPLY-REF`), ao lado dos já existentes (closing / rsvp / approval) e **antes** do
  bloco de `pending_intents`. Reusa `latestRaw` (3º arg de `processMessage`) →
  `whatsapp.extractQuotedMessage(latestRaw)` → `quoted.id` (stanzaID).
- **Lookup (determinístico):** se há `quoted.id`, buscar em `conversation_history`
  a linha `direction:'outbound'` com `wa_message_id === quoted.id` e `ref_id NOT NULL`.
  Achou → `{ refType, refId }` resolvido **sem texto**.
- **Validação do alvo (anti-"proativo antigo"):** carregar o objeto (`tasks`/`events`)
  e só ancorar se ainda está **vivo** (status `pending`/`in_progress`; não
  `done`/`cancelled`). Objeto morto → não ancora; segue scaffold + LLM (que pode dizer
  "essa já foi concluída").
- **Ancoragem (Q2):** montar o `ctxHint` ancorado inline (mesmo molde de
  [engine.js, bloco pending-intents](../../../src/engine.js)) e **anexar ao `text`**:
  > `[CONTEXTO INTERNO — não verbalize] O usuário está respondendo a um lembrete da
  > tarefa "<title>" (id <refId>). Se ele pediu novo prazo/lembrete, emita
  > `<<TASK_UPDATE>>` para ESTE id; não toque em nenhum outro item.`
  O LLM interpreta a data e emite o marker **sobre o id certo**. O engine **não**
  escreve datas (recorrência intocada). O scaffold textual original **permanece** (dá
  contexto humano ao LLM).
- **Fallback (sem `quoted.id` ou sem linha casada):** comportamento atual — scaffold
  textual + enriquecimento por prefixo + LLM. **Não** tenta adivinhar por título
  (YAGNI; a ambiguidade só some no caminho por-id).

## 6. Como o reply-quote casa o alvo (passo a passo)

```
SAÍDA (cron):  remindTask → sendMessage → res.data
               → proactiveLink.record(wa_message_id, ref_type='task', ref_id=<uuid>)
               → conversation_history { content, wa_message_id, ref_type, ref_id }

INBOUND:       webhook → extractQuotedMessage(body).id = stanzaID  (HOJE: descartado)
               → processMessage(phone, text, raw)
               → [REPLY-REF] extractQuotedMessage(raw).id
                 → SELECT ref_type, ref_id FROM conversation_history
                    WHERE wa_message_id = stanzaID AND ref_id IS NOT NULL
                 → carrega o objeto; vivo?  ── não → fallback (scaffold + LLM)
                                            └─ sim → injeta ctxHint ANCORADO
               → LLM emite <<TASK_UPDATE>> id=<ref_id> (nova data/lembrete)
               → pipeline de markers aplica  (recorrência NÃO é tocada)
```

## 7. Edge cases

- **Proativo antigo:** sem TTL agressivo; a guarda é **o estado do objeto** no momento
  da resposta (vivo? então ancora). WhatsApp manda stanzaID mesmo de msg antiga; se a
  linha de `conversation_history` foi podada, cai no fallback.
- **Vários proativos competindo:** stanzaID identifica **uma** mensagem → **um** `ref_id`.
  É exatamente o cenário que reprovou o fix do Lote A — resolvido pelo id.
- **Citação parcial / quoted truncado** (caso Quintela): irrelevante para o matching
  por id (não usa texto). O enriquecimento textual segue só para o LLM ler o contexto.
- **Buffer de agregação** ([webhook.js `messageBuffer`](../../../src/webhook.js)): o
  `latestRaw` é o raw da **última** msg do buffer. Quote na última msg → funciona.
  Quote numa msg **anterior** de um burst multi-msg → stanzaID se perde → fallback.
  **Limitação documentada da v1** (melhoria futura: o buffer carregar o `quotedId` por
  item). Não é silencioso: logar `[REPLY-REF] quote em msg não-última do buffer`.
- **Reply-quote a proativo que NÃO é tarefa/evento** (bom-dia, scorecard, comunicado):
  `ref_id` nulo → interceptor não dispara → fluxo normal.
- **Reply-quote a uma resposta reativa** do TOM: fora da v1 (não instrumentada), cai no
  fallback. O mecanismo serve a ela no futuro sem mudança de schema.

## 8. Tratamento de erro

- Todo o interceptor `REPLY-REF` é `try/catch` com fail-safe: erro → `console.warn` +
  segue o fluxo normal (igual aos interceptors vizinhos). **Nunca** bloqueia a resposta.
- `proactiveLink.record` nunca derruba o envio: falhou a gravação do vínculo → loga e
  segue (o proativo já foi enviado; pior caso = aquele lembrete cai no fallback textual).
- Validação de objeto morto evita "reagendar" tarefa concluída/cancelada.

## 9. Testes (trava de regressão — `node:test` nos módulos puros)

- `extractSentMessageId`: `{id}`, `{messageid}`, `{message_id}`, `{key:{id}}`, vazio→null.
- Resolvedor de alvo (função pura `resolveReplyTarget({ quotedId, rows, object })`):
  - casa por `wa_message_id` exato; ignora linha sem `ref_id`.
  - objeto `done`/`cancelled` → não ancora.
  - sem `quotedId` → não ancora (fallback).
  - 2 proativos, stanzaIDs distintos → cada citação resolve o seu (anti-ambiguidade).
- Não-regressão: reply-quote a card de **aprovação/fechamento** continua casando pelos
  detectores atuais (interceptor `REPLY-REF` não os intercepta — ordem e guarda de
  `ref_type` garantem isso).

## 10. Interação com o Balde A / HOLD (LER ANTES DE IMPLEMENTAR)

**NÃO tocar** (recorrência em observação): `recurrence-engine.js`,
`utils/recurring-dedup.js`, `utils/task-update-result.js`, os caminhos
`complete/cancel scope:"series"` do `engine.js`, e a **dedup** em
`system.js`/`dispatcher.js`.

- A ação final reusa o **marker `<<TASK_UPDATE>>` já existente** via LLM — **não** chama
  a máquina de recorrência nem helpers de série. `reschedule-reminders.js`
  (`shiftTaskRemindAt`) **não** é editado; é citado só como referência do que o
  pipeline de markers já faz ao mudar data.
- Os call-sites da §5.4 vivem em `dispatcher.js`. A instrumentação é **aditiva** (grava
  o vínculo após o envio) e **não** mexe na lógica de dedup/recorrência — mas, por
  estarem no mesmo arquivo do Balde A, a edição **depende do desbloqueio do Balde A ou
  de OK explícito do Alf**.

## 11. Protocolo de bugs (anti-regressão)

- **Ao implementar:** consultar `tom_known_issues` ANTES (regra do `CLAUDE.md`) pelos
  termos: *reply-quote, quoted, proativo, lembrete, reschedule, âncora, alvo*. Casos-irmãos
  já conhecidos (fontes locais): `CLOSING-INTERCEPTOR-OVERCAPTURE`, `GUARD-CONFIRM-LOOP`,
  `FECHAMENTO-ITEM-NO-ANCHOR`, `ALVO-FUTURO-RESPOSTA-CURTA`, `APROVACAO-SEM-FUNIL`,
  `RSVP-WRONG-EVENT-BARE`, `BUG-JORDAN`, `FIN-INVOICE-INTENT-KIND-CONSTRAINT`.
- **Ao corrigir:** registrar `REPLY-QUOTE-PROACTIVE-NOLINK` (área `marker`/`dispatcher`)
  com causa-raiz (stanzaID extraído e descartado; sem vínculo msg→task) e `fix_resumo`.
- ⚠️ **Pendência desta spec:** a consulta direta a `tom_known_issues` (Supabase) **não
  pôde ser feita** — o SSH para a VPS de produção foi bloqueado pelo classificador
  (escopo "só spec / read-only / HOLD"). O histórico relevante foi levantado pelas
  **fontes locais** (a spec do Lote A, os códigos de KI nos comentários do código e as
  memórias da sessão). Confirmar contra a tabela na fase de implementação (com OK).

## 12. Fora de escopo (YAGNI)

- Parser determinístico de "amanhã/prazo/lembrete" (o LLM já faz; o gap era o alvo).
- Instrumentar os ~30 emissores de proativo de uma vez (só os de §5.4 na v1).
- Aplicar reschedule sem LLM (decisão Q2 = ancorar + marker).
- Reply-quote em grupo e a respostas reativas (extensões futuras, mesmo schema).
