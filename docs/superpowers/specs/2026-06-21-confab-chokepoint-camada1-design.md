# Chokepoint anti-confabulação — Camada 1 (trava universal de honestidade)

- **Data:** 2026-06-21
- **Status:** Design aprovado pelo Alf (Camada 1 isolada; Camada 2 depois). Aguardando implementação.
- **Autor:** Claude + Alf
- **Família:** confabulação/confirmação. Irmãos: `AUDIT-OPTIMISTIC-CONFIRM`, `GROUPCHAT-TOM-MENTE-NA-FALHA`, `BATCH-COMPLETE-CONFIRM-NOOP`, `FIN-INVOICE-*`, `B3` (Ana), `FATIA-B-COORD-CONFAB`.

## Problema (causa-raiz confirmada — cross-audit deste chat + chat do financeiro)

O TOM afirma "✅ feito" quando **nada persistiu**. A trava anti-mentira (`sanitizeOptimisticConfirm`) existe em **3 handlers** (TASK/EVENT/EVENT_UPDATE) e **falta em ~14** (HABIT, FINANCE schema, CHECKLIST, PROJECT, PERSONAL_LIST, etc.). Corrigir um a um = os 14 buracos do mesmo cano (o "não tem fim"). A skill `systematic-debugging` manda: 6+ fixes da mesma família = **consertar a arquitetura, não remendar**.

**Evidência que ancora o design:**
- **Ana (21/06 10:47:20):** `HABIT_ACTION rejected` foi o ÚNICO marker do turno; `ACTIONABLE_NO_MARKER` **não** disparou → `actionable_intent` NÃO foi setado. A fala "✅ as duas doses confirmadas!" saiu com a dose não registrada (remédio de criança). **Lição: o gate NÃO pode depender de `actionable_intent`** — perderia a Ana.
- **Rose (listas 2 e 3):** "✅ Lançado"/"Confirmado ✅" sem marker (caminho de confirmação devolveu pro LLM, que narrou e não emitiu). Quanto mais ela pediu "confirma antes", mais garantido o erro.

## Objetivo

UM chokepoint determinístico: **antes de enviar (voz OU texto), se a fala afirma conclusão de uma ação MAS nada persistiu neste turno → rebaixar a confirmação pra honesta.** Cobre todos os ~14 handlers de uma vez. Voz do TOM sagrada: corrige honestidade, nunca o jeito de falar.

## Escopo
- **Dentro (Camada 1):** a trava universal de honestidade no envio.
- **Fora (Camada 2, próximo passo):** executor determinístico de confirmação (financeiro+hábito) — fazer a ação acontecer de primeira. + bug #1 da Ana (parser `title→habit_name`, que é parser, não confab).

## Design

### Ponto de plugue — `engine.js` ~linha 11013
**Logo após o bloco de pending-intents (fecha em 11012) e ANTES do bloco de voz (11014).** Crucial: o `reply` corrigido aí alimenta **a síntese de voz E o envio de texto** → cobre confab por áudio também. Depois do pending-intents → o aviso honesto não interfere no `detectConfirmationQuestion`.

### Sinais (todos JÁ existem no engine)
- `nothingPersisted = !_metrics.marker_emitted && !_metrics.auto_retry_succeeded` — nada executou neste turno, **incluindo** o auto-retry (Sprint 28.2). É o mesmo `noMarkerEmitted` da linha 10986 (recomputado, one-liner, sem DB).
- `_replyIsInfoGathering` — TOM está perguntando (não rebaixa).
- `_metrics.awaiting_user_confirm` — TOM espera "sim" (não rebaixa).

### O gate (a decisão precisa) — **verbo de conclusão, NÃO ✅ sozinho**
Rebaixa SE: `nothingPersisted && !infoGathering && !awaitingConfirm && hasCompletionClaim(reply)`.

`hasCompletionClaim(reply)` = alguma LINHA faz afirmação de conclusão: verbo de conclusão **no início da linha**, OU **✅ na linha JUNTO com** um verbo de conclusão na linha, OU totalizador (todas/tudo) + verbo. **NÃO** dispara no ✅ decorativo sozinho ("✅ Boa, tá tudo certo?") — protege a voz do TOM. Aterrado na Ana: "✅ ...confirmadas" = ✅ + verbo no fim da linha → pega pelo ramo **✅+verbo** (o de início-de-linha sozinho perderia ela).

