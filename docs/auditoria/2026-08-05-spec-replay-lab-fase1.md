# Spec — TOM Replay Lab, Fase 1

**Data:** 05/08/2026 · **Autor:** Claude (catraca) · **Para auditoria:** Alfredo · **Decisão:** Alf
**Estado:** spec. **Nenhuma linha de código escrita.**

---

## 1. O problema que isto resolve

O TOM tem 2.198 testes verdes e continua quebrando em produção. Não é contradição: os
testes provam **serviço**, e o que quebra é **comportamento**.

Fui conferir os 10 `e2e-*.js` que já existem no repo: **nenhum passa pelo webhook**. Todos
chamam funções de serviço direto — ou seja, **pulam o LLM**. Eles pegariam o bug do
`MEMORY_SAVE.body` (contrato de campo), mas jamais pegariam "o TOM prometeu e não emitiu
marker", que é a falha dominante medida no diagnóstico de 04/08: 76 casos, 22 de ~30 pessoas.

## 2. O que a Fase 1 é — e o que não é

**É:** injetar mensagens no **webhook real**, com autenticação, usando perfis de QA
isolados, e verificar o **estado do banco** depois — atravessando webhook → engine → LLM →
parser de marker → executor → cron.

**Não é:** número de WhatsApp novo (Fase 2), nem teste na conta de pessoa real (nunca).

**Cobre 95% do caminho.** O que fica de fora: entrega física no WhatsApp, `whatsapp_message_id`
real da UAZAPI, áudio de verdade. Esses três vão para a Fase 2 — declarados, não escondidos.

---

## 3. A trava que define o desenho: **o LLM não é determinístico**

Está provado, com dado de produção. A frase *"Estou fazendo Tom, hoje termino"*, do Alf,
respondendo à **mesma** cobrança:

| quando | resultado |
|---|---|
| dia do incidente, 13:02 | "não consegui registrar isso agora, me manda de novo" |
| 03/08, 16:25 | "Boa! Reagendo pra hoje" — funcionou |

**Consequência:** um cenário que roda uma vez e fica verde não prova nada. Rodar assim
recria em escala o falso-verde que custou treze rodadas no router — só que com cara de
"teste real", que é pior, porque dá confiança.

### Critério de aceite é TAXA, não passa/falha

Cada cenário roda **N vezes** e declara um piso:

```
cenário: resposta-a-cobranca-em-andamento
  N = 20
  aceite:
    - baixa/reagendamento registrado no banco  ≥ 19/20   (95%)
    - duplicidade                              = 0/20    (absoluto)
    - outbound para número fora da lista QA    = 0/20    (absoluto)
    - recibo (marker executed) persistido       ≥ 19/20
```

Dois tipos de critério, de propósito:

- **estatístico** para o que depende do LLM (emitir marker, entender a intenção);
- **absoluto** para o que é determinístico (duplicar, vazar mensagem para gente real). Se um
  desses falhar **uma vez**, o cenário reprova — não existe "95% de não vazar".

**Ganho colateral:** passamos a medir se um fix levou de 60% para 95%. Hoje só sabemos
"passou".

---

## 4. Perfis de QA

**Quatro perfis** (`QA-01` a `QA-04`), com telefones em faixa reservada e inválida para
WhatsApp — nunca um número que possa existir.

Por que quatro: a fila do TOM (`per-user-queue`) **serializa por telefone**. Com
`processMessage` levando ~20s, 20 cenários × 5 repetições num perfil só dá ~33 min. Com
quatro perfis em paralelo, ~10 min — dá para rodar antes de um merge.

**Fonte única de verdade do que é QA:** variável de ambiente

```
TOM_QA_PHONES=5500000000001,5500000000002,5500000000003,5500000000004
```

Escolhi env em vez de coluna `is_qa` no banco: reversível sem deploy e sem migration. Com a
lista **vazia** — que é o estado normal de produção — todo o código de QA vira no-op.
Trade-off declarado: env não é auditável por query; se o Alfredo preferir coluna, a spec
muda em um ponto só.

Os perfis são criados por script versionado (`INSERT` idempotente), com nome prefixado
`[QA]`, e **nunca** entram em grupo, governança ou delegação.

---

## 5. Autenticação — a trava 1

