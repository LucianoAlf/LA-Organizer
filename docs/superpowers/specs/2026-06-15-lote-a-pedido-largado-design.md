# Lote A — "Pedido largado via ritual" (mensagem real vence o ritual)

**Data:** 2026-06-15
**Contexto:** Lote A do programa de correção do audit TOM 15/06 (6 lotes). Cluster vivo mais frequente e mais danoso à usabilidade (Fabi, Juliana, Leo, Yuri — confirmado adversarialmente). Causa-raiz no roteamento de intenção, **não** em finanças.

## Problema

O interceptor determinístico de fechamento (`engine.js:7748-7813`) — criado para o fix `FECHAMENTO-ITEM-NO-ANCHOR` (resolve "1, 2 - em andamento" contra os ids certos, sem o LLM chutar) — **sobre-captura**. Três pontos concretos, todos confirmados na conversa real:

1. **Janela de 16h corridas** (`withinConfirmWindow(asked_at, 16*60)`): o fechamento da noite anterior continua "aberto" de manhã e captura a resposta do dia seguinte. → **Fabi** (gap ~14h overnight, msg sobre governança virou resposta de fechamento).
2. **Ignora o reply-quote** (`stripReplyScaffold(text).userText` descarta *qual* mensagem foi citada): um "2"/"não" respondendo a OUTRA coisa (menu de duplicata, evento, governança) é capturado. → **Juliana** (reply a menu de dup), **Yuri** (item confundido).
3. **`parseClosingReply` regra #4 gulosa** (`closing-reply.js:121`): qualquer frase começando com "não" vira "não fiz nenhuma".

Primo do mesmo princípio: **#4 (Leo)** — fora de turno de ritual, com tarefas atrasadas salientes no contexto do briefing, o LLM emitiu `TASK complete` em lote ("Fechei: X, Y") em vez de tratar o pedido real (criar 2 eventos). Ninguém pediu pra fechar aquelas tarefas.

## Princípio

> **A mensagem real do usuário sempre vence o ritual.** O atalho determinístico só dispara quando é **inequívoco**; na dúvida, não rouba — segue o fluxo normal (LLM com contexto completo).

## Escopo

- **A1** — sobre-captura do interceptor de fechamento (pontos 1, 2, 3 acima).
- **A2** — `TASK complete` em lote não-ancorado fora de ritual (Leo).
- **Fora do Lote A:** #8 (Alf — reply-quote "muda pra amanhã" largado) **vai para o Lote D**. Mecanismo diferente (linkar a mensagem proativa de saída ao seu `task_id` para um reply-quote resolver), que o Lote D (proativos) já toca. Não inchar o caminho quente do A com duas mecânicas.

## Componentes

### 1. `shouldClosingInterceptorFire(args) → { fire: boolean, reason: string }` — helper PURO novo
Provável local: `src/utils/closing-reply.js` (junto de `parseClosingReply`), sem I/O. O interceptor (`engine.js:7748`) passa a consultá-lo antes de agir.

**Entradas:** `{ closingIntent, openIntents, replyParsed: {userText, quotedText}, now }`.

**Retorna `fire:true` somente se TODAS:**
- **(today)** `brtDay(closingIntent.asked_at) === brtDay(now)` — fechamento é de HOJE (BRT). Substitui `withinConfirmWindow(asked_at, 16*60)`.
- **(reply-quote)** se `replyParsed.quotedText` existe **e** NÃO casa o bloco do fechamento (não contém o header "Fechamento" nem nenhum `closing.items[].title`) → `fire:false` (o alvo é a mensagem citada, não o fechamento).
- **(fresher)** se existe outra intent aberta com `asked_at` mais recente que `closingIntent.asked_at` → `fire:false` (prefere a mais fresca; segue o fluxo normal).

Fail-safe: qualquer dúvida/erro → `fire:false` (nunca rouba no escuro). O interceptor, quando não dispara, simplesmente cai no fluxo existente (LLM), preservando 100% do comportamento atual fora dos casos de sobre-captura.

### 2. `parseClosingReply` — estreitar regra #4 (`closing-reply.js:121`)
Bare negação (→ "não fiz nenhuma") só quando a mensagem é **essencialmente só** a negação: `^(n[ãa]o|nao|nada|nenhuma)\b` **E** comprimento curto (ex.: `userText.trim().length <= 12` / sem conteúdo substantivo após o token). "não foi a ADM, foi a de hoje" → `matched:false`. Bare "não" / "nada" → `matched:true`.

