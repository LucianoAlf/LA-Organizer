# Auditoria — Fatia C: caminho da mensagem (transporte e tempo)

Escopo: `webhook.js`, `message-buffer.js`, `per-user-queue.js`, `ai/provider.js`, `ai/claude.js`,
`ai/openai.js`, `ai/claude-pool.js`, `ai/classify-claude-exit.js`, `whatsapp.js`, `audio.js`, `tts.js`,
`quiet-hours.js`, `dnd-window.js`, `outbound-queue.js`, `webhook-persistence.js`, `dedupe.js`, `shutdown.js`.
Leitura complementar (não é meu escopo, mas necessária pra fechar a cadeia de custódia da mensagem):
`engine.js` — apenas os pontos de entrada/saída (`processMessage`, chamada a `ai.chat`, chamada final a
`whatsapp.sendMessage`), `sanitize.js`, `prompt.js`, `group-chat-bridge-in.js` (checagem de `fromMe`).

Auditoria SOMENTE LEITURA — nenhum arquivo foi modificado.

---

## 1. CAMINHO COMPLETO

```
UAZAPI ──POST /webhook/:token──▶ webhook.js:503 router.post
  │
  ├─ webhook.js:505 verifyWebhookSignature(req)          [síncrono]
  ├─ webhook.js:511 res.status(200).json(...)            ← 200 IMEDIATO, antes de processar
  ├─ webhook.js:521 if (shutdown.isInShutdown()) → webhook-persistence.js:21 saveToQueue() e RETORNA
  └─ webhook.js:528 await processWebhookBody(req.body)    [não bloqueia a resposta HTTP, mas roda no mesmo tick]
        │
        ├─ webhook.js:162 dedupe.isDuplicate(body)                    → dedupe.js:61
        ├─ webhook.js:168 groupBridgeIn.maybeHandleGroupDelete(...)    → group-chat-bridge-in.js:107
        ├─ webhook.js:173 groupBridgeIn.maybeHandleGroupMessage(...)   → group-chat-bridge-in.js:136,140 (checa fromMe)
        ├─ webhook.js:192 whatsapp.isIgnorable(body)                  → whatsapp.js:261-269 (checa fromMe, isGroup)
        ├─ webhook.js:198-199 extractPhone / extractText              → whatsapp.js:225,209
        ├─ webhook.js:207-395 ramos de mídia (áudio/imagem/vídeo/documento/PDF)
        │     audio.js:272 transcribeAudio (Whisper) — só se não houver texto
        │     downloadMediaFromUazapi → audio.js:340/111 (retry 3x, backoff 0/1.5s/4s)
        ├─ webhook.js:408 extractQuotedMessage + enriquecimento via SELECT em conversation_history
        ├─ webhook.js:453 whatsapp.setTyping(...) — fire-and-forget, não bloqueia
        │
        ├─ webhook.js:462 inFlightBodies.add(body)   [marca para replay em shutdown]
        └─ webhook.js:463 messageBuffer.add(phone, text, body, onFlush)
              │  message-buffer.js:37-57 — debounce 3500ms (BUFFER_WINDOW_MS, linha 24).
              │  Cada nova msg do MESMO phone CANCELA o timer anterior (linha 44) e reinicia a janela.
              │  Quando a janela fecha sem novo evento → onFlush(items) roda (webhook.js:463-487)
              │
              └─ webhook.js:479 queue.enqueue(phone, () => shutdown.withTracking(async () => {...}))
                    │  per-user-queue.js:15-30 — Map<phone,Promise>; cada novo job é encadeado no
                    │  .then() do job anterior DESSE MESMO phone (linha 17-19). Serializa por usuário;
                    │  usuários diferentes correm em paralelo (Maps independentes).
                    │  shutdown.js:48-52 withTracking incrementa/decrementa activeProcesses (linha
                    │  39-46) — usado pelo graceful shutdown (shutdown.js:64-67) pra esperar antes do exit.
                    │
                    └─ webhook.js:481 await processMessage(phone, combinedText, latestRaw)
                          │  engine.js:8481 processMessage(phone, text, raw)
                          ├─ engine.js:8528 logConversation(collab.id, 'inbound', text)  ← grava ANTES de responder
                          ├─ engine.js:10434 buildSystemPrompt(...)
                          ├─ engine.js:10469 formatMessages(ctx.recentMessages, text)
                          └─ engine.js:10472 await ai.chat(systemPrompt, msgs)
                                │  ai/provider.js:6 chat(systemPrompt, messages, maxTokens)
                                ├─ provider.js:9 claude.chat(...)          → ai/claude.js:224 chat()
                                │     serial (default, TOM_CLAUDE_PARALLEL≠'1'):
                                │       claude.js:230 job = _claudeQueue.then(() => _chatInner(...))
                                │       claude.js:65 _claudeQueue é ÚNICA, GLOBAL (não por-usuário!)
                                │       claude.js:236-369 _chatInner: spawn('claude' -p ...),
                                │         killTimer em CLAUDE_TIMEOUT_MS=45000 (claude.js:38,294-299)
                                │       exit≠0 → classify-claude-exit.js:29 classifyClaudeExit(code,stdout,stderr)
                                │         (kinds: exit_auth, exit_rate_limit, exit_overloaded, exit_unavailable, exit)
                                └─ SE claude falhar (qualquer kind) → provider.js:17 openai.chat(...)
                                      → ai/openai.js:10 chat(): spawn('codex' exec ...),
                                        killTimer em CODEX_TIMEOUT_MS=60000 (openai.js:8,40-45)
                                      SE ambos falharem → provider.js:21-28 throw Error(kind='all_failed')
                          │
                          ├─ engine.js:10494 reply = response.text  (parser de markers — fora do meu escopo)
                          └─ engine.js:13024-13026
                                await whatsapp.sendMessage(phone, reply)   → whatsapp.js:37 sendMessage()
                                  (retry: até 3 tentativas, backoff 1.5s/3s — whatsapp.js:18-19,41-62,
                                   só p/ status 404/408/429/5xx ou sem-resposta — whatsapp.js:26-31)
                                await logConversation(collab.id, 'outbound', reply)  ← grava DEPOIS do envio confirmado
```