**Correção da v1 desta spec.** Eu tinha escrito `WEBHOOK_AUTH_MODE` e "dois métodos". Fui
conferir o verificador, como o Alfredo exigiu, e as duas coisas estavam erradas. O que
`verifyWebhookSignature` faz de fato, em ordem:

| ordem | método | como valida |
|---|---|---|
| 1 | `url_token` | `/webhook/<token>` comparado ao `WEBHOOK_SECRET` (`timingSafeEqual`) |
| 2 | `static_header` | header **igual ao secret literal** — não é HMAC nenhum |
| 3 | `hmac` | `sha256=<hex64>`, HMAC-SHA256 do **rawBody em bytes** |

- variável de enforcement: **`WEBHOOK_HMAC_ENFORCE=true`** → `strict` (hoje ausente ⇒ `permissive`);
- header configurável por `WEBHOOK_SIG_HEADER` (default `x-webhook-signature`);
- exige `req.rawBody` como Buffer não-vazio, senão `no_raw_body`.

**A armadilha que isso revela:** mandar o secret literal no header **passa pelo método 2** e
o teste ficaria verde sem exercitar HMAC nenhum. O laboratório assina sempre pelo método 3,
e a assinatura é sobre **os bytes exatos enviados** — o injetor serializa uma vez e assina
aquele buffer, nunca reserializa.

### Achado de segurança: **`strict` não é estrito**

Auditando para escrever esta seção: com `WEBHOOK_HMAC_ENFORCE=true`, tanto `url_token`
quanto `static_header` retornam `ok: true` — o handler só devolve 401 quando
`mode === 'strict' && !sig.ok`. Ou seja, **hoje o modo "strict" aceita o secret literal no
header e o token na URL**. Quem ligar a flag achando que exigiu HMAC, não exigiu.

A v1 desta spec dizia que o laboratório rejeitaria esses casos "mesmo que o TOM aceite".
**Isso estava errado e o Alfredo tem razão:** seria o teste maquiando um furo do produto. A
prova tem que ser o **status HTTP real**.

### Por que NÃO vou "corrigir o strict" — e o que faço no lugar

O próprio comentário do `webhook.js` diz: *"URL token (**UAZAPI atual**):
`/webhook/<WEBHOOK_SECRET>`"*. **A UAZAPI autentica por token na URL.** Se eu mudar `strict`
para recusar `url_token`, no dia em que alguém ligar `WEBHOOK_HMAC_ENFORCE=true` o TOM
**para de receber mensagens do WhatsApp inteiro** — troco um furo de auditoria por uma
queda total.

Uso então a alternativa que o próprio Alfredo ofereceu: **modo HMAC-only explícito**.

```
WEBHOOK_HMAC_ONLY=true   # novo, default false — recusa url_token e static_header
```

E ele **não roda em produção**: os testes de autenticação sobem uma **instância efêmera do
TOM real** — mesmo código, mesmo verificador, `PORT=3199`, com a flag ligada e sem a UAZAPI
apontando para ela. Nenhuma janela em que a entrada de produção fique exposta ou quebrada.

### Testes negativos — status HTTP real, não validação do injetor

Contra a instância efêmera, `WEBHOOK_HMAC_ONLY=true`:

| caso | esperado | tipo |
|---|---|---|
| sem header de assinatura | **401** | absoluto |
| HMAC inválido (hex trocado) | **401** | absoluto |
| HMAC de **outro corpo** (mesma chave, body diferente) | **401** | absoluto |
| **secret literal no header** (`static_header`) | **401** | absoluto |
| **token na URL** (`url_token`) | **401** | absoluto |
| HMAC válido do `rawBody` | **200** + mensagem processada | absoluto |

Todos absolutos: **uma passagem indevida reprova a bateria inteira**. E o veredito é o
código de status devolvido pelo TOM — o injetor não julga nada.

**Nota para a Fase 2:** o achado de que `strict` aceita url_token/static_header fica
registrado como questão aberta de segurança do produto, independente do laboratório. Decidir
se `strict` deveria ser renomeado ou endurecido é assunto do Alf, não desta spec — e exige
antes confirmar por qual método a UAZAPI está autenticando hoje.

**Consequência aceita explicitamente:** injetar exige a porta 3100. O laboratório roda **de
dentro da VPS** (`localhost:3100`). Nada de expor porta.

---

## 6. Fixture — payload real, não inventado

