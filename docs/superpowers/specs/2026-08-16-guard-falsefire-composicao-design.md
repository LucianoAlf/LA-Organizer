# Fatia 2 — Falso-fire do chokepoint de honestidade em composição

**Data:** 2026-08-16 · **Família:** "não consegui registrar" (balde de sintoma) · **Slice:** 2 (falso-fire)

## Sintoma medido

`enforceNoMarkerHonesty` (o chokepoint `CONFAB-NOMARKER-CHOKEPOINT`, `src/lib/optimistic-confirm.js`)
cola o rodapé honesto `_⚠️ Na real não consegui registrar isso agora…_` em turnos onde **não
havia nada a persistir** — o TOM estava **compondo uma mensagem/lista** com o usuário.

Cluster real (Rose, 14/08): *"me ajuda a montar uma mensagem de alinhamento pra ADM, vou te
mandando o que botar"*. A cada item ditado, o TOM ecoa/anota o rascunho ("Anotado! Pode mandar
o próximo!") e o guard leva o rodapé de erro — num caso **comeu a resposta inteira**, deixando
só o rodapé. ~7–8 falso-fires no recorte 11–14/08 (~25% dos rodapés). É o pior tipo: faz o TOM
parecer quebrado quando ele **não errou nada**.

## Raiz

O guard dispara quando `nothingPersisted && hasCompletionClaim(reply)`. Em composição,
`nothingPersisted` é o estado **correto** (não há o que persistir — é rascunho), mas a prosa do
rascunho usa verbos de conclusão ("Anotado", "Adicionado à lista") que o detector lê como claim
de ação de domínio. **Todo sinal lexical falha**: "montar mensagem" casa `ACTIONABLE_RE`
("montar"), "vou te mandando as demandas" é idêntico a dar tarefas. O discriminador tem que ser
**estrutural**.

O fix da Bianca (09/08, HABIT-UPDATE-SILENT-LIE) removeu o veto `infoGathering` **inteiro** da
camada FORTE porque a metade **confirm-seeking** ("quer tirar o lembrete, certo? ✅ removido")
deixava confab real escapar. Mas `isInfoGatheringReply` é a UNIÃO de duas metades semânticas
distintas, e a remoção levou junto a metade **segura**:

- `_INFO_GATHERING_RE` = *"me manda / pode mandar / vai listando"* → TOM **pede conteúdo** =
  composição. Se o TOM está pedindo mais insumo, ele **não afirmou** ação feita.
- `_CONFIRM_SEEKING_RE` = *"certo? / responde sim-não"* → TOM **confirma uma ação** pendente.
  Aqui a claim junto pode ser confab real → tem que disparar.

A raiz é: **as duas metades foram tratadas como uma.**

## Design

Separar as metades e vetar a camada FORTE **só** na content-solicitation, **e** só quando nenhum
marker foi tentado no turno.

1. `src/services/reply-classify.js` — exportar `isContentSolicitationReply` (a metade
   `_INFO_GATHERING_RE`) e `isConfirmSeekingReply` (a metade `_CONFIRM_SEEKING_RE`).
   `isInfoGatheringReply` permanece a união (comportamento intocado).
2. `src/lib/optimistic-confirm.js` — `enforceNoMarkerHonesty` ganha opts `contentSolicitation`
   e `markerAttempted`. Veto: se `strong && contentSolicitation && !markerAttempted` →
   `strong = false` (não dispara, não strippa). Camada fraca segue vetada por `infoGathering`
   (que inclui content-solicitation), então não vaza por baixo.
3. `src/engine.js` — computa `contentSolicitation = isContentSolicitationReply(reply)` e
   `markerAttempted` (marker de domínio executado OU rejeitado neste turno) e passa nas opts.

## Freios obrigatórios (casos que TÊM que disparar)

- **Bianca (confirm-seeking + claim):** "quer tirar o lembrete, certo? ✅ removido" —
  `contentSolicitation=false` → dispara. (Teste vermelho.)
- **Confab clássico:** usuário "cria X" → "✅ Criada!" sem marker — `contentSolicitation=false`
  → dispara.
- **Marker rejeitado + solicitação:** "✅ Criei. Me manda a próxima." com `markerAttempted=true`
  → dispara (houve ação na mesa, falhou).
- **Zero-regressão por construção:** opt ausente (`undefined`) → veto nunca ativa →
  comportamento idêntico ao atual. Suíte `optimistic-confirm*.test.js` verde sem tocar.

## Prova de aceite

- Testes puros: `reply-classify.test.js` (separação content vs confirm) + `optimistic-confirm`
  (veto + freios) verdes.
- Replay VERDE: composição ("me ajuda a montar a lista" → "Anotado! Pode mandar o próximo") →
  **sem** rodapé.
- Replay VERMELHO: confab real (confirm-seeking + claim, nada persistiu) → rodapé **dispara**.
- Suíte VPS na baseline (fail 3) e restart provado (`ps -o lstart=`).