Filas de saída dedicadas (`outbound-queue.js`) e as janelas de silêncio (`quiet-hours.js`, `dnd-window.js`)
**não fazem parte deste caminho reativo** (resposta a uma mensagem recebida). Servem para envios
PROATIVOS (rituais, cobranças, lembretes, broadcasts) — `outbound-queue.js:11-23` espaça envios com
jitter pra evitar ban anti-spam do WhatsApp, e `quiet-hours.js`/`dnd-window.js` decidem SE um proativo
pode sair agora. Uma resposta direta a uma pergunta do usuário nunca passa por eles.

---

## 2. PONTOS DE PERDA

### 2.1 Falha de envio ou de IA no fim do fluxo = silêncio total, sem log de usuário nem retry
`engine.js:13024-13026` não tem `try/catch` ao redor de `whatsapp.sendMessage` + `logConversation`
(diferente de dezenas de outros ramos do próprio `engine.js`, que envolvem o mesmo padrão em
`try {...} catch(e) { console.warn(...) }` — ex. linhas 8546, 8572-8575, 9902, 9924, 9947). Se
`whatsapp.sendMessage` esgotar as 3 tentativas (`whatsapp.js:41-62`) — por exemplo em erro não-retriável
(400/401/403, `whatsapp.js:26-31`) — a exceção sobe por `processMessage` inteiro. O chamador em
`webhook.js:479-486` só tem `try{...} finally{...}`, SEM `catch` — o erro segue subindo até
`per-user-queue.js:19-23`, onde é só `console.error`. **O usuário nunca recebe nada, nenhuma mensagem de
"tive um problema" — a mensagem morre em silêncio.** O mesmo vale para `ai.chat` falhar nos dois
provedores (`engine.js:10472-10483` faz `throw err` de propósito após logar o marker `PROVIDER/rejected`).