### 3. Guard de `TASK complete` em lote não-ancorado (A2)
No handler de marker `TASK complete` (engine.js): um complete de **2+ tarefas** só é auto-aplicado se **(a)** ancorado a um fechamento de HOJE (via #1) **OU (b)** as tarefas foram **referenciadas** na mensagem inbound (número/título). Caso contrário: **não aplica**, loga `[Closing] batch-complete não-ancorado descartado` e segue o pedido real. Protege o caso legítimo ("fechei a 1 e 2", referenciado) e mata o sequestro (Leo). Complete de **1 tarefa** referenciada segue inalterado.

## Comportamento em ambiguidade (decisão do Alf, aprovada)
- **(a) Padrão** — aposta na intent mais fresca / pedido novo e segue, **sem perguntar de novo** (perguntar à toa também frustra).
- **(b) Exceção** — só quando a ação seria **completar/fechar** tarefa **e** há ambiguidade: o engine **não** fecha no escuro; o atalho não dispara e o TOM confirma em 1 linha (via fluxo LLM). Completar errado é caro de desfazer; criar/listar errado é barato.

## Fluxo de dados
`webhook → engine.processMessage → [interceptor fechamento ~7748]`. Hoje: acha closingIntent por janela 16h → aplica. Novo: acha closingIntent candidato → `shouldClosingInterceptorFire(...)` → se `true`, aplica (inalterado daqui pra frente); se `false`, **não** short-circuita, segue para RSVP/dup-bypass/LLM como hoje. Guard A2 atua no ponto onde markers `TASK complete` são aplicados.

## Tratamento de erro
Helpers puros nunca lançam (try/catch no interceptor já existe, `engine.js:7811`). Falha de leitura/parse → fail-safe `fire:false`. Nenhuma escrita nova; A2 apenas **deixa de** escrever quando não-ancorado.

## Testes (trava de regressão — `node:test` nos módulos puros)
Rodam ANTES (vermelho nos casos de bug) e DEPOIS (tudo verde):

| # | Caso | Esperado |
|---|---|---|
| 1 | Fabi — fechamento de ontem 21h, msg hoje 14h | `fire:false` |
| 2 | Juliana — reply-quote a menu de dup "2", fechamento hoje aberto | `fire:false` |
| 3 | Yuri — "1 - em andamento" ao fechamento de HOJE | `fire:true`, ancora item 1 ✅ (positivo) |
| 4 | Leo — "criar 2 eventos", tarefas atrasadas no contexto | batch-complete não-ancorado **não** aplica |
| 5 | `parseClosingReply`: "não foi a ADM, foi a de hoje" / bare "não" | `matched:false` / `matched:true` |
| 6 | Fechamento de HOJE, "fiz tudo" | todos `done` ✅ (positivo) |
| 7 | Fechamento de hoje, reply-quote AO PRÓPRIO bloco de fechamento, "1,2" | `fire:true` (reply-quote ao fechamento não bloqueia) |

Casos 3, 6, 7 = positivos (não pode quebrar o que funciona).

## Protocolo anti-regressão (na implementação)
1. Baseline: suíte inteira verde (`node --test` + `vitest`) antes de tocar.
2. Consultar `tom_known_issues` (regressão? caso-irmão? — `FECHAMENTO-ITEM-NO-ANCHOR`, `ALVO-FUTURO-RESPOSTA-CURTA`, `RSVP-WRONG-EVENT-BARE`).
3. TDD: testes acima falham → fix mínimo → verde.
4. Suíte inteira de novo: zero regressão.
5. Reproduzir com dado real (conversas Fabi/Juliana/Leo/Yuri) na VPS/preview antes do deploy.
6. Deploy isolado (scp engine.js + closing-reply.js + restart) → verificar no ar → registrar known issue `CLOSING-INTERCEPTOR-OVERCAPTURE`.
7. Um fix por causa-raiz; nada de "já que estou aqui".

## Fora de escopo (YAGNI)
- Disambiguação determinística por menu no caso ambíguo (confiar no LLM + guard; reavaliar se testes mostrarem flakiness).
- Reescrita do interceptor além do guard de entrada.
- #8 / reply-quote a proativos (→ Lote D).
