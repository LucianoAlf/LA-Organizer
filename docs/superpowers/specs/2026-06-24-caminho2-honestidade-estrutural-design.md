# Caminho 2 — Honestidade estrutural do TOM (design)

**Data:** 2026-06-24
**Status:** aprovado pra virar plano (Alf + revisor) — Modelo α incorporado
**Raiz atacada:** a CLASSE confabulação/derrotismo, não o indivíduo

---

## 1. O problema (raiz, não sintoma)

Evidência do próprio ledger (`tom_known_issues`, 24/06):

- 247 bugs marcados `corrigido`; **só 3 voltaram pelo mesmo código.** Pela métrica, os fixes seguram.
- E mesmo assim a dor persiste: **confabulação foi "corrigida" 7× com 7 códigos diferentes; derrotismo ~6× (+ Matheus hoje, a 7ª, fora do ledger); recorrência 10+×.**

**Conclusão:** o ledger conta CADÁVERES (instância). O usuário vive a DOENÇA (classe). A gente mata um corpo, a doença anda pra sala do lado e vira "código novo". `corrigido` mede instância; o Alf vive a classe.

**Por que toda trava até hoje falhou** (trace de código, 24/06):
1. A trava de honestidade (`enforceNoMarkerHonesty`) só pega **um sentido**: o TOM mentindo "✅ feito". O contrário — "não tenho como" (Matheus) — **não tem trava nenhuma**, só texto de skill que o LLM ignora.
2. Só cobre **uma porta** (conversa 1:1 / `processMessage`). Dispatcher (rituais/proativos) e internal-api mandam direto, **sem trava**.
3. **Ninguém verifica se a trava está viva.** Morreu 106× calada (`CONFAB-CHOKEPOINT-SCOPE`); o `catch` "não-fatal" vai esconder o próximo erro igual.
4. Marker inventado pelo LLM sai cru pro usuário, **sem log**.

Toda trava dessas é **polícia**: corre atrás do LLM depois que ele fala. A doença é mais rápida que a polícia — sempre sobra uma porta, um sentido ou uma frase.

## 2. O princípio (a inversão) — Modelo α: o engine é dono da LINHA do fato

**O LLM perde o direito de afirmar um fato de estado.** A **linha do fato** de toda resposta é **escrita pelo engine**, por template **na voz do TOM**, a partir do que está no banco. O LLM só põe o **carinho em volta** (saudação, encorajamento, empatia) — **nunca dentro** da afirmação de estado.

- "✅ Lançado R$ 50 no Nubank" → linha escrita pelo engine a partir do que persistiu.
- "esse é de 2 dias atrás; no chat eu só alcanço as últimas 2h — no app é rapidinho: …" → linha escrita pelo engine quando o resolver diz que não dá.

### α vs β — a distinção que define a assinatura dos construtores

- **Modelo α — engine escreve a linha; LLM fora dela.** É o que o `launch_confirm` JÁ faz (engine.js:7905-7948): o engine monta o texto do fato **verbatim**; o LLM não está no loop daquela linha. Não mente, **não omite**, não altera. **É o padrão.**
- **Modelo β — "LLM veste o esqueleto" (re-renderiza).** Risco real: o LLM pode **omitir** um fato (esquecer qual cartão), alterar, ou contrabandear estado novo no "vestir". O velocímetro pega contrabando (afirmação a mais), mas **não pega omissão** facilmente. → β **só** onde α for rígido demais, e ali o velocímetro é a rede.

O LLM não mente porque **não tem mais como escrever a linha do fato** — só o carinho em volta.

**Voz sagrada, intocada.** O template da linha do fato **já carrega o tom do TOM** — o `launch_confirm` é a prova de que template-na-voz-do-TOM é caloroso, não robótico. Isto mexe só em **mecânica e honestidade**: o TOM perde só o direito de **inventar que fez** (confab) ou **inventar que não consegue** (derrotismo). Jeito, carinho, tamanho e tom: nada muda.

**"Provado em miniatura" agora é literal:** o `launch_confirm` é o Modelo α numa fatia (engine dono do texto do fato). A meta é que **toda** linha de estado nasça assim — inclusive a linha NEGATIVA honesta (§3B).

## 3. Arquitetura — 3 peças

### (A) Resolvedor determinístico de capacidade & alcance — o keystone

Módulo puro/testável que, dado `(domínio, ação, params, estado_do_banco)`, decide **ANTES do LLM**:

```
resolve(intent, ctx) -> {
  can: boolean,        // a ação existe no engine?
  reachable: boolean,  // está no alcance? (janela temporal, escopo, alvo único)
  reason: string,      // por que não (p/ telemetria + montar redirect)
  redirect?: { app_path, why }  // caminho honesto quando !reachable
}
```