### 2.2 Catch silencioso nos fallbacks de mídia do webhook (sem log, sem retry)
Em `webhook.js`, a maioria dos envios de mensagem de fallback (erro ao baixar imagem/vídeo/documento/PDF)
usa `.catch(() => {})` — descarta o erro SEM logar nada: linhas **267, 284, 303, 318, 338, 352, 361, 382,
390, 392**. Só a linha **226** (fallback de áudio) loga o erro (`.catch(e => console.error(...))`) — mostra
que o padrão correto já existe no mesmo arquivo, só não foi replicado. Se a UAZAPI estiver instável
justamente nesse momento, a mensagem de fallback também se perde, e não sobra nem rastro de log pra
diagnóstico.

### 2.3 Dedupe por hash de minuto pode confundir 2 mensagens legítimas iguais
`dedupe.js:40-53` — quando o payload não traz um id estável de mensagem (`getMessageId` retorna null,
`dedupe.js:21-38`), a chave de dedupe cai no fallback: `hash(phone|event|minuto|content[0..200])`
(`dedupe.js:46-52`). Duas mensagens IDÊNTICAS do mesmo usuário no mesmo minuto-relógio (ex.: "oi" e "oi"
de novo 20s depois, achando que não enviou) colidem na mesma chave e a segunda é descartada
silenciosamente em `webhook.js:162-165` (só loga no servidor — usuário não recebe nada).

### 2.4 Fila per-usuário chaveada por string de telefone não normalizada
`per-user-queue.js:15` usa `phone` cru (saído de `whatsapp.extractPhone`, `whatsapp.js:225-230`, que só
faz `.split('@')[0]`) como chave do `Map`. Não há normalização (9º dígito, prefixo `55`, etc.) antes de
enfileirar. Se a UAZAPI mandar o mesmo usuário real ora com, ora sem o 9º dígito/DDI — comportamento já
documentado como problema recorrente em outras partes do sistema (lookup de colaborador por variantes de
telefone) — duas mensagens da MESMA pessoa caem em DUAS chaves de fila diferentes e podem ser processadas
**ao mesmo tempo**, sem a serialização que `per-user-queue.js` deveria garantir.

### 2.5 Grava histórico "inbound" antes de qualquer resposta ser gerada
`engine.js:8528` — `logConversation(collab.id, 'inbound', text)` roda logo no início de
`processMessage`, antes do `ai.chat`. Isso não é, por si, um bug de perda (é a msg recebida, faz sentido
registrar cedo), mas combinado com o item 4 (enriquecimento de reply/quote em `webhook.js:402-447`)
significa que o texto que entra como "inbound" pode conter, embutido, um trecho de mensagem que o
PRÓPRIO TOM escreveu (ver seção 4).

---

## 3. TEMPO E CONCORRÊNCIA

### 3.1 Timeouts configurados
- Claude CLI: `CLAUDE_TIMEOUT_MS = 45000` (`claude.js:38`) — kill via `SIGKILL` (`claude.js:294-299`).
- Codex/OpenAI (fallback): `CODEX_TIMEOUT_MS = 60000` (`openai.js:8`, timer em `openai.js:40-45`).
- Pior caso por mensagem (Claude trava até estourar + cai pro Codex e ele também trava até estourar):
  **até ~105s** antes do `all_providers_failed` (`provider.js:21-28`), e nesse caso, pela seção 2.1, o
  usuário não recebe nada.
- UAZAPI (envio de texto): timeout de 15s no client axios (`whatsapp.js:15`), retry 2x extra com backoff
  1.5s/3s (`whatsapp.js:18-19,55-58`).