O corpo é **capturado da produção** e parametrizado. Formato real (colhido do log hoje):

```json
{"BaseUrl":"https://lamusic.uazapi.com","EventType":"messages","chat":{...},"message":{...}}
```

O fixture troca apenas: `sender`/`chatid` (perfil QA), `id` (id sintético com prefixo
`QA-<run_id>-<n>`), `text` e, quando o cenário exige, o bloco de citação.

**Por que capturado e não escrito à mão:** o `getData` tolera três formatos diferentes de
envelope. Um fixture inventado testaria o formato que eu *imagino*, e o TOM quebra no que a
UAZAPI *manda*.

---

## 7. Isolamento — travas 2, 3 e 4

### 7.1 Nenhum outbound sai para fora (trava 2) — **redesenhada**

**A v1 desta spec tinha um furo grave, apontado pelo Alfredo.** Eu havia escrito: "se o
destinatário está em `TOM_QA_PHONES`, não posta". Isso suprime o destino **que já é QA** — e
deixa passar exatamente o caso perigoso: durante um replay, o TOM decide **avisar um
terceiro** (delegação, "avisa a Gabi", notificação de coordenação). Esse destino não está na
lista, a trava não age, e **a mensagem chega numa pessoa real**.

Não é hipótese: "recado a terceiro não encaminhado" é um dos padrões dos 76 casos — ou seja,
é um cenário que eu **quero** testar, e ele vazaria por construção.

**Desenho correto — a trava é sobre o MODO, não sobre o destino:**

```
se existe execução de replay ativa (run_id no contexto do turno):
    destino ∈ faixa QA reservada  → suprime, registra outbound_suppressed, id sintético
    qualquer outro destino        → FALHA FECHADA: não posta, aborta o cenário,
                                     grava evidência `destino_proibido` com o número
senão (produção normal):
    comportamento atual, intocado
```

O contexto de execução usa o **`AsyncLocalStorage` que já existe** em
`services/turn-claim.js`, com um campo a mais para o `run_id`. Nenhuma estrutura nova.

**Onde mora:** `_postEnviar`, o ponto único criado na Fatia 3. Mas — e isto é o item 3 da
auditoria — *"ponto único" só vale se a prova cobrir os caminhos*. Cobertura obrigatória,
uma asserção por rota:

| rota | verificação |
|---|---|
| texto (`/send/text`) | 0 chamadas UAZAPI, `outbound_suppressed` gravado |
| menu botão + lista (`/send/menu`) | idem, nas duas variantes |
| mídia/sticker (`/send/media`) | idem |
| voz/ptt (`/send/media` type=ptt) | idem |
| reação (`/message/react`) | idem |
| **fallback de mídia** (webhook, antes do turno) | idem — é o caminho que escapou do gate na Fatia 3 |

E o par negativo em cada uma: **destino fora da faixa ⇒ falha fechada**, nunca envio.

Com isso o cron pode disparar de verdade contra o perfil QA — que é o que queremos, já que
cobrança indevida é um dos bugs — sem que nada saia.

### 7.2 QA fora das métricas (trava 3)

Os cenários vão gerar exatamente os sintomas que o detector procura. Sem exclusão, o
laboratório **contamina `tom_audit_findings`** — e a métrica que estamos usando para
priorizar passa a contar teste como falha real. Seria eu sabotando meu próprio diagnóstico.

Exclusão em três lugares, todos pela mesma lista: gravação de findings, agregações da
auditoria diária e `marker_logs` das métricas de saúde. Os `marker_logs` **continuam sendo
gravados** (o laboratório precisa deles como evidência) — só saem das agregações.

**Isolamento é guard testado, não convenção** (item 4 da auditoria). Criar o perfil com nome
`[QA]` não impede nada — é etiqueta. Cada fronteira ganha um guard com teste próprio:

| fronteira | guard | teste |
|---|---|---|
| chat de grupo | perfil QA não entra em `work_group_members` nem é aceito por `group-chat-bridge-in` | tentar adicionar ⇒ recusa |
| delegação | tarefa de QA não pode ser delegada a não-QA, nem o inverso | tentativa cruzada ⇒ recusa |
| governança | QA fora de `governance_edges` e dos digests de liderança | digest não menciona QA |
| métricas | findings/agregações ignoram QA | rodar bateria ⇒ contagem de produção inalterada |

