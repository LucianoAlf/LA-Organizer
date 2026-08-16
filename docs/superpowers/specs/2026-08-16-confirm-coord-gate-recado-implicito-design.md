# Fatia 8 — Recado implícito confirmado ainda dropa (confirm-coord-gate)

**Data:** 2026-08-16 · **Família:** `dropped_request`/recado · **Segue:** Fatia 3 (coordenação com texto explícito)

## Sintoma

O usuário confirma um recado que o TOM propôs **sem texto explícito** e ele **some**:
> TOM: "Mando um agradecimento pro Jhonatan? Confirma?" → USER: "Sim" → TOM: "_⚠️ eu ainda NÃO
> avisei ninguém…_"

A Fatia 3 (parse-on-open) cobre recado **com texto citado** ("Segue o texto: '…'"); o **implícito**
cai no ramo `!hasConcrete` (engine ~10279) que **manda o LLM desistir** → dropa. Aqui não dá parser
determinístico: a mensagem não está no texto (o TOM comporia). É o maior buraco de recado restante
(~4–5/60d, quase todos os recados abertos são drops de confirmação implícita).

## Raiz + obstáculo

O ramo `!hasConcrete` só libera marker pra CRIAÇÃO (`confirm-create-gate.podeLiberarCriacao`) — não
pra coordenação. **Obstáculo:** o handler `COORDINATION_REQUEST` (engine ~12562) **sempre estagia**
(`shouldStageCoordination` fail-safe = nunca envia sem confirmar). Se eu só instruir o LLM a emitir
o marker no turno do "sim", ele **re-estagia → re-pergunta → loop**.

**Saída:** o `else` de 12562 (12578) **já despacha direto** via `applyCoordinationRequestAction`. É
só o gate marcar "pré-confirmado" e o handler pular o estágio nesse turno.

## Design (espelha o confirm-create-gate)

1. **Novo puro** `src/coordination/confirm-coord-gate.js`: `podeLiberarRecado(question_text)` — true
   só quando a pergunta é proposta de RECADO ("Aviso o X?", "Mando (recado/mensagem/agradecimento)
   pro X?", "Aviso N pessoas?", "Falo com o X?"). Fail-closed; veta ação sobre item existente.
2. **`coord-confirm.js`**: `shouldStageCoordination(items, opts)` → **false quando `opts.preConfirmed`**
   (já confirmado no turno anterior → despacha direto).
3. **Engine, ramo `!hasConcrete`** (~10279): `_liberaRecado = gateOn && !hasConcrete && !_liberaCriacao
   && podeLiberarRecado(question_text)`. Se true → `markerRule` instrui: "a pergunta é um RECADO que
   VOCÊ propôs e o usuário aprovou; emita `<<COORDINATION_REQUEST>>` pro destinatário citado,
   compondo a mensagem fiel à intenção — mesmo destinatário, mesmo teor; NÃO invente destinatário
   nem mude o assunto; NÃO toque em tarefas/eventos". Seta `_metrics.recado_preconfirmed = true`.
4. **Engine, handler `COORDINATION_REQUEST`** (~12562): passa `{ preConfirmed: !!_metrics.recado_preconfirmed }`
   → o `else` despacha direto (sem re-estagiar). Reply = prosa do LLM (voz intacta).

## Freios obrigatórios (teu veto — bypass do "nunca enviar sem confirmar")

1. **Bypass só com confirmação REAL:** `preConfirmed` só é true quando a pergunta era proposta de
   recado (`podeLiberarRecado`) E o usuário confirmou (estamos no ramo yes). A confirmação que o
   coord-confirm exige **aconteceu no turno anterior** — não é envio-cego.
2. **`applyCoordinationRequestAction` segue fail-closando** destinatário não-achado/ambíguo (não envia).
3. **FAIL-CLOSED:** `podeLiberarRecado` false → comportamento de hoje (drop honesto).
4. **Flag de rollback:** `TOM_CONFIRM_RECADO_GATE=0` desliga (como o `TOM_CONFIRM_CREATE_GATE`).
5. **Zero-regressão:** gate off / pergunta não-recado → `_metrics.recado_preconfirmed` nunca seta →
   `shouldStageCoordination` inalterado → tudo como hoje.
6. **Risco residual assumido:** o LLM COMPÕE o teor da mensagem. Mitigado: destinatário vem da
   pergunta, o usuário aprovou a intenção, e o executor fail-closa no destinatário.

## Prova de aceite

- Puros: `confirm-coord-gate.test.js` (recado→true; criação/fechamento/vazio→false) + teste do
  `shouldStageCoordination(items,{preConfirmed:true})→false` sem quebrar os existentes.
- Replay VERDE: intent só-texto com pergunta "Mando um recado pro [QA2]? Confirma?" → "Confirma" →
  `coordination_requests` row **despachada** (sem re-perguntar, sem loop, sem "não avisei ninguém").
- Replay: NÃO re-estágio (o turno do "sim" despacha, não reabre intent).
- Suíte VPS fail 3 + restart provado.
