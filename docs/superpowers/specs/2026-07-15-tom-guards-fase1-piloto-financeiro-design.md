# TOM Guards — Fase 1 (piloto): estado do turno no fluxo financeiro

> ## ⛔ ENCERRADO — PILOTO REFUTADO PELA PRÓPRIA INVESTIGAÇÃO (15/07)
> **Não executar este plano.** Ao furar a premissa no código (Task 0), o fluxo financeiro se revelou **já estado-gateado**: os detectores só rodam sob a intent aberta (`engine.js:9404` invoice, `engine.js:8553` launch), e a proposta já vive no `payload`. Consequência: as Tasks 2-3 seriam **no-op** (o gate de estado já existe), a Task 1 (`finance-turn-state.js`) ficaria **sem consumidor** (infra morta), e a Task 4 (gate de turno no `enforceSendHonesty`) foi **reprovada pela catraca** — regressiva (silencia verbo-forte em turno financeiro) e conceitualmente furada (`hasCoordSignal=marker` nunca pega confab, que é *sem* marker).
>
> **Leitura que fica:** os 4 bugs de 14/07 **não** foram "guard cego decidindo por texto" — foram **regras incompletas** dentro de detectores já no lugar certo (faltavam guarda-de-pergunta, guarda-de-ver, FIN_CTX, não-chutar-cartão), todas fechadas em 14/07 no eixo certo. O financeiro já está estável.
>
> **A tese "estado > texto" segue válida** — mas o alvo dela é um guard **global cego ao domínio**, não o financeiro. A Fase 1 só REABRE com um **falso-positivo real de guard global documentado** no banco (não por antecipação — seria "infra pela infra" num endereço novo). O chokepoint `enforceNoMarkerHonesty` já decide parte por estado (`nothingPersisted:!marker_emitted`), então nem é óbvio que ele é o próximo paciente.
>
> **Janela de aceite herdada (trava 3):** reincidência-ZERO da classe no fluxo financeiro em `tom_known_issues`/`marker_logs`, **15/07 → ~29/07**. O código morreu; a medição fica. Ver `[[project_guards_fase1_turnstate_review]]`.

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

### 3. Gate de domínio no guard que vazou — por SINAL de coordenação, não por domínio binário

⚠️ **Trava de reviewer (catraca, 15/07):** o gate NÃO pode ser "turno é financeiro → cala o guard de recado". Um turno que seja financeiro **E** contenha um recado real teria a confab de envio silenciada → falso-**negativo** (mentira passa), que é **pior** que o falso-positivo de hoje. Isso recriaria, invertida, a própria classe que a spec mata.

- `enforceSendHonesty(text, { turnState, isQuestion })` — o gate **afirma** (roda quando há sinal), não nega por domínio. O guard **age** quando há **sinal de coordenação no turno**: um marker `COORDINATION_REQUEST` emitido (mesmo rejeitado) ou detecção de recado. **Sem** sinal de coordenação **e** com ação financeira no turno → o "mandando/enviado" é financeiro → não age. Ou seja: o `turnState` decide *se o verbo-de-envio tem sujeito de recado*, não *se existe uma intent financeira em algum lugar*.
- O split strong/weak + `FIN_CTX` por-linha (14/07) permanece como **segunda linha** — o gate de domínio é a primeira, o léxico por-linha a segunda.

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

## Task 0 — furar a premissa-mãe ANTES de codar (trava de reviewer)

A spec inteira apoia em "o estado do turno já existe e o engine já lê (intents + markers)". **Isso é hipótese até ser confirmado no código.** A Task 0 do plano, antes de qualquer linha de produção, prova lendo `engine.js`:

- **Onde cada guard dispara vs. onde o dado existe.** `enforceSendHonesty` roda no **pré-envio** (resposta já redigida) — nesse ponto os markers do turno já rodaram (existem), e as intents foram lidas na entrada. Os detectores financeiros (`detectInvoiceReply`/`detectLaunchConfirm`) rodam nos intercepts, ainda mais cedo. Confirmar que `turnState` pode ser montado e estar disponível **em cada um desses pontos** — se a ordem não fechar (ex.: markers do turno não acessíveis no pré-envio), o piloto morre na origem e o plano para aqui.
- **Os `kind`/`form` reais** das intents financeiras (`finance_source`/`invoice_import`, seus `form`/`stage`) — cravados do código, não supostos.

Saída da Task 0: um parágrafo "premissa confirmada / premissa furada" com as linhas exatas do engine. Só depois disso o helper puro é escrito.

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

## Portão de aceite (trava de reviewer)

Teste verde **não é prova** (lição-mãe). O piloto só é declarado bom quando:
1. Os **4 casos-regressão** de 14/07 verdes e permanentes.
2. **Smoke real na VPS** (repro Rose dos 4 fluxos) + **olho no banco** (o estado gravado confere).
3. **Reincidência ZERO da classe no fluxo financeiro por ~2 semanas**, medida em `tom_known_issues` / `marker_logs` — não um número instrumentado (telemetria fica fora do piloto).

## Sucesso do piloto

O fluxo financeiro de confirmação para de gerar bug dessa classe, provado pelo portão de aceite acima, e o padrão `estado + gate por sinal de domínio` fica documentado como molde reutilizável pras próximas fases (chokepoint global, outros guards).