O último é o mais importante e o mais fácil de esquecer: **rodar uma bateria inteira e
provar que os números de produção não se moveram.**

### 7.3 Concorrência e correlação (trava 4)

Cada bateria tem um `run_id` (ULID). Todo artefato — inbound sintético, marker, outbound,
finding — carrega esse id, via prefixo no `wa_message_id` (`QA-<run_id>-<n>`).

Concorrência limitada a **4** (um por perfil). Não é limitação técnica: é a fila por
telefone. Mais perfis = mais paralelo, e a spec não fixa o teto em quatro para sempre.

**Cada repetição começa de fixture limpa** (item 5 da auditoria). Sem isso, a repetição 7
herda estado da 6 — e a taxa mede contaminação, não comportamento. Antes de cada `rep`: o
estado do perfil é reconstruído do zero (tarefas, lembretes, memórias, intents pendentes).

**Timeout e estado terminal explícitos.** Toda execução termina em um destes, sempre gravado:

`ok` · `falhou_aceite` · `timeout` · `erro_infra` · `abortado_destino_proibido`

Sem terminal explícito, uma execução que trava vira ausência no relatório — e ausência é
lida como "não aconteceu" quando na verdade é "não sabemos". Timeout default: **120s** por
repetição (o `processMessage` já foi visto em 19s; 6× de margem).

**Limpeza em `finally`, e fail-closed** — vale também quando a bateria morre no meio:

- remove **apenas** o que casa com o prefixo do `run_id`;
- se o filtro do `run_id` vier vazio ou malformado, **não apaga nada** e sai com erro
  gritando resíduo — nunca um `delete` por colaborador ou por data;
- resíduo não removido é reportado no relatório, não silenciado.

---

## 8. Formato da evidência

Cada execução grava um JSONL com o que aconteceu de fato — não "passou":

```json
{"run_id":"...","cenario":"resposta-a-cobranca","rep":7,
 "inbound":{"wa_id":"QA-...-7","texto":"tô fazendo, termino hoje"},
 "resposta_tom":"Boa! Reagendo pra hoje...",
 "markers":[{"tipo":"TASK_UPDATE","result":"executed","reason":"ok=1 fail=0"}],
 "banco_antes":{"task":{"status":"pending","due_date":"2026-08-05","remind_at":"2026-06-20T12:00:00Z"}},
 "banco_depois":{"task":{"status":"in_progress","due_date":"2026-08-05","remind_at":"2026-08-05T12:00:00Z"}},
 "outbounds_externos":0,
 "veredito":"ok"}
```

O relatório final é a **taxa por cenário**, com os casos que falharam anexados na íntegra —
para o Alfredo auditar a conversa crua, não o resumo.

---

## 9. Os dois primeiros cenários: os bugs de ontem

Escolhidos de propósito. Estão em produção com prova de build e **zero prova de
comportamento**. Se o laboratório não reproduzir o incidente original, ele não serve — e é
melhor descobrir isso agora, com dois bugs pequenos, do que na spec da trilha 1.

### Cenário A — piso do lembrete (caso Matheus)

1. cria tarefa no perfil QA com `due_date` de ontem e `remind_at` 45 dias atrás;
2. injeta *"passa essa pra quinta"*;
3. **roda o cobrador de verdade, com relógio controlado** — item 2 da auditoria.

O ponto dele é exato: conferir `remind_at` prova o campo, não o cobrador. O que cobrou o
Matheus foi o cron, e é ele que precisa ficar calado. Isso é factível sem gambiarra porque
os handlers **já recebem o instante como parâmetro**: `remindOperationalTasks(now)` e
`remindPersonalTasks(now)` em `rituals/dispatcher.js`.

> Nota de implementação: `remindOperationalTasks` está no `module.exports`;
> `remindPersonalTasks` e `remindGroupTasks` **não estão**. Exportar é pré-requisito do
> cenário — mudança de uma linha, sem efeito em produção.

**Aceite:**

| verificação | piso | tipo |
|---|---|---|
| `due_date` = quinta | ≥19/20 | estatístico (depende do LLM) |
| `remind_at > agora` | 20/20 | absoluto |
| cron rodado em qua 09:00, ter 18:00, qua 23:59 → **0 seleção** | 20/20 | absoluto |
| cron nesses instantes → **0 tentativa de envio** (nem suprimida) | 20/20 | absoluto |
| cron rodado na quinta → **1 envio** | 20/20 | absoluto |

