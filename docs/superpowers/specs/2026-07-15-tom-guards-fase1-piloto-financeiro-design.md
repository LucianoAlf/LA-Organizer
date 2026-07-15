# TOM Guards — Fase 1 (piloto): estado do turno no fluxo financeiro

**Data:** 2026-07-15
**Contexto:** `docs/tom-estabilidade-fase0-inventario-guards.md` (Fase 0 — inventário)
**Escopo:** piloto vertical. Converter os guards do **fluxo financeiro de confirmação** de decisão-por-regex-de-texto para decisão-por-**estado do turno** + **gate de domínio**. Não toca os outros guards nem o chokepoint global.

---

## Goal

Matar, na raiz, a classe de bug "guard decide por texto e erra o contexto" **dentro do fluxo financeiro** (confirmar lançamento / importar fatura / pagar fatura). Critério de sucesso: parar de surgir bug dessa classe nesse fluxo — medido pela ausência de reincidência (Rose/time param de reclamar de lançamento errado, confirmação ignorada, guard disparando fora de hora).

Os 4 bugs de 14/07 que motivam (todos no fluxo financeiro):
- `FIN-LAUNCH-CONFIRM-ON-QUESTION` — pergunta "qual fatura?" virou commit.
- `SENDHONESTY-FALSEFIRE-FINANCE` — guard de recado disparou num turno de fatura.
- `FIN-INVOICE-COMMIT-ON-VIEW-REQUEST` — "me passa o que falta" (ver) virou commit.
- `FIN-INVOICE-CARD-GUESSED-WRONG` — emissor ambíguo → chutou o cartão errado. (já corrigido hoje com `pickInvoiceCard` — é a amostra do padrão a generalizar.)

## Princípio central

O "estado do turno" que os guards precisam **já existe**: é a **intent aberta** (`pending_intents`) + os **markers do turno** (`marker_logs`), que o engine já lê. Os guards de hoje ignoram isso e re-adivinham pelo texto. O piloto faz os guards **consultarem o estado**. Dois mecanismos:

1. **Gate de domínio** — cada guard só age no domínio a que pertence. Guard de recado num turno financeiro: não age.
2. **Decisão contra a proposta** — o detector de confirmação recebe *o que está sendo confirmado* (da intent) e lê o texto do usuário **contra** isso. O regex vira rede secundária, não a decisão principal.

O estado só **melhora** a decisão quando tem certeza; na ausência dele, cai no comportamento de hoje. Nunca pior que hoje.

## Componentes

### 1. `src/finance/finance-turn-state.js` (novo, puro)

Recebe o que o engine já leu; sem I/O.

```
financeTurnState(openIntents, markerRows) -> {
  pendingAction: 'launch' | 'pay_invoice' | 'invoice_import' | null,
  proposal: { card, amount, itens, competencia } | null,   // do payload da intent financeira ativa
  domain: 'finance' | null                                   // ação financeira presente no turno?
}
```

- `pendingAction` deriva da intent financeira aberta mais recente. Os `kind`/`form` exatos (`finance_source` com `form: 'launch_confirm'`, `invoice_import` com `stage: 'awaiting_confirm'`, etc.) o plano confirma lendo o código; a spec fixa o comportamento.
- `proposal` extrai do payload os campos que o detector precisa (cartão proposto, valor, itens, competência).
- `domain = 'finance'` se `pendingAction != null` **OU** se há marker financeiro executado no turno (`FINANCE_ACTION` e afins). Senão `null`.

### 2. Detectores financeiros decidem *com* a proposta

- `detectInvoiceReply(text, turnState)` — quando `pendingAction === 'invoice_import'`, decide contra a proposta: afirmação clara sem pergunta/view/negação → `commit_financeiro`; pedido de ver → `null`; pergunta → `null`; cancelamento → `cancel`. Os regexes de hoje (`RE_VIEW_REQUEST`, anchored, etc.) viram rede secundária.
- `detectLaunchConfirm(text, conf, turnState)` — quando `pendingAction === 'launch'`, idem: negação e pergunta nunca lançam; afirmação contra a proposta lança.
- **Compatibilidade:** `turnState` ausente ou de outro domínio → comportamento atual (assinatura com parâmetro opcional; os testes de hoje continuam válidos).

### 3. Gate de domínio no guard que vazou

- `enforceSendHonesty(text, { turnState, isQuestion })` — se `turnState.domain === 'finance'`, **não age** (o "mandando/enviado" é financeiro, não recado). Senão, comportamento atual (o split strong/weak + `FIN_CTX` já entregue em 14/07 permanece como segunda linha).

### 4. Engine monta o `turnState` uma vez

Logo após ler as intents abertas e os markers do turno, o engine chama `financeTurnState(...)` e passa o resultado aos detectores (intercepts financeiros) e ao `enforceSendHonesty` (pré-envio). Uma montagem, reusada. Nenhum caminho novo de dados.

## Fluxo de dados

1. Mensagem chega → engine lê intents abertas + markers do turno (já faz).
2. `financeTurnState(intents, markers)` → estado.
3. Intercepts financeiros: detectores recebem `turnState` → decidem contra a proposta.
4. Pré-envio: `enforceSendHonesty` recebe `turnState` → gate de domínio.

## Bordas (garantia de zero-regressão)

- Sem intent financeira aberta → `domain: null`, `pendingAction: null` → detectores usam o regex atual; guards de domínio não interferem. **Nunca pior que hoje.**
- `financeTurnState` lança (payload estranho) → `try/catch` no engine → comportamento atual. Fail-safe.
- Múltiplas intents abertas → prioriza a financeira mais recente (a proposta ativa).

## Testes

- **TDD** em cada detector convertido, com fixtures de `turnState` (proposta + texto do usuário).
- **Os 4 bugs de 14/07 viram testes-regressão permanentes** — não voltam sem um teste vermelho.
- **Zero-regressão:** rodar todas as suítes de `finance/` + `lib/coord-send-honesty` + `services/user-confirmation` antes e depois; nenhuma quebra.
- **Smoke E2E na VPS** com os fluxos reais (repro Rose) + **verificar no banco** — teste verde não é prova; conferir o estado real.

## Fora de escopo (Fase 1)

- Chokepoint global `enforceNoMarkerHonesty` (fica pra fase seguinte).
- Os outros guards texto-puro fora do financeiro (`confirm-bind`, `reply-classify` genérico, `user-confirmation` nos fluxos não-financeiros).
- Telemetria/painel de métrica (o critério de sucesso é ausência de reincidência, não um número instrumentado).
- Unificar os detectores num único `detectUserIntent` (é a tentação da Abordagem B; o piloto prova o padrão primeiro).

## Sucesso do piloto

O fluxo financeiro de confirmação para de gerar bug dessa classe, provado por: (a) os 4 casos-regressão verdes e permanentes; (b) smoke real na VPS; (c) o padrão `estado + gate de domínio` documentado como molde reutilizável pras próximas fases.
