# Rede determinística de confirmação de coordenação (caso Fabi 10/07)

**Status:** design aprovado no approach (A), aguardando revisão da spec pelo Alf.
**Origem:** auditoria 10/07 (caso Fabi). Ver [[project_audit_1007]].

## Problema

Quando o TOM vai mandar um recado/agradecimento a outra pessoa, ele SEMPRE pergunta
"Aviso o Fulano? Confirma?" antes (política do system.js:71 — ação que toca outra pessoa
nunca dispara no 1º turno). Hoje esse fluxo depende do LLM **re-emitir** o
`<<COORDINATION_REQUEST>>` no turno do "sim".

**Caso Fabi (09/07 16:46):** "agradeça ao Jhonatan" → TOM "Mando um agradecimento pro
Jhonatan? Confirma?" → "Sim" → **nada enviado**. O LLM confabulou "avisei" sem emitir o
marker; o chokepoint (SEND-CLAIM-NOMARKER) segurou a mentira, mas o destinatário se perdeu.
Prova: `marker_logs COORDINATION_*` vazio em ~28h; nenhum `pending_intent` de coordenação
foi aberto no 1º turno → o "sim" não tinha **nada** pra executar deterministicamente.

É a MESMA classe do FIN-CONFIRM-CONFAB-NOOP ([[project_fin_confirm_camada2]]) e do
BATCH-COMPLETE-CONFIRM-NOOP — resolvidos pro financeiro e pro fechamento em lote com rede
determinística, mas **coordenação nunca ganhou a rede**.

## Approach escolhido: A — estagiar, espelhando o financeiro

O LLM emite o `<<COORDINATION_REQUEST>>` **no 1º turno** (com recipient/message/mode) e
escreve a pergunta "Aviso o Fulano? Confirma?". O engine **estagia** o payload (abre um
`pending_intent`, NÃO envia) e mostra a prosa do LLM. No "sim", o engine executa o
`applyCoordinationRequestAction` (executor determinístico que **já existe**, engine.js:1836/
:11515 — resolve destinatário por nome e envia), sem depender do LLM re-emitir.

**Por que A e não o detector pré-LLM (B):** a extração de destinatário/mensagem de fala
livre ("avisa o Fulano que…") é justo o que o LLM faz melhor que um regex no engine. A usa
a extração do LLM (robusta) e só move a emissão do marker pro 1º turno; B extrairia no
engine (frágil). Ambos reusam o executor existente.

**Voz intocada:** a pergunta "Aviso o X? Confirma?" continua sendo **escrita pelo LLM**
(prosa/`cleanText`); o engine só estagia o payload e ecoa essa prosa. Muda a MECÂNICA
(quando o marker é emitido: 1º turno estagiado em vez de re-emitido no 2º), não o tom.

## Arquitetura (3 pontos + 1 ajuste de prompt)

### 1. Staging — bloco de coordenação (engine.js ~11510, ramo `parsedCoord.items`)
**Fail-SAFE (correção da catraca — inegociável):** estagiar é o **DEFAULT**. Todo
`COORDINATION_REQUEST` que chega em `parsedCoord.items` está em escopo (toca outra pessoa)
e a política é sempre-confirmar. O helper NUNCA pode cair em "envia direto por omissão"
(fail-OPEN: um mode inesperado/ausente → **envio cego sem confirmação** = pior caso proibido).
- `shouldStageCoordination(items, opts)` retorna `true` por default; só uma exceção FUTURA
  explicitamente segura poderia retornar `false`. **Envio direto nunca é o default.**
- Defesa em profundidade (não é a trava): o parser já rejeita mode fora do escopo
  (`parseCoordinationRequestMarker` → schema_invalid, engine.js:1582; COORD-REQUEST-ALIAS
  normaliza relay/assisted/follow-up), então `items` só existe com mode ∈ {relay_literal,
  relay_assisted, followup}. O helper **não depende** disso — é só corroboração.
- Pior caso aceitável = perguntar à toa (user responde "não"). Pior caso **proibido** = enviar sem confirmar.

**Estagia (sempre, em escopo):**
- `openIntent(collab.id, 'confirmation', { coordination: { items } }, previewText)`.
- `reply = parsedCoord.cleanText` (a pergunta do LLM) — fallback `buildCoordinationConfirmPreview(items)` se cleanText vazio.
- `_metrics.awaiting_user_confirm = true`. **NÃO envia.**
- Se `openIntent` retornar null (drift de CHECK) → honesto ("não consegui preparar o envio, me manda de novo"), NUNCA finge (espelha o financeiro 11717).

### 2. Execução no "sim" — handler de confirmação (engine.js ~9548, novo ramo ao lado do batch_complete, ANTES do genérico 9570)
Quando `userConfirm === 'yes'` e `Array.isArray(target.payload?.coordination?.items)`:
- Para cada item: `applyCoordinationRequestAction(collab, item)` (determinístico).
- `resolveIntent(target.id, 'confirmed', ...)`.
- Monta o reply de resultado reusando a lógica atual (ok/falhas, 11530-11542): sucesso →
  confirma; falha (recipient não encontrado) → usa `result.replyText`.
- `return` (não cai no genérico 9570 → o LLM NÃO re-emite).

> **Sem loop (importante):** este handler roda **pré-LLM** (auto-resolve, 9500). Quando o
> "sim" casa o intent de coordenação, executa e dá `return` — o LLM **não é chamado** no 2º
> turno, então não há como re-emitir o marker e re-estagiar. Se o "sim" não casar (intent
> expirado >20min, ou fala ambígua), cai no LLM normalmente (re-pergunta) — 1 interação por
> turno, nunca loop.