A penúltima linha importa: não basta "não enviou". Se o cobrador **selecionou** a tarefa e
só não enviou por causa da trava de QA, o bug continua lá — o teste ficaria verde por causa
do laboratório, não do conserto.

**O handler roda DENTRO do contexto de replay** (segundo ajuste da última auditoria). O cron
é disparado pelo laboratório, não pelo webhook, então ele não herda contexto nenhum: sem
isso, o envio legítimo de quinta sairia **fora** da trava de replay — e iria para a UAZAPI de
verdade. Portanto:

```
runInTurn({ run_id, qa: true }, () => remindOperationalTasks(quintaAs09h))
```

E não basta envolver: **o cenário prova que o contexto chegou ao `_postEnviar`**. O envio de
quinta tem que aparecer como `outbound_suppressed` **carregando o `run_id`** na evidência. Se
vier sem `run_id`, o teste reprova mesmo que nada tenha vazado — porque significa que a trava
não estava lá, e da próxima vez pode não segurar.

**Este cenário tem que FALHAR com `4dd0e206` revertido — incluindo a parte do cron.** Se
passar com o código antigo, o cenário não modela o incidente, e o problema é o laboratório.

### Cenário B — `MEMORY_SAVE.body` (caso Matheus, segunda parte)

1. injeta *"toda atividade que eu passar pra quinta, não é pra me cobrar antes"*;
2. **aceite:** memória persistida em ≥19/20 (depende do LLM emitir); **zero**
   `schema_invalid` em 20/20 quando o payload usa `body` (determinístico).

**Idem:** tem que falhar com `0b7c576d` revertido.

---

## 10. O que esta spec NÃO garante

- **Não substitui produção.** Perfil QA não tem 30 pessoas conversando junto, nem histórico
  de meses, nem carga de contexto real. Um cenário verde no laboratório e quebrado em
  produção continua possível — e quando acontecer, vira cenário novo.
- **Não mede custo de LLM.** Cada repetição é uma chamada. 20 cenários × 20 repetições = 400
  chamadas por bateria completa. Isso precisa de teto e de decisão sua sobre frequência.
- **Não cobre grupo.** Chat de grupo tem caminho próprio (`group-chat-bridge-in`) e fica
  fora da Fase 1.
- **N=20 é chute inicial.** Escolhi por dar resolução de 5% por execução. Depois das
  primeiras baterias dá para calibrar com a variância medida — e aí o número deixa de ser
  chute.

## 11. Ordem de implementação

1. perfis QA + script idempotente de criação;
2. **trava de envio por MODO** no `_postEnviar` — allowlist estrita, fail-closed em destino
   fora da faixa — com a cobertura das 6 rotas + fallback de mídia. **Antes dela, nada
   roda**: é ela que impede o laboratório de mandar mensagem para gente real;
3. guards de isolamento (grupo, delegação, governança, métricas), cada um com teste;
4. `WEBHOOK_HMAC_ONLY` (default false) + injetor com HMAC do rawBody + fixture capturado +
   **os 5 testes negativos contra a instância efêmera, provados por status HTTP real**;
5. cenário A (piso + **cron real com relógio controlado**) e prova de que falha com
   `4dd0e206` revertido;
6. cenário B (`body`) e a mesma prova com `0b7c576d`;
7. relatório com taxa, evidência crua e resíduo declarado.

O passo 5 é o marco: **até ele, não sabemos se o laboratório serve.** E o passo 2 é o portão:
enquanto a falha-fechada não estiver provada nas seis rotas, nenhuma injeção acontece.

---

## Anexo — o que já existe e vai ser reusado

| peça | onde | estado |
|---|---|---|
| ponto único de saída | `services/whatsapp.js` → `_postEnviar` | pronto (Fatia 3) |
| contexto de turno + claim | `services/turn-claim.js` | pronto, flag ligada |
| autenticação do webhook | `webhook.js` → `verifyWebhookSignature` | pronta, modo permissive |
| colaborador de fachada | `Admin` / `00000000000` | existe — **não será usado**, perfis QA são dedicados |
| catálogo de incidentes | `tom_audit_findings` (76 casos classificados) | pronto para virar cenário |

---