### Mudanças na lib `src/lib/optimistic-confirm.js`
1. **Estender `COMPLETION_CORE`** com os verbos que aparecem nas confabs reais e faltavam: `confirmad[oa]s?|confirmei`, `lan[çc]ad[oa]s?|lancei`, `adicionad[oa]s?|adicionei`, `inserid[oa]s?`. (Só passado/particípio — seguro; presente/futuro/gerúndio continuam fora.)
2. **Novo `hasCompletionClaim(text)`** — por linha: `COMPLETION_ANCHORED` (verbo no início) **OU** (✅ na linha E `COMPLETION_ANYWHERE` na linha) **OU** (`TOTALIZER` + `COMPLETION_ANYWHERE`). **Sem** a regra do ✅-sozinho. Alinhado ao `_isOptimisticLine`: quando o gate dispara, `sanitizeOptimisticConfirm('failed')` de fato remove a linha (evita rebaixar com aviso sem remover nada).
3. **Novo `enforceNoMarkerHonesty(reply, { nothingPersisted, infoGathering, awaitingConfirm })`** — puro:
   ```
   se !reply || !nothingPersisted || infoGathering || awaitingConfirm → retorna reply (não mexe)
   se !hasCompletionClaim(reply) → retorna reply (✅ decorativo preservado)
   senão → cleaned = sanitizeOptimisticConfirm(reply,'failed'); retorna cleaned + aviso honesto
   ```
   Aviso honesto (consistente com os existentes, sem gatilho de `detectConfirmationQuestion`): `_⚠️ Na real não consegui registrar isso agora — me manda de novo, por favor._`

### Wiring no engine (uma chamada, try isolado)
```js
try {
  reply = enforceNoMarkerHonesty(reply, {
    nothingPersisted: !_metrics.marker_emitted && !_metrics.auto_retry_succeeded,
    infoGathering: !!_replyIsInfoGathering,
    awaitingConfirm: !!_metrics.awaiting_user_confirm,
  });
} catch (e) { console.warn('[ConfabGuard] non-fatal:', e.message); }
```

### Os guards por-handler atuais (TASK/EVENT) FICAM
Cobrem falha PARCIAL (1 marker ok + outro falha) que o chokepoint universal (mede o turno inteiro) não cobre. "Menos superfície" = adicionamos **1 rede universal** em vez de remendar 14 handlers — não removemos o que funciona.

## Error handling
- `enforceNoMarkerHonesty` é puro + envolto em try/catch → nunca quebra o envio.
- Falso-negativo (deixa passar) > falso-positivo (rebaixa fala legítima): o gate verbo-baseado + os 2 guards (info/awaiting) são conservadores de propósito.

## Testing (TDD)
- **`optimistic-confirm.test.js` (estender):** rodar o existente (não regredir) + novos casos de `hasCompletionClaim`/`enforceNoMarkerHonesty`:
  - Ana: "✅ as duas doses confirmadas!" + nothingPersisted → rebaixa.
  - Rose: "✅ Lançado nas parcelas jul/ago/set" + nothingPersisted → rebaixa.
  - **Não-regressão (críticos):** "✅ Boa! Tá tudo certo?" (decorativo, sem verbo) → NÃO mexe; reply com nothingPersisted=false (ação persistiu) → NÃO mexe; infoGathering/awaitingConfirm true → NÃO mexe.
- **Smoke VPS:** replicar o gate sobre a fala real da Ana + um caso decorativo, provando rebaixa-um/preserva-o-outro. Engine boota limpo.
- `node --check` no engine + na lib.

## Critérios de sucesso
1. `enforceNoMarkerHonesty` + `hasCompletionClaim` na lib, testados (Ana/Rose rebaixam; decorativo/persistido/pergunta NÃO).
2. Vocab estendido sem regredir os testes existentes da lib nem os guards TASK/EVENT.
3. Wiring no engine no ponto único (cobre voz+texto); `node --check` limpo; engine boota.
4. Smoke prova: confab da Ana vira honesto; ✅ decorativo intacto.
5. Deploy só com OK do Alf.