- UAZAPI (download de mídia): retry com backoff `[0, 1500, 4000]ms` (`audio.js:112,115-116`).
- ElevenLabs TTS: timeout 20s (`tts.js:62,77-80`).

### 3.2 Serialização GLOBAL do CLI Claude — ainda ativa por padrão
`claude.js:42` — `PARALLEL_ENABLED = process.env.TOM_CLAUDE_PARALLEL === '1'`, com o comentário na
própria linha 40 dizendo "Fase 1, default OFF". No caminho serial (`claude.js:229-233`), TODAS as
chamadas ao CLI `claude`, de QUALQUER usuário, passam por uma única fila de promise
(`_claudeQueue`, `claude.js:65`) — isso é **module-level**, não por telefone. Ou seja: mesmo que
`per-user-queue.js` isole corretamente por usuário, se o `TOM_CLAUDE_PARALLEL` não estiver ligado em
produção, uma chamada lenta/travada de UM usuário (até os 45s de timeout) **atrasa a resposta de todo
mundo**, porque a próxima chamada ao CLI só começa depois que a anterior terminar/der timeout. O próprio
comentário em `claude.js:29-36` descreve esse EXATO sintoma histórico ("TODA msg atrás travava junto →
TOM escrevendo a vida toda"). **Não consegui confirmar, só lendo o código, se `TOM_CLAUDE_PARALLEL=1`
está setado no `.env` de produção** — isso decide se esse ponto ainda é ativo hoje ou só um risco latente
do caminho de fallback.

### 3.3 Fila por usuário pode ficar presa?
Não encontrei um cenário de deadlock permanente: `per-user-queue.js:19` usa `.then(fn, fn).catch(...)`
— o próximo job sempre roda mesmo se o anterior rejeitar. A fila SÓ trava enquanto uma promise anterior
não resolve/rejeita — e isso é limitado pelos timeouts de `claude.js`/`openai.js`/`whatsapp.js` (nenhuma
chamada async no caminho é sem timeout, até onde revisei). Ou seja, o pior caso é atraso (fila
temporariamente lenta), não travamento permanente — mas ver 3.2 pra como um atraso de UM usuário pode
se propagar a outros via `_claudeQueue`.

### 3.4 Duas mensagens do mesmo usuário processadas ao mesmo tempo?
Pelo desenho normal (mesma chave de telefone), não — `message-buffer.js` agrega e `per-user-queue.js`
serializa. O único caminho realista pra concorrência real que encontrei é o 2.4 (chave de fila não
normalizada) — ver acima.

---

## 4. REENTRADA

**Veredito: existe verificação de remetente-próprio, mas ela é única, frágil e sem defesa em profundidade.**

- `whatsapp.js:261-269 isIgnorable(body)` — único ponto no caminho 1:1 que descarta mensagens do próprio
  bot: `if (msg.fromMe === true) return true;` (linha 266). Comparação estrita, **um único campo**
  (`msg.fromMe`, onde `msg = getData(body)`), sem variantes.
- `group-chat-bridge-in.js:140` — mesmo padrão (`data.fromMe === true`), só que no ramo de grupo.
- **Não há um segundo ponto de checagem em `engine.js`/`processMessage`** — se uma mensagem passar dessas
  duas checagens (por engano ou por um formato de payload não coberto), ela é tratada como mensagem
  normal do usuário, sem nenhuma trava adicional a jusante.
- Isso contrasta com o resto do próprio `whatsapp.js`: os detectores de tipo de mensagem
  (`isAudioMessage`, `_typeCandidates`, `whatsapp.js:134-165`) checam **4 campos candidatos**,
  case-insensitive, justamente porque a UAZAPI já mudou o formato do payload no passado (comentário
  "Sprint 9 hotfix-3" na própria linha 130-133). O `fromMe` não recebeu o mesmo tratamento defensivo —
  é o único sinal de identidade do remetente e o único que ainda depende de um único campo exato.

**Duas hipóteses concretas para o episódio de 26/07 (não comprovadas — sem acesso a logs/payload real do
incidente, não dá pra dizer qual ocorreu):**

1. **Enriquecimento de reply/quote (mecanismo intencional, mas confundível):** `webhook.js:402-447`.
   Quando o usuário responde (reply) a uma mensagem antiga do TOM, o webhook busca em
   `conversation_history` (direction='outbound') o texto completo da mensagem citada
   (`webhook.js:413-434`) e monta: `text = "[O usuário está RESPONDENDO a esta mensagem anterior: '<texto
   que o TOM escreveu>']\n<texto novo do usuário>"` (`webhook.js:439`). Esse `text` combinado é gravado
   como `direction='inbound'` em `engine.js:8528`. Ou seja: **por desenho**, uma linha `inbound` no banco
   pode conter, literalmente, um trecho que o próprio TOM escreveu — só que embrulhado entre colchetes
   como contexto. Quem olhar a tabela crua (não a UI com colchetes) vê exatamente "mensagem escrita pelo
   agente reaparecendo como se fosse do usuário".
2. **Falha silenciosa do `fromMe` num payload de eco de envio:** se a UAZAPI, para algum tipo de envio
   (ex.: `/send/media`, `/message/react`, ou uma variação de payload ainda não vista), reenviar ao webhook
   um evento "message" referente à PRÓPRIA mensagem que o TOM acabou de mandar, com `fromMe` ausente ou
   em formato diferente de booleano estrito `true` — `isIgnorable` (`whatsapp.js:266`) não pega, e a
   mensagem do TOM entra no pipeline como se fosse do usuário. Não tenho evidência direta de que isso
   aconteceu (não tenho o payload real do incidente), mas é um mecanismo plausível e não coberto por
   nenhuma defesa redundante no código.

Não encontrei nenhum outro caminho no meu escopo (buffer, fila, dedupe) que reintroduza uma mensagem já
enviada como se fosse nova — `dedupe.js` opera sobre eventos de ENTRADA, não tem noção de "isso é uma
saída minha".

---

## 5. RECOMENDAÇÕES CIRÚRGICAS

| # | Ponto frágil | Menor conserto | Risco do conserto |
|---|---|---|---|
| 1 | `engine.js:13024-13026` sem catch — falha de envio final é silêncio total pro usuário | Envolver em `try/catch`; no catch, tentar 1x `whatsapp.sendMessage(phone, 'tive um problema técnico, tenta de novo?')` e sempre `console.error` | Baixíssimo — só adiciona rede de segurança, não muda o caminho feliz |
| 2 | `webhook.js:267,284,303,318,338,352,361,382,390,392` — `.catch(() => {})` silencioso | Trocar por `.catch(e => console.error('[Webhook] fallback send err:', e.message))`, igual já feito na linha 226 | Zero — é só logging, padrão já existe no mesmo arquivo |
| 3 | `claude.js:65,230-233` — fila global do CLI ainda é o caminho padrão (`TOM_CLAUDE_PARALLEL` default off) | Confirmar no `.env` de produção se a flag está ligada; se não estiver, é a explicação mais provável pro "TOM demorando/travando pra todo mundo" e vale ligar (já existe pool testado em `claude-pool.js`) | Médio — muda comportamento de concorrência real; exige observar credenciais/pool em produção antes de ativar |
| 4 | `dedupe.js:40-53` — colisão de dedupe por minuto quando falta id estável | Reduzir a granularidade do bucket (ex. 15s) e/ou usar o texto inteiro (não só 200 chars) no hash | Baixo — pequena chance de aumentar falsos-negativos de dedupe (reprocessar um retry legítimo), mas prioriza nunca perder mensagem real |
| 5 | `per-user-queue.js:15` — chave de fila = telefone cru não normalizado | Normalizar o telefone (mesma função de canonicalização já usada no lookup de colaborador, ex. `brPhoneVariants`) antes de `queue.enqueue`/`messageBuffer.add` | Baixo-médio — precisa garantir que a normalização não junte números de pessoas DIFERENTES por engano |
| 6 | `whatsapp.js:266` / `group-chat-bridge-in.js:140` — `fromMe` checado só como campo único, sem fallback | Ampliar a checagem pra múltiplos campos candidatos (mesmo padrão de `_typeCandidates`, `whatsapp.js:145-153`) e, defesa em profundidade, repetir a checagem no início de `processMessage` (comparando o telefone do evento com o número do próprio bot) | Baixo — é estritamente mais restritivo, mas testar contra payloads reais antes de deployar pra não passar a descartar mensagens legítimas |
| 7 | `webhook.js:402-447` — texto do TOM embutido em linha `inbound` | Gravar o snippet citado num campo separado (ex. `quoted_context`) em vez de dentro de `content`, ou marcar a linha com `content_kind='reply_with_quote'` | Baixo — mudança de shape de dados; exige checar todo consumidor de `conversation_history.content` que hoje espera só o texto puro |
| 8 | `message-buffer.js:24` — janela de 3.5s pode ser curta pra digitação humana em várias bolhas | Medir na produção o intervalo real entre bolhas do mesmo usuário (histórico de timestamps) antes de subir o valor; se confirmado, subir pra 5-6s | Baixo, mas aumenta a latência percebida pra TODA mensagem (mesmo as que não fariam parte de uma sequência) |

---

## O que ficou sem cobrir

- **Alerta ativo de fallback prolongado ("Sentinela")**: `classify-claude-exit.js:35` menciona em
  comentário que "a Sentinela paga o dono na hora" em caso de `exit_auth`, mas o código dessa Sentinela
  não está nos arquivos da minha fatia — não consegui verificar se ela realmente dispara, com que
  atraso, ou se cobre os outros `kind`s (`exit_rate_limit`, `exit_overloaded`, `exit_unavailable`). Só
  confirmei que o **sinal existe em log/marker** (`provider.js:15,19`, `engine.js:10490-10493`
  `logMarker('PROVIDER','fallback',...)`), não que alguém é avisado ativamente.
- **Payload real do incidente de 26/07**: não tive acesso a logs/banco de produção — as duas hipóteses da
  seção 4 são mecanismos plausíveis lidos no código, não a causa confirmada. Recomendo puxar a linha
  exata de `conversation_history` daquele dia (direction, content, created_at) pra decidir entre as duas
  hipóteses (ou descartar ambas).
- **Estado atual de `TOM_CLAUDE_PARALLEL` em produção**: não tenho acesso ao `.env` do VPS nesta
  auditoria — é o dado que faltava pra saber se o achado 3.2 é ativo hoje ou só risco latente.
- **`ai/openai.js` process.env completo**: o spawn do Codex usa `env: process.env` (linha 36) — herda
  TODO o ambiente do processo pai, diferente do isolamento cuidadoso que `claude.js` faz (`buildEnv`,
  `claude.js:67-77`, HOME isolado). Não aprofundei se isso é um problema de superfície de exposição
  (não é meu foco de segurança nesta fatia), só registro que a assimetria existe.
- **Lógica de markers, `pending_intents`, e tudo que acontece ENTRE `ai.chat` retornar e o `sendMessage`
  final** (parsing, persistência de tarefas/eventos/financeiro) — é a fatia do outro auditor (lógica
  interna do engine); só toquei nela para fechar a cadeia de custódia da mensagem (entrada→saída), não
  avaliei a corretude desses ramos.
- **Grupos (chat coletivo)** — toquei em `group-chat-bridge-in.js` só para checar a barreira `fromMe`; não
  auditei o resto do pipeline de espelhamento de grupo (fora do escopo desta fatia, que é focada no
  diálogo individual).
