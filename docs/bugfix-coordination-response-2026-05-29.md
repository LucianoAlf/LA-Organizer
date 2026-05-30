# Investigação: "TOM fabricou que o Rafinha respondeu" (2026-05-29)

## TL;DR — a premissa do bug estava incorreta

**O Rafinha REALMENTE respondeu.** Ele enviou "Consigo verificar sim" do próprio
celular (5521973008639), via webhook UAZAPI real (`fromMe:false`, message id real).
O TOM **não** fabricou a fala na 2ª camada — o `response_summary` é paráfrase fiel de
uma mensagem inbound real, lastreada por registro verificável no banco.

O que o Alf percebeu como "fabricação" foi, na verdade, o **efeito downstream do bug
de 1ª camada (pending_intent stale)** — que já foi corrigido (`withinConfirmWindow`).
A cobrança ao Rafinha nunca deveria ter saído; mas, uma vez que saiu, o Rafinha
respondeu de verdade e o TOM repassou corretamente.

---

## Cadeia completa (reconstruída de `logs/tom-out.log` + `coordination_requests` + `conversation_history`)

| Hora (UTC) | Evento | Evidência |
|---|---|---|
| 23:19:30 | TOM pergunta ao Alf sobre **meta do carro**: "Quer que eu crie uma meta pra acompanhar a economia mês a mês?" | log `[OUT]` phone=8047 |
| 23:19:43 | Alf responde **"sim"** (querendo dizer: sim, cria a meta do carro) | `[Webhook] Mensagem de 8047: sim` |
| 23:19:47 | **BUG 1ª camada:** "sim" é consumido por intent STALE `f1d75aec` ("cobrar Rafinha") | `[PendingIntents] auto-resolve YES — intent=f1d75aec kind=confirmation` |
| 23:20:04 | TOM dispara followup ao Rafinha (COORDINATION_REQUEST) | request `56cd0839` criada; `[OUT]` "O Alf me pediu pra te perguntar... fornecedor de aromas" |
| 23:20:06 | TOM avisa Alf "vou cobrar o Rafinha agora" | `[OUT]` phone=8047 |
| 23:20:37 | **Rafinha responde DE VERDADE: "Consigo verificar sim"** | Webhook UAZAPI real: `"content":"Consigo verificar sim","fromMe":false`, `wa_chatid":"5521973008639@s.whatsapp.net"`, id `5521997243082:AC94412179DC...` |
| 23:20:41 | inbound persistido em `conversation_history` (id `0d06c5bb`) | direction=inbound, content="Consigo verificar sim" |
| 23:20:51 | TOM emite COORDINATION_RESPONSE → repassa ao Alf | `[OUT]` "Boa! O Rafinha respondeu... 'Rafinha confirmou que consegue verificar... e vai dar um retorno.'" |
| 23:20:49 | Alf esclarece (sobre o carro): **"guardei 500 pro carro"** — prova que o "sim" era sobre o carro, não sobre o Rafinha | `[Webhook] Mensagem de 8047: guardei 500 pro carro` |

`coordination_requests.56cd0839`: mode=followup, requester=Alf(0576f4b6), recipient=Rafinha(c9e72a40),
status `sent`→`responded` em 47s, `response_summary="Rafinha confirmou que consegue verificar a questão do fornecedor de aromas agora..."`.

---

## A 2ª camada: onde nasce "fulano respondeu/confirmou X"

`src/engine.js` → `applyCoordinationResponseAction(collab, parsed)` (linha ~1491).
Disparada pelo marker `<<COORDINATION_RESPONSE>>` que o LLM emite (handler linha ~7419).

**Guard que JÁ existe (e funcionou neste caso):**
```js
// linha ~1492 — exige request real, pro recipient certo, ainda em 'sent'
const { data: req } = await supabase.from('coordination_requests')
  .select('id, requester_id, ... status')
  .eq('id', parsed.request_id)
  .eq('recipient_id', collab.id)   // só o próprio recipient pode responder
  .eq('status', 'sent')
  .maybeSingle();
if (!req) return { ok:false, reason:'request_not_found' };  // sem msg ao requester
```
Então a regra "só afirma que respondeu se há request real e o remetente atual é o
recipient daquela request" **já é garantida deterministicamente**. Não há fabricação
de resposta a partir do nada.

**Mensagem ao requester (linha ~1528):**
```js
const msg = `Boa! O ${recipientFirstName} respondeu o que você pediu:\n\n"${parsed.response_summary}"`;
```

## Risco residual REAL (vale endereçar, mas é menor — não é o bug relatado)

`response_summary` é **texto livre do LLM**, não a fala verbatim do recipient. Neste
caso houve **drift leve**: o Rafinha disse só **"Consigo verificar sim"**, mas o resumo
afirmou "...e **vai dar um retorno**" — frase que o Rafinha **nunca disse**. Inócuo aqui,
mas é exatamente o vetor de "colocar palavras na boca de uma pessoa real".

O guard atual prova que *uma* resposta existiu; **não** garante que o *conteúdo* relatado
bate com o que a pessoa escreveu.

---

## Proposta de fix cirúrgico (NÃO toca em pending_intents)

**Ancorar a notificação ao requester na fala verbatim do recipient.** O engine já tem,
deterministicamente, a mensagem que acabou de chegar (`text` do turno atual = a fala do
recipient). Em vez de repassar só a paráfrase do LLM, citar o original:

```js
// applyCoordinationResponseAction — substituir a montagem da msg (linha ~1528)
const verbatim = (currentInboundText || '').trim().slice(0, 500);
const msg = verbatim
  ? `Boa! O ${recipientFirstName} respondeu o que você pediu:\n\n"${verbatim}"`
    + (parsed.response_summary && parsed.response_summary !== verbatim
        ? `\n\n_(resumo: ${parsed.response_summary})_` : '')
  : `Boa! O ${recipientFirstName} respondeu o que você pediu:\n\n"${parsed.response_summary}"`;
```

Efeito:
- O requester **sempre** vê o que a pessoa de fato escreveu (verbatim), elimina o drift.
- O resumo do LLM vira contexto secundário, nunca substitui a fonte.
- Reforça a regra do Alf ("registro real e verificável") no nível mais forte: a citação
  é a própria mensagem persistida em `conversation_history`.

Para isso, passar o texto inbound atual até a função (hoje ela só recebe `collab` e
`parsed`). Mudança de assinatura mínima: `applyCoordinationResponseAction(collab, parsed, currentInboundText)`.

## O que NÃO fazer
- Não mexer em `withinConfirmWindow`/pending_intents (causa-raiz real já corrigida).
- Não adicionar "verificação de resposta real" nova — ela já existe (guard de DB).