# Achados de EXECUÇÃO (05/08, depois do carimbo da v3)

A spec foi carimbada no papel. Rodar derrubou duas afirmações dela — as duas minhas.

## 1. O turno do webhook nunca nascia marcado como QA
`REPLAY-TURNO-WEBHOOK-SEM-MARCA-QA`

A trava de saída decide pelo **modo do turno** (`turn.qa`) — foi assim que a redesenhei
depois de o Alfredo apontar que decidir por destino deixaria "recado a terceiro" vazar. Só
que nada marcava o turno: o `enterTurn` do `webhook.js` montava
`{ waMessageId, leaseToken, operationId }` e ponto.

Consequência: em replay, **toda a resposta conversacional** era avaliada como produção
(`motivo: sem_replay`) e seguia para o transporte. Nada vazou porque o laboratório aponta
`UAZAPI_URL` para um sink morto — isso é rede do laboratório, **não é a trava de código**
que eu afirmei estar fechada na Fatia 3.

Efeito secundário, e o que me fez achar: a fala do TOM não gerava evidência nenhuma. Eu
tinha reportado isso como "o histórico não registrou"; a causa era uma camada antes.

**Fix:** `qaIsolation.contextoDeTurno(phone)` → `{ qa: true, runId }` para remetente na
faixa reservada `5500…`, espalhado no turno **antes** dos fallbacks de mídia (são 13 saídas
que respondem antes da fila). Em produção é no-op: nenhum telefone real cai na faixa.

## 2. O cobrador, com o relógio adiantado, varre o mundo real
`REPLAY-SWEEP-SEM-ESCOPO-VARRE-PRODUCAO`

Primeira execução do cenário A com o cobrador certo: **24 lembretes de pessoas reais**
selecionados e tentados. A trava barrou os 24 — fail-closed, 0 POST, nenhum `reminded_at`
escrito, 0 fan-out de grupo. Funcionou em combate, e é a melhor evidência que temos de que
ela vale o que custou.

Mas depender só dela é depender da última porta. E tem um segundo efeito, pior porque é
silencioso: o `.limit(50)` do sweep, com dado real de produção, pode empurrar a tarefa da
fixture para fora da página — **verde por sorte**.

**Fix:** `qaIsolation.idsDePerfisQA()` restringe `assigned_to` aos perfis da faixa quando o
turno é QA. Fail-closed: sem perfil ou banco fora, lista vazia (varredura vazia, não
irrestrita). Implementação única — sweep novo usa esta, não reimplementa.

## 3. Correções no próprio cenário (falso-verde e falso-vermelho meus)

| O que | Era | Virou |
|---|---|---|
| Handler do cron | `remindOperationalTasks` — filtra `due_date = amanhã`, nem lê `remind_at`. "Não cobrou antes" passava por **vacuidade** | `checkReminders`, o único com `.lte('remind_at', …)`; exportado e com relógio injetável |
| Datas | `'2026-08-05'`/`'2026-08-06'` cravadas. O piso compara a nova data com o relógio de parede: passada a meia-noite o cenário muda de significado sozinho | relativas ao hoje real, em BRT; o dia da semana do pedido é derivado do alvo |
| Piso | `remind_at === '…T12:00:00.000Z'` — reprovou um piso **correto**: o Postgres devolve `+00:00` | comparação por instante (`Date.parse`) |
| Contador do cron | delta global de evidências — contou os 24 bloqueios de gente real como "cobrou" | só evidência cujo texto contém o `run_id` (o título da fixture carrega) |
| Fixture limpa | só `tasks` | + `notifications` da tarefa + `conversation_history` do run (senão a rep N lê a conversa da rep N-1 e a taxa mede contaminação) |

## Estado

**Cenário A: 8/8 verificações, N=2, duas execuções.**

Prova de reversão (`shiftTaskRemindAt` com a guarda desligada, md5 conferido antes e
depois): `piso_exato` cai, `cron_calado_antes` cai, `cobrou_no_alvo` cai — cobra no
primeiro tick e depois fica mudo no dia combinado. É a assinatura exata do incidente.
`due_virou_alvo` e `fala_confere` **continuam verdes**: o prazo anda e o TOM diz a coisa
certa enquanto o sistema faz a errada. Um teste de conversa sozinho não pegaria isso.

Bateria oficial N=20 em execução.
