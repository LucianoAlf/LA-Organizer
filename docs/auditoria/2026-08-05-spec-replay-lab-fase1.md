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

O webhook aceita dois métodos (`verifyWebhookSignature`): **token na URL**
(`/webhook/<WEBHOOK_SECRET>`) e **HMAC no header** (`X-Webhook-Signature: sha256=<hex>`).
`WEBHOOK_SECRET` já existe na VPS; `WEBHOOK_AUTH_MODE` está ausente, então hoje o modo é
**permissive** (aceita e loga, não rejeita).

**O laboratório usa HMAC de header, sempre** — mesmo que o modo seja permissive. Motivo: o
teste tem que exercitar o caminho autenticado de verdade. Se um dia ligarmos `strict`, a
suíte continua passando; se ela dependesse do modo frouxo, o `strict` a quebraria toda.

**Uma consequência que precisa ser aceita explicitamente:** injetar no webhook exige que a
porta 3100 aceite a conexão. O laboratório roda **de dentro da VPS** (`localhost:3100`), não
de fora. Nada de expor porta.

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

### 7.1 Nenhum outbound sai para fora (trava 2)

O bloqueio mora no **ponto único de saída** que já existe: `_postEnviar`, em
`services/whatsapp.js` — criado ontem na Fatia 3 do router, por onde passam texto, menu,
mídia, voz e reação. Se o destinatário está em `TOM_QA_PHONES`, **não posta na UAZAPI**:
grava o que teria enviado e devolve um id sintético.

Isso resolve também a cobrança: o cron pode disparar de verdade para o perfil QA — que é
justamente o que queremos exercitar, já que cobrança indevida é um dos bugs — **sem que
nenhuma mensagem saia**.

**Guarda dupla, porque uma trava só não basta quando o custo do erro é mandar mensagem para
o time inteiro:** além da lista, o envio confere se o número é da faixa reservada. Se um dia
alguém puser um telefone real em `TOM_QA_PHONES`, o segundo teste barra.

### 7.2 QA fora das métricas (trava 3)

Os cenários vão gerar exatamente os sintomas que o detector procura. Sem exclusão, o
laboratório **contamina `tom_audit_findings`** — e a métrica que estamos usando para
priorizar passa a contar teste como falha real. Seria eu sabotando meu próprio diagnóstico.

Exclusão em três lugares, todos pela mesma lista: gravação de findings, agregações da
auditoria diária e `marker_logs` das métricas de saúde. Os `marker_logs` **continuam sendo
gravados** (o laboratório precisa deles como evidência) — só saem das agregações.

### 7.3 Concorrência e correlação (trava 4)

Cada bateria tem um `run_id` (ULID). Todo artefato — inbound sintético, marker, outbound,
finding — carrega esse id, via prefixo no `wa_message_id` (`QA-<run_id>-<n>`).

Concorrência limitada a **4** (um por perfil). Não é limitação técnica: é a fila por
telefone. Mais perfis = mais paralelo, e a spec não fixa o teto em quatro para sempre.

**Limpeza:** ao fim da bateria, remove-se **apenas** o que tem o prefixo do `run_id`. Nunca
um `delete` por colaborador ou por data — se o filtro do `run_id` falhar, o comando não
apaga nada em vez de apagar demais.

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
3. **aceite:** `due_date` = quinta em ≥19/20; `remind_at > agora` em **20/20** (determinístico,
   é o piso); nenhum lembrete disparado antes da nova data em **20/20**.

**Este cenário tem que FALHAR se eu reverter o commit `4dd0e206`.** Se passar com o código
antigo, o cenário não modela o incidente — e aí o problema é o laboratório, não o TOM.

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
2. trava de envio no `_postEnviar` + guarda de faixa (a mais crítica: antes dela, nada roda);
3. injetor com HMAC + fixture capturado;
4. cenário A (piso) e prova de que ele falha com o fix revertido;
5. cenário B (`body`) e a mesma prova;
6. exclusão das métricas;
7. relatório com taxa.

O passo 4 é o marco: **até ele, não sabemos se o laboratório serve.**

---

## Anexo — o que já existe e vai ser reusado

| peça | onde | estado |
|---|---|---|
| ponto único de saída | `services/whatsapp.js` → `_postEnviar` | pronto (Fatia 3) |
| contexto de turno + claim | `services/turn-claim.js` | pronto, flag ligada |
| autenticação do webhook | `webhook.js` → `verifyWebhookSignature` | pronta, modo permissive |
| colaborador de fachada | `Admin` / `00000000000` | existe — **não será usado**, perfis QA são dedicados |
| catálogo de incidentes | `tom_audit_findings` (76 casos classificados) | pronto para virar cenário |
