# Fatia 3 — Confirmação não resolve a ação pendente: parse-on-open (coordenação)

**Data:** 2026-08-16 · **Família:** `dropped_request` (dor #1, 20 novos/21d) · **Slice:** coordenação/recado

## Sintoma medido

Quando o usuário **confirma** um pedido que o TOM perguntou, a ação se perde: o TOM diz
"perdi o fio — me manda de novo" ou **re-pergunta** a mesma confirmação (loop). ~16
confirmações acionáveis no ralo em 45d (marker `CONFIRM_NOEXEC`): complete 6, coordenação 6,
delegação 3, reschedule 1. Recorrente até 16/08 (delegação) e 14/08 (coordenação).

## Raiz

O TOM faz a pergunta de confirmação **em prosa, sem emitir o marker de estágio**
(`COORDINATION_REQUEST` / delegação / `batch_complete`). O hook genérico de fim-de-turno
(`detectConfirmationQuestion`, engine.js ~13413, roda **só quando `noMarkerEmitted`**) pega o
"Confirma?" e abre um intent `confirmation` com payload **só-texto** (`{last_user_text,
last_tom_reply}`). No turno do "sim" (engine.js ~10242), sem executor determinístico no payload,
cai no ramo `!hasConcrete` (10279) que **instrui o LLM a desistir** ("não consegui, me manda de
novo"). Os executores determinísticos existem e são bons (`coordination.items` @10221,
`batch_complete` @10199, `anchor` @10165) — mas ficam **famintos** de payload estruturado.

Os dois modos de falha ("perdi o fio" e loop) têm a **mesma raiz**: o estágio estruturado não
aconteceu porque a pergunta foi prosa.

## Design — Parse-on-open (A), fatiado por superfície; 1ª = coordenação

Quando o hook genérico vai abrir o intent, se a **própria pergunta do TOM** for uma confirmação
de coordenação e der pra extrair `{recipient_name, message_body}` com fidelidade, abre o intent
com `payload.coordination.items` estruturado. No "sim", o executor `coordination.items` (10221,
já pronto) despacha via `applyCoordinationRequestAction` — determinístico, sem LLM.

- **Novo módulo puro** `src/coordination/coord-question-parse.js`:
  `parseCoordinationConfirmQuestion(replyText) → { recipient_name, message_body } | null`.
  Extrai o destinatário (nome após "Aviso o/a/os …") e a mensagem **só quando explicitamente
  delimitada** (após "Segue o texto:" / entre aspas `"…"` ou `> "…"`). Sem texto explícito →
  `null`. Puro, testável isolado.
- **Fiação no engine** (hook genérico ~13432): se `detectConfirmationQuestion` deu
  `kind='confirmation'` E `parseCoordinationConfirmQuestion(reply)` retorna item, abre o intent
  com `payload = { coordination: { items: [{ recipient_name, message_body, mode:'relay_assisted' }] },
  last_user_text, last_tom_reply }`. Senão, comportamento atual (payload só-texto).

## Freios obrigatórios

1. **FAIL-CLOSED.** Só estagia quando extrair destinatário **e texto explícito**. Mensagem
   implícita ("Aviso o Alf sobre os calendários?") → `null` → cai no caminho de hoje. Mandar
   recado errado pra uma pessoa real é PIOR que o drop atual — na dúvida, não estagia.
2. **Resolução de destinatário fica no executor.** `applyCoordinationRequestAction` já
   fail-closa em não-achado/ambíguo (não envia, devolve pergunta). Não replicar aqui.
3. **Sem duplo-estágio.** O hook só roda quando `noMarkerEmitted` — se o TOM emitiu
   `COORDINATION_REQUEST`, o estágio nativo já cobriu e o hook nem entra. Sem risco de 2 envios.
4. **Parse na fala do TOM (templada), nunca no texto livre do usuário.**
5. **Voz intacta.** A prosa da pergunta do TOM não é tocada; só populamos payload oculto. No
   "sim", sai o "📨 Recado enviado!" determinístico (10236) — a MESMA voz do caminho estagiado
   nativo, não uma voz nova.
6. **Zero-regressão por construção.** Puramente aditivo: sem extração → payload só-texto igual
   ao de hoje. Suítes `coord-confirm*.test.js` e pending-intents verdes sem tocar.
7. **Escopo honesto.** Cobre confirmações de coordenação COM texto explícito. Mensagem implícita,
   complete e delegação ficam pra fatias seguintes (complete/delegação precisam de título→id).

## Prova de aceite

- Testes puros: `coord-question-parse.test.js` (extrai Yuri+texto; retorna null em implícito /
  não-coordenação / negação) + regressão coord-confirm/pending-intents verdes.
- Replay VERDE: TOM pergunta "Aviso o Yuri? Segue o texto: '…'. Confirma?" → usuário "Confirma"
  → recado **despachado determinístico** (coordination_requests row), sem "perdi o fio".
- Replay VERMELHO / fail-closed: pergunta de coordenação SEM texto explícito → "sim" → NÃO
  estagia recado errado (cai no caminho honesto de hoje, não inventa mensagem).
- Suíte VPS na baseline (fail 3) + restart provado.