Exemplos finança:
- **criar gasto** ("joga esses dados") → `can:true, reachable:true` SEMPRE (criar não tem janela). Nunca recusar.
- **editar lançamento** → `can:true`; `reachable` = alvo dentro das ~2h **e** identificável de forma única. Senão → `redirect` honesto.

Move a **DECISÃO da ação** pro código (refinamento #3), não só o relato. Alimenta as outras duas peças:
- o **engine age** (ou monta a linha de redirect honesto) em vez de deixar o LLM recusar;
- o **medidor** sabe que uma recusa foi FALSA (frase de recusa + `resolve()` diz `can && reachable`).

**Pré-condição única (ver §7):** o handler **CHAMA** `resolve()` como pré-condição; `execute()` só roda se `can && reachable`. Uma decisão, não duas.

### (B) Construtores de esqueleto factual — Modelo α (engine ESCREVE a linha), por domínio

Espelham o `launch_confirm`, **nos dois sentidos**, e **escrevem a linha do fato** (não "entregam um esqueleto pro LLM vestir"):
- **Positivo** ("✅ fiz X: …") — parcialmente já existe (montagens de finança); generalizar como template na voz do TOM.
- **Negativo honesto** ("não alcanço isso de N dias atrás; no app é assim: …") — **NOVO**, é o lado que faltava **e o mais propenso a sair robótico**. Template na voz do TOM (referência de tom = `launch_confirm`). **Linha vermelha:** NUNCA "Operação fora da janela permitida".

O LLM só põe o carinho **em volta** da linha. Nunca authora o fato nem a recusa.

### (C) O chokepoint vira VELOCÍMETRO (medidor), não conserto

`enforceNoMarkerHonesty` deixa de ser "o fix" e vira **instrumento de medição** (refinamento #2):
- **Cada disparo = um lugar que o esqueleto ainda não cobre.** Loga por domínio + sentido em **DUAS linhas SEPARADAS: `confab` e `derrotismo`.** Confab é preciso desde o dia 0 (banco mostra "nada persistiu"); derrotismo é ruidoso até a Fatia 1 ter o resolver. **Misturar suja a leitura da curva (a prova) — nunca somar as duas.**
- **Métrica de disparo por dia/domínio/sentido.** A curva caindo → **a prova de que o Caminho 2 funciona.** É a resposta literal a "não tem volta pra 100%": não dá pra provar zero, dá pra provar a **curva caindo** — um número, não um sentimento.
- **Andaime durante a migração** — fica ligado em tudo; quando um domínio chega a ~0 disparo, está coberto.
- **Liveness:** o `catch` que hoje engole o erro passa a **ALERTAR** (incrementa métrica + avisa), nunca mais morre calado.

> Não é "Caminho 1 OU 2". **2 é o destino; o chokepoint (1) é o velocímetro** que prova a viagem.

## 4. Migração incremental por tráfego (não big-bang)

Superfície total (tarefa, evento, inventário, hábito, fatura, estorno, fechamento, digest…) de uma vez = o próprio buraco sem fundo. Migra **o que mais morde**, rankeado pelo ledger.

**Fatia 0 — Velocímetro + liveness (pré-requisito):**
- Instrumentar o disparo do chokepoint como métrica por domínio/sentido (confab medível já: "nada persistiu" + reply afirma).
- Detector **provisório** de derrotismo (frase de recusa + intent acionável + sem marker) como **sinal de watch** (impreciso de propósito — vira preciso na Fatia 1 com o resolver). Linha de métrica SEPARADA.
- Matar o silent-catch (alertar, não engolir).
- **Inventário das portas reais na VPS** (§6).
- **Baseline:** disparos/dia (confab e derrotismo, separados) ANTES de migrar. Sem velocímetro instalado não dá pra provar a curva.

**Fatia 1 — Finança / derrotismo (a que mais morde agora):**
- Onde o Matheus furou hoje + Rose essa semana; reusa o `launch_confirm` (α) já provado.
- Confab de finança já largamente coberto (Camada 2) → trabalho NOVO = **lado derrotismo**: resolver de finança (criar = sempre; editar/apagar = janela 2h + alvo único) + **construtor de redirect honesto (α)**.
- Transforma o detector provisório de derrotismo (Fatia 0) em **preciso** para finança (usando `resolve()`).

**Fatias seguintes (roadmap — confirmar ordem pelo ledger na entrega da Fatia 1):** tarefa/checklist → coordenação/repasse → hábito → fechamento/digest. Cada fatia fecha o esqueleto daquele domínio **nos dois sentidos**.

## 5. Definition of Done por fatia

1. **Teste com a frase REAL** do usuário que furou (ex.: a mensagem literal do Matheus / da Rose). É a catraca da classe, não da instância.
2. **Spot-check de VOZ** — principalmente no construtor NEGATIVO (novo, mais propenso a robótico). Tem que **soar como o TOM** (check do Alf/coordenação); `launch_confirm` é a referência de tom. "Operação fora da janela permitida" reprova.
3. A **métrica do chokepoint** (linha daquele domínio/sentido) começa a **cair** (provando cobertura).
4. **Handoff pro chat de coordenação revisar** (com o teste da frase real) — segunda dupla de olhos antes de fechar.
5. Registrar no `tom_known_issues` (código + causa + fix + a métrica como prova).

## 6. As portas (N-doors) — INVENTÁRIO CONFIRMADO NA VPS (F0.1, 24/06)

O chokepoint `enforceNoMarkerHonesty` é chamado em **1 só lugar** (`engine.js:11250`), alcançado por **1 só porta** (`webhook.js:455 → processMessage`, o 1:1). Mas **14 arquivos** enviam ao usuário (`whatsapp.sendMessage`/`sendAndLink`, 238 call-sites):

| Porta | Passa pelo chokepoint? |
|---|---|
| 1:1 `webhook.js:455 → processMessage → engine.js:11250` | ✅ SIM (único metido) |
| `rituals/dispatcher.js` (proativos/rituais) | ❌ NÃO |
| `internal-api.js` | ❌ NÃO |
| `services/send-proativo.js`, `services/proactive-link.js` | ❌ NÃO |
| `rituals/monday-scorecard.js`, `pre-1on1-watcher.js`, `la-journey-lembretes.js`, `la-educa-lembretes.js`, `checkpoint-deadlines.js` | ❌ NÃO |
| `index.js`, `services/engine.js`, `services/sent-message-id.js` | ❌ (infra/wrapper) |

**Conclusão:** só o 1:1 é medido; TODO proativo/ritual/internal-api sai sem velocímetro — é por onde a doença migra. Cobrir essas portas (rotear o envio por um wrapper metido) é trabalho de fatia futura; a **Fatia 0 mede o 1:1** (maior tráfego de AÇÃO) e fixa a linha-base. Sem `group-chat-engine.js` no `src/` — o chat de grupo passa pelo mesmo `processMessage` ou é VPS-only (verificar na fatia de grupo).

## 7. Invariantes & travas

- **Pré-condição única (fonte de verdade por construção):** o handler **CHAMA `resolve()`**; `execute()` só roda se `can && reachable`. "Reusar a mesma query" NÃO basta — duas funções com a mesma query divergem quando alguém edita uma. **Uma decisão só, não duas que precisam concordar.**
- O resolver e os construtores rodam com o **`collaborator_id` do remetente** (service_role, ignora RLS) — nunca um id vindo do LLM.
- **Sem migração de schema** desnecessária; reusar `marker_logs` para a métrica se couber (evitar drift de CHECK — ver `FIN-INVOICE-INTENT-KIND-CONSTRAINT`).
- **Voz intocada (Modelo α)** — o engine escreve a LINHA do fato por template na voz do TOM; o LLM só põe carinho em volta. Texto robótico no construtor = bug do construtor (`launch_confirm` é a referência de tom).
- O chokepoint **nunca mais** engole erro em silêncio.

## 8. Escopo desta entrega vs futuro

**Agora (vira plano):** Fatia 0 (velocímetro + liveness + inventário de portas) + Fatia 1 (finança/derrotismo).
**Roadmap (não agora):** demais domínios, um por vez, cada um com resolver + construtor negativo + DoD.

## 9. Riscos / YAGNI

- **Risco (o que mais preocupa):** resolver virar 2ª fonte de verdade que diverge do handler. "Reusar a mesma query" NÃO basta. **Fix estrutural:** o handler **chama `resolve()` como pré-condição**; `execute()` só roda se `can && reachable`. Fonte de verdade única por construção (§7).
- **Risco:** detector de derrotismo dar falso-positivo em redirect LEGÍTIMO ("isso é de 2 dias, vai no app" — verdadeiro). Mitiga: o medidor só conta como mentira quando `resolve()` diz `can && reachable`; redirect honesto NÃO conta.
- **Risco:** construtor negativo sair robótico (mata a voz — linha vermelha do Alf). Mitiga: spot-check de voz no DoD (§5.2); `launch_confirm` é a referência.
- **YAGNI:** não construir resolver pra domínio fora da fatia atual. O velocímetro mostra quando vale a pena.
- **Não** mexer no comportamento/voz. Não "melhorar" respostas. Só mover o FATO pro código.