### 3. Negação — "não" (handler ~9586)
`payload.coordination` + `userConfirm === 'no'` → `resolveIntent('denied')` + "Beleza, não
avisei ninguém. Quando quiser é só mandar."

### 4. System prompt (system.js:71) — ajuste mínimo, sensível
De *"NÃO emita o marker no 1º turno; só emita o `<<COORDINATION_REQUEST>>` DEPOIS do sim"*
→ *"emita o `<<COORDINATION_REQUEST>>` quando o user pedir pra avisar alguém E escreva a
pergunta 'Aviso o Fulano? Confirma?'; o engine confirma com o user ANTES de enviar (não
envia na hora)."* **Ponto de atenção:** a Regra 12/chokepoint (afirmar envio exige marker)
continua válida — o marker agora ESTAGIA em vez de enviar. A mudança tem que preservar o
tom e não abrir brecha de confab. Voz = sagrada ([[feedback_tom_comportamento_sagrado]]).

## Componentes (helpers PUROS, testáveis isolados)
- `shouldStageCoordination(items, opts)` → boolean. Estagia relay/aviso que toca outra
  pessoa; não estagia o que já vem confirmado ou o que não deve perguntar. Puro.
- `buildCoordinationConfirmPreview(items)` → string. Fallback da pergunta quando o LLM não
  escreveu prosa (1 destinatário: "Aviso o {X}? Confirma?"; N: lista). Puro.
- **Reuso:** `applyCoordinationRequestAction` (executor determinístico existente — NÃO mexer).

Novo módulo: `src/coordination/coord-confirm.js` (os 2 helpers) + `.test.js`.

## Data flow
```
1º turno: "agradeça ao Jhonatan"
  → LLM: <<COORDINATION_REQUEST>>{recipient_name:"Jhonatan", message_body:"…", mode:"relay_assisted"}
         + prosa "Aviso o Jhonatan? Confirma?"
  → engine: shouldStageCoordination=true → openIntent('confirmation', {coordination:{items}}, prosa)
         → reply = prosa (NÃO envia)
2º turno: "Sim"
  → detectUserConfirmation='yes' → acha intent coordination
  → applyCoordinationRequestAction(cada item) → ENVIA → resolveIntent('confirmed')
```

## Escopo
**Dentro:** coordenação 1:1 via `<<COORDINATION_REQUEST>>` (relay_literal, relay_assisted,
followup). **Fora:** `COORDINATION_RESPONSE` (resposta a recado recebido — fluxo distinto);
coordenação de grupo (task-groups/group-chat — outro caminho); qualquer mudança no executor.

## Error handling
- `openIntent` null (drift CHECK) → honesto, não finge (espelha financeiro).
- `applyCoordinationRequestAction` falha no sim → `result.replyText` do handler (11537).
- Marker malformed no 1º turno → guard atual (11492) trata (honesto).
- Intent expira em 20min (janela padrão, 9519) — coerente com os outros.
- Idempotência: intent resolvido não re-executa.

## Testing
- Unit: `shouldStageCoordination` (estagia relay; não estagia fora de escopo) +
  `buildCoordinationConfirmPreview` (1 e N destinatários).
- `node --check` engine.js + o módulo novo.
- Regressão adjacente: KIs de coordenação NÃO podem quebrar — COORD-SEND-CONFAB-STRIP,
  SEND-CLAIM-NOMARKER, COORD-RESPONSE-*, COORD-REQUEST-ALIAS.
- E2E ao vivo na VPS (pós-deploy da catraca): "agradeça ao X" → estagia + "sim" → envia;
  conferir `marker_logs COORDINATION_REQUEST executed` + entrega.

## Guarda-corpos da catraca (dobrar no plano de implementação)
1. **Fail-safe do staging** (§1) — `shouldStageCoordination` default = estagiar; teste que
   prova que mode ausente/inesperado → estagia (nunca envia cego).
2. **Q1 (system.js:71) — texto EXATO antes/depois no plano** pra o Alf dar o aval final
   antes do deploy (zona sagrada da voz). Nada de prompt sobe sem esse OK.
3. **Teste anti-over-emissão** — menção casual que NÃO é pedido de recado ("o Jhonatan é
   gente boa", "falei com a Ana ontem") NÃO pode virar `COORDINATION_REQUEST`/estágio.
   Vale como fixture de prompt + asserção de que o engine não abre intent nesses casos.
4. **Golden de voz** — a pergunta "Aviso o X? Confirma?" tem que ler IGUAL ao de hoje (é
   prosa do LLM, `cleanText`, segue intacta); o fallback `buildCoordinationConfirmPreview`
   só entra quando não há prosa, e deve soar no tom do TOM.

## Riscos
1. **System prompt** (voz sagrada) — mitigado: a pergunta continua sendo prosa do LLM;
   muda só a mecânica de emissão. Mudança mínima e revisável.
2. **Dependência: o LLM emitir o marker no 1º turno de forma confiável** — é 1-turno (menos
   superfície de confab que o "re-emite depois do sim" de hoje); o `[RELAY_OVERRIDE]`
   (9960) já força o marker em relays explícitos. Rede: SEND-CLAIM-NOMARKER continua ativo.
3. **Deploy do hunk engine.js** é da catraca (cirúrgico) — o módulo novo + testes são meus.
