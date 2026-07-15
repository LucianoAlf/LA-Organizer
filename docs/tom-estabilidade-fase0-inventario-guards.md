# TOM — Fase 0: Inventário dos Guards (diagnóstico de estabilidade)

> ## ⚠️ ATUALIZAÇÃO 15/07 — o piloto financeiro que este doc recomendava foi REFUTADO
> A recomendação abaixo (Fase 1 = converter os guards do fluxo financeiro texto→estado) **não se sustentou na investigação**: o fluxo financeiro **já decide por estado** (a intent É o gate — os detectores só rodam sob ela, `engine.js:9404`/`8553`). Os 4 bugs de 14/07 foram **regras incompletas** em detectores já no lugar certo (guarda-de-pergunta, guarda-de-ver, FIN_CTX, não-chutar-cartão), fechadas em 14/07. O diagnóstico geral (consertar > migrar; guards texto vs estado) **continua sólido** — mas o alvo da tese é um guard **global cego ao domínio** (ex.: `enforceNoMarkerHonesty`), **não o financeiro**. A Fase 1 só reabre com um falso-positivo de guard global documentado. Detalhes: `docs/superpowers/specs/2026-07-15-tom-guards-fase1-piloto-financeiro-design.md` (bloco de encerramento) + `[[project_guards_fase1_turnstate_review]]`.

**Data:** 2026-07-14
**Pergunta que motivou:** "quebra todo dia, nunca 100% — migrar pra plataforma pronta (Openclaw/Hermes) ou consertar o TOM?"
**Método:** categorizar todo bug histórico (`tom_known_issues`) + classificar cada guard por *como decide* (texto vs estado) e *escopo* (global vs domínio) + mapear os call-sites no `engine.js`.

---

## 1. O número (a "dívida" medida)

- **~369 bugs** já registrados no total.
- **58 deles** são da família **guard de confirmação / honestidade / confab** — e são os que **reincidem** (casos-irmão). Distribuição:
  - 19 CONFAB (afirma sem fazer)
  - 15 GUARD atropela/cega (clobber, loop, wrongbind, ignored, blind)
  - 6 NOOP (confirmou, não executou)
  - 5 FALSO-POSITIVO puro (guard disparou em contexto errado)
  - 13 outros correlatos

Não é a maior categoria bruta, mas é a de **maior reincidência** — a mesma doença voltando num caminho novo. Os dois bugs de hoje (`FIN-LAUNCH-CONFIRM-ON-QUESTION`, `SENDHONESTY-FALSEFIRE-FINANCE`) são exatamente isso.

## 2. A causa-raiz (uma só)

**Os guards decidem por regex de texto uma coisa que o engine já sabe por estado.**

Classificação dos guards de decisão (leitura + proxy):

| Guard (módulo) | Decide por | Escopo | Reincidência |
|---|---|---|---|
| `services/user-confirmation.js` (detectUserConfirmation) | **TEXTO** (regex) | chamado em **4 fluxos** distintos | CONFIRM-SHORTYES-*, BATCH-CONFIRM-* |
| `services/reply-classify.js` (isInfoGathering, hasTrailingQuestion) | **TEXTO** (regex) | global | alimenta os CHOKEPOINT-FALSEFIRE |
| `finance/launch-confirm.js` (detectLaunchConfirm) | **TEXTO** (regex) | domínio-fatura | NEGATION-IGNORED, ON-QUESTION (hoje) |
| `lib/coord-send-honesty.js` (claimsSent/enforceSendHonesty) | **TEXTO** (regex) | **global** (roda até em fatura) | FALSEFIRE-FINANCE (hoje) |
| `utils/confirm-bind.js` (confirmationBindOk) | **TEXTO** (regex) | domínio-anchor | CONFIRM-ANCHOR-WRONGBIND |
| `lib/optimistic-confirm.js` (enforceNoMarkerHonesty) | **HÍBRIDO** — gate por estado (`nothingPersisted`), *o quê* por regex | global pré-envio | CHOKEPOINT-FALSEFIRE-* |
| `lib/count-honesty.js` (enforceCountHonesty) | **ESTADO** (`persistedCount`) | domínio | poucos |
| `lib/confab-partial-observe.js` | **ESTADO puro** | domínio | **ZERO falso-positivo** ✅ |

**O contraste prova a tese:** o único guard 100%-estado (`confab-partial-observe`) nunca gerou falso-positivo. Todos os `-FALSEFIRE-`/`-IGNORED-`/`-WRONGBIND-` vêm dos guards texto-puro.

### Os 3 defeitos estruturais

1. **Decide por texto, não por estado.** O engine SABE se um marker rodou/persistiu neste turno; mesmo assim pergunta pro regex "o texto tem a palavra X?". Regex é chute; estado é fato.
2. **Escopo global sem gate de domínio.** `enforceSendHonesty` (recado) roda em TODO turno e disparou num papo de **fatura** porque "mandando" casou. Deveria só rodar quando o turno teve intenção de coordenação.
3. **Fix pontual, não por classe.** Cada bug vira um regex a mais no `engine.js` (12k linhas). O irmão reaparece semana seguinte num caminho que o regex novo não cobre. `detectUserConfirmation` chamado em 4 lugares com wrappers diferentes = 4 chances de divergir.

## 3. Plano (consertar)

- **Fase 1 — Guards por estado + escopo de domínio** *(maior ganho; ataca ~50 bugs de uma classe)*
  Cada guard passa a decidir "o marker X rodou? persistiu?" e só roda no fluxo a que pertence. Modelo já existe no repo: `confab-partial-observe.js`.
- **Fase 2 — Um detector por conceito, reusado.** Um `detectConfirmação` (sim/não/pergunta/negação) testado à exaustão, consumido por todos os fluxos. Hoje cada fluxo reimplementa o gate ao redor do detector.
- **Fase 3 — Quebrar `engine.js`** em módulos por domínio (já começou: launch-confirm, coord-send-honesty, batch-complete são módulos puros).

## 4. Veredito: consertar > migrar

- O que quebra **não é o LLM** e **não é o produto** — é uma **camada de ~8 guards**, 5 dos quais decidindo por texto frágil. É finito e endereçável.
- Migrar pra plataforma pronta **joga fora o produto** (financeiro/Pluggy/rituais/grupos/coordenação) pra resolver uma dívida de 8 arquivos. E troca "erra alto e visível" por "erra baixo e silencioso" (plataforma sem catraca confabula sem avisar).
- **Chega em 90-95% percebido?** Sim — condicional à Fase 1. Hoje a taxa de bug *cresce com as features*; o refactor desacopla as duas. A camada determinística converge pra ~99% (é código testável); o LLM erra ~5-10% mas visível. Metade do "quebra todo dia" é a própria catraca disparando errado — código nosso, some com teste.
- **100% nunca** (tem LLM não-determinístico). Quem prometer 100% mente.

**Recomendação:** executar Fase 1 (brainstorm → spec → plano → TDD). Estimativa grosseira: 1-2 semanas de foco, pausando features. Retorno: mata a classe de bug que gera a percepção de instabilidade.
