# Digest de governança — card por líder (redesenho)

**Data:** 2026-07-16
**Validado com:** Alf (CEO) — modelo aprovado em brainstorm com mockups
**Status:** spec aprovada → plano de implementação

---

## 1. O problema (com evidência)

O digest diário de governança (`🌅 Governança · Visão da empresa`) chega todo dia pro Alf e
**ele parou de ler**. Palavras dele: *"é tão desorganizado na minha concepção... pra mim tem muito
ruído e pouca coisa realmente funcional. Eu não tô nem olhando."*

Não é falta de dado. São **quatro defeitos concretos**, todos verificados no código:

### 1.1 O scorecard mede o líder como EXECUTOR, não como GESTOR

`services/scorecard-builder.js:49` e `:58` filtram `.eq('assigned_to', leaderId)`.
**O time nunca entra na conta.**

Prova com dado real de produção (16/07):

| Pessoa | Papel | Atrasadas | Efeito no scorecard |
|---|---|---|---|
| Peterson | `collaborator` | **9** | **nenhum** — não é líder, não tem scorecard |
| Juliana | `coordinator` (lidera Peterson) | 2 (próprias) | aparece com **2** |
| Quintela | `coordinator` (lidera Peterson) | 1 (própria) | aparece com **1** |

As 9 atrasadas do Peterson — a maior concentração da empresa — **não pintam ninguém**.
É literalmente a informação que o Alf pediu (*"se o líder tá atrasando ou se o liderado desse
líder está atrasando"*) e que o relatório não tem.

### 1.2 A tarefa velha PERDE o líder

`rituals/dispatcher.js:2703-2712`:

```js
// Separa por idade: 3+ dias = bucket CEO; resto agrupa por líder.
if (days >= 3) { ceoBucket.push({ ...t, days }); continue; }
const leader = resolveLeadersOf(owner, allCollabs).find((l) => !l.is_ceo) || null;
```

Só tarefas de **1-2 dias** são agrupadas por líder. Tudo com 3+ dias cai num balde plano sem
líder atrelado. **Quanto pior a tarefa, menos estrutura ela tem** — e o vínculo que o Alf precisa
pra cobrar é jogado fora justamente nos casos graves.

### 1.3 A mesma tarefa aparece em até 4 blocos

`rituals/dispatcher.js:2814`:

```js
text: `📋 *Tarefas atrasadas*\n...${lines}${diagSection}${stuckSection}${staleCheckBlock}`
```

Quatro blocos, **quatro eixos diferentes sobre as mesmas tarefas**. Uma tarefa de 45d cobrada 3x
aparece em:

| Bloco | Eixo | Como |
|---|---|---|
| `🚨 Pra você decidir — 3+ dias` | idade | título completo |
| `🔍 Diagnóstico` (LLM por dono) | pessoa | citada na análise |
| `⚠️ 3+ cobranças sem efeito` | cobrança | contada |
| `⏳ Paradas 5+ dias — já rolou?` | staleness | título completo de novo |

**Este é o ruído.** Não é volume — é repetição do mesmo fato por lentes que não conversam.

### 1.4 Defeitos menores, mesma família

- **"100% de zero"** — `scorecard-builder.js:71`: `closure_rate = denominator === 0 ? 1.0`.
  Quem não tem tarefa ganha 100% e vira 🟢. Caso Rose: 🟢 100% liderando 4 pessoas.
- **`stuck` invisível** — `rituals/governance-digest.js:30` pinta 🔴 com `stuck >= 2`, mas a linha
  renderizada (`:57`) só imprime `%` e `atras.`. Resultado: `🔴 Rafinha — 100%` — ilegível,
  porque o motivo da cor não é impresso.

### 1.5 O motor certo já existe — parou no meio

`web/src/components/team/TeamDrillPanel.tsx` já faz o modelo certo: líder no topo + os liderados
dele embaixo com as atrasadas de cada um. Mas (a) mostra só a **contagem**, nunca os títulos, e
(b) **nunca virou WhatsApp** — o digest usa a versão magra `formatScorecardSection`.
O cabeçalho dele ainda usa a métrica de executor, então a tela mostra "Clayton 100%, 0 atrasadas"
com o time dele pegando fogo logo abaixo.

---

## 2. Decisões do Alf (validadas em brainstorm com mockups)

| # | Decisão | Escolha |
|---|---|---|
| 1 | O que decide a cor do líder | **Time + próprias numa nota só** — o líder responde por tudo que passa por ele. Um líder afogado nas próprias tarefas com time limpo NÃO pode ficar 🟢. |
| 2 | Mantém percentual? | **Sim — % do conjunto + contagem.** Recalculado sobre líder + time. Quem não tem tarefa **não ganha nota** (mata o "100% de zero"). |
| 3 | Quem ganha card completo | **Só quem precisa de ação** (🔴 e 🟡). Os 🟢 colapsam numa linha no rodapé. |
| 4 | Compromisso sem devolutiva | **Entra no card do líder**, na linha da pessoa — junto com as tarefas dela. |
| 5 | Tarefa crônica | **Duas faixas dentro do bloco da pessoa:** `🆕 Caiu hoje` e `⏳ Arrastando`. |

**Requisito transversal (palavras do Alf):** *"se o líder tá dando mole, eu vou printar só a parte
dele e encaminho no WhatsApp pra ele"*. O card de um líder precisa ser **auto-contido e printável**:
tudo que o Alf precisa falar com o Clayton cabe num screenshot.

---

## 3. Decisões técnicas (minhas — com a razão)

### 3.1 Líder principal = quem RESPONDE; os demais VEEM

`resolveLeadersOf` faz fan-out: uma pessoa pode ter vários líderes (`leader-routing.js:17`).
Agrupar por todos duplicaria pessoas no digest do Alf. Medido no dado real: **38 tarefas atrasadas
viram 62 linhas** com fan-out (+63%) — a Gabi (4 líderes) apareceria 4x.

**Decisão:** o digest do Alf agrupa pelo **líder principal** (1º não-CEO da lista) — igual ao que o
código já faz hoje em `dispatcher.js:2711`. Os co-líderes são **nomeados no cabeçalho do card**
(`_pedagógico dividido com o Quintela_`), pra ninguém escapar da cobrança.

Isso é consistente com a regra do Alf de 08/06 (`leader-routing.js:11`): *"os DOIS veem todos"* —
**veem** é visibilidade, não accountability. O digest do líder (`sendLeaderGovernanceDigest`)
continua usando `governanceViewerIdsOf` (fan-out completo), então o Quintela **segue vendo** o
Peterson na mensagem dele. Nada de visibilidade se perde.

### 3.2 🔴 O líder principal é NÃO-DETERMINÍSTICO hoje — precisa de desempate

`services/governance-edges.js` carrega tudo **sem `ORDER BY`**:

```js
.from('collaborators').select(...).eq('is_active', true);      // sem ORDER BY
.from('governance_edges').select('member_id, leader_id');      // sem ORDER BY
.from('governance_leaders').select('group_key, unit, leader_id'); // sem ORDER BY
```

`groupLeaderIdsFor` preserva a ordem da entrada, e `resolveLeadersOf` insere nessa ordem. Logo
`resolveLeadersOf(Peterson)` pode devolver `[Juliana, Quintela]` **ou** `[Quintela, Juliana]`,
conforme a ordem física das linhas no Postgres — que muda sozinha após `UPDATE`/`VACUUM`.

Hoje o raio de dano é pequeno (só tarefas de 1-2d usam `byLeader`). O desenho novo pendura **o
relatório inteiro** nisso: o bloco do Peterson pularia da Juliana pro Quintela sozinho, e o Alf
printaria a pessoa errada.

**Decisão:** `resolveLeadersOf` ordena **dentro de cada tier**, preservando a prioridade documentada
entre tiers (gerente-da-unidade → líder-de-grupo → aresta-explícita → CEO). Desempate dentro do
tier: `full_name` e, se empatar, `id`. Determinístico por construção, sem depender do banco.

Efeito prático: o Peterson fica na Juliana permanentemente (alfabético). Se o Alf quiser escolher
o principal a dedo, isso vira coluna de prioridade em `governance_leaders` — **fora do escopo aqui**.

### 3.3 O % e o card medem o MESMO conjunto

Se o card lista 6 pendências e o `%` vem de um conjunto diferente, os números não fecham na cara do
Alf. Então: **escopo do scorecard = líder + time do líder principal + ele mesmo** — exatamente o que
o card lista. `%` e itens sempre batem.

Consequência aceita: o scorecard do Quintela cobre só o que ele **responde** (as próprias), não o que
ele **vê**. É honesto: quem responde pelo Peterson é a Juliana.

### 3.4 A inteligência do LLM não morre — muda de lugar

O bloco `🔍 Diagnóstico` (`services/governance-analyzer.js`) é a parte mais inteligente do relatório
de hoje, e some se a gente só apagar blocos. Ele **desce pra dentro da linha da pessoa** como `💡`,
onde tem contexto. `analyzePersonBacklog` é reaproveitado sem mudança de assinatura.

---

## 4. Arquitetura

Duas funções **puras** (sem I/O) + o dispatcher só buscando e chamando. Puro = testável com
`node --test`, sem mock de Supabase.

```
dispatcher.js  (I/O: busca tasks, events, collabs, scorecards)
      │
      ▼
buildLeaderCards({ tasks, events, collabs, scorecards, today })   ← PURA
      │   agrupa por líder principal, separa novo/arrastando,
      │   calcula totals + cor, monta o balde "direto com você"
      ▼
  { cards, unassigned, ritmo }
      │
      ▼
renderLeaderCard(card) / renderDigest(...)                        ← PURA
      │   estrutura → texto WhatsApp
      ▼
assembleDigest({ header, sections, footer })   ← JÁ EXISTE, não muda
```

**Arquivos:**

- **Criar** `src/rituals/leader-cards.js` — `buildLeaderCards` + `renderLeaderCard`
- **Criar** `src/rituals/leader-cards.test.js` — TDD
- **Modificar** `src/services/leader-routing.js` — desempate determinístico (§3.2)
- **Modificar** `src/services/scorecard-builder.js` — escopo do conjunto (§3.3) + `null` em vez de `1.0`
- **Modificar** `src/rituals/dispatcher.js` — `ceoTeamUnclosedTasksReport` monta via `buildLeaderCards`
- **Modificar** `web/src/lib/scorecard-classify.ts` — PORT da regra nova (§7.2), mesmo commit
- **Modificar** `web/src/components/team/TeamDrillPanel.tsx` — cabeçalho passa a usar a métrica do conjunto

---

## 5. Contratos de dados

```js
/**
 * @param {Object} opts
 * @param {Array} opts.tasks    tarefas atrasadas de trabalho, JÁ filtradas por
 *                              done-twin e por "cobrada nas últimas 24h".
 *                              Campos: id, title, due_date, assigned_to,
 *                                      governance_owner_id, coordination_request_count
 * @param {Array} opts.events   compromissos passados sem devolutiva (tabela `events`).
 *                              Campos REAIS: id, title, start_at, end_at, collaborator_id.
 *                              ⚠️ é `collaborator_id` (NÃO `owner_id`) e `start_at` (NÃO `starts_at`).
 *                              + `whenLabel` já formatado pelo dispatcher (a pura não formata TZ).
 * @param {Array} opts.collabs  saída de loadCollabsWithEdges (com explicit_leader_ids
 *                              e group_leader_ids anexados)
 * @param {Map<string,Object>} opts.scorecards  leader_id → { closure_rate, tasks_closed } da
 *                              ÚLTIMA semana fechada, já com o escopo do conjunto (§3.3).
 *                              Única fonte do closurePct — NUNCA da contagem exibida (§7.1).
 * @param {string} opts.today   YMD em America/Sao_Paulo (nunca toISOString().slice(0,10))
 * @returns {{ cards: Card[], unassigned: PersonBlock[], ritmo: Array<{id,name}> }}
 */
buildLeaderCards({ tasks, events, collabs, scorecards, today })
```

```js
Card = {
  leader:    { id, name },              // name = primeiro nome
  coLeaders: [{ id, name, label }],     // §5.1 — nota do cabeçalho
  dot:       '🔴' | '🟡' | '🟢',
  closurePct: number | null,            // SEMANAL (do scorecard). null = sem nota (§7.3)
  totals:    { all, team, own },        // AO VIVO (contado de `tasks`) — §7.1
  people:    PersonBlock[],             // ordenado: mais pendências primeiro; o "self" por ÚLTIMO
}

PersonBlock = {
  person:     { id, name },
  isSelf:     boolean,                  // true → renderiza "Dele"/"Dela"
  novo:       Item[],                   // days === 1
  arrastando: Item[],                   // days >= 2, ordenado por days desc
  events:     EventItem[],
  diagnostic: string | null,            // 💡 do LLM; só quando count >= 3
  count:      number,                   // novo + arrastando + events
}

Item      = { id, title, days, stuck }  // stuck = coordination_request_count >= 3
EventItem = { id, title, whenLabel }    // whenLabel: "ontem 14h" (1d) | "seg 10h" (≤7d) |
                                        // "12/07 10h" (>7d). Sempre America/Sao_Paulo.
```

### 5.1 `coLeaders` — definição exata

Pra cada pessoa do card, `resolveLeadersOf(pessoa)` devolve N líderes; o 1º é o principal (= o dono
deste card). **`coLeaders` = a união dos demais, sobre todas as pessoas do card, menos o CEO e menos
o próprio dono do card, deduplicada por `id` e ordenada por nome.**

`label` = rótulo do vínculo compartilhado: se **todas** as pessoas que o card divide com aquele
co-líder têm o mesmo `function_role`, usa o rótulo dele; senão `'time'`. Mapa (o único novo):

```js
const FUNCTION_LABELS = {
  pedagogico: 'pedagógico', farmer: 'farmers', marketing: 'marketing',
  ops_tecnicas: 'ops técnicas', financeiro: 'financeiro', sonoramente: 'Sonoramente', tech: 'tech',
};
```

Ex.: no card da Juliana o Peterson resolve pra `[Juliana, Quintela]`, ambos via `pedagogico` →
`coLeaders = [{ Quintela, label: 'pedagógico' }]` → cabeçalho `_pedagógico dividido com o Quintela_`.
Card sem co-líder **não imprime a linha**.

**Fronteira de I/O:** `buildLeaderCards` é pura e síncrona. O `diagnostic` (LLM) é **injetado depois**
pelo dispatcher, que faz as chamadas `analyzePersonBacklog` em cima da estrutura já montada. A função
pura nunca chama LLM nem banco.

---

## 6. Fluxo de dados

1. Dispatcher busca atrasadas (query atual de `ceoTeamUnclosedTasksReport`, **inalterada**).
2. Aplica o guard done-twin (`dropOpenWithDoneTwin`) — **inalterado**.
3. Aplica o filtro "cobradas nas últimas 24h" — **inalterado**.
4. Busca compromissos sem devolutiva (`ceoTeamUnclosedEventsReport`, modo dado).
5. `loadCollabsWithEdges` + scorecards da última semana.
6. **`buildLeaderCards(...)`** → estrutura.
7. Dispatcher preenche `diagnostic` nos blocos com `count >= 3` via `analyzePersonBacklog`.
8. `renderLeaderCard` por card → seções.
9. `assembleDigest({ header, sections, footer })` — **inalterado** (divide em N mensagens se passar de 4000).

---

## 7. Regras

### 7.1 Os DOIS relógios (ler antes de 7.2 e 7.3)

Há duas fontes de tempo aqui. Misturá-las errado gera número-quimera — e é a armadilha #1 deste
redesenho:

- **`closurePct` é SEMANAL.** Vem de `leader_scorecards` (última semana fechada), recalculado por
  `computeScorecard` com o escopo do conjunto (§3.3). Taxa de fechamento é medida de semana; isso
  está correto e é o que o código já faz de propósito (`dispatcher.js:2987`).
- **Contagem (`totals`, `overdue`, `stuck`) é AO VIVO.** Contada de `tasks` AGORA. O snapshot semanal
  congela por 5-7 dias até a próxima segunda (caso Krissya 1≠4 / Rafinha 2≠0, 20/06) — a contagem
  exibida **nunca** pode sair dele.

**Consequência que a régua PRECISA respeitar:** `noTasks` não pode vir do snapshot. Se o líder fechou
tudo na semana passada (`closed=0, overdue=0` no snapshot) mas tem 3 atrasadas hoje, um `noTasks`
calculado do snapshot diria 🟢 com o card listando 3 pendências — a contradição que este redesenho
existe pra matar.

### 7.2 Cor (a mesma nos dois lados: JS e TS)

Thresholds **idênticos aos de hoje** (`scorecard-builder.js:202-209`), só que sobre o **conjunto**
(líder + time) e com as fontes certas de cada termo (§7.1):

```js
// closurePct: SEMANAL, 0-100 ou null.  overdueLive / stuckLive: AO VIVO.
const noTasks = overdueLive === 0 && stuckLive === 0 && closedLastWeek === 0;
const badPct  = closurePct !== null && closurePct < 60;   // guard de null OBRIGATÓRIO
const midPct  = closurePct !== null && closurePct < 85;

🔴 atenção:  !noTasks && (badPct || overdueLive >= 3 || stuckLive >= 2)
🟡 de olho:  !noTasks && (midPct || overdueLive >= 1)
🟢 no ritmo: resto (inclui noTasks)
```

🔴 **O guard `closurePct !== null` é obrigatório, não estilo.** Sem ele, `null < 60` é `true` em JS
(`null` coage pra 0) e todo líder sem nota seria pintado de 🔴 — exatamente o bug oposto ao "100% de
zero" que a gente veio consertar. Mesma família do `\b` ASCII: o operador mente calado.

Manter os thresholds é deliberado: **muda o escopo e a fonte, não a régua** — uma variável por vez.

### 7.3 Percentual

```js
// em computeScorecard (semanal, escopo do conjunto):
denominator  = closed + overdueNoFimDaSemana
closure_rate = denominator === 0 ? null : closed / denominator   // era `? 1.0`

// no card (exibição):
closurePct = closure_rate === null ? null : Math.round(100 * closure_rate)
```

`null` → o card **não imprime %**. Nunca 100%. Mata o caso Rose (🟢 100% de zero).

**Efeito colateral aceito:** `closure_rate` vira nullable em `leader_scorecards`. A coluna já aceita
`null` (não tem `NOT NULL`) — **sem migration**. Mas todo consumidor precisa do guard de `null`:
`scorecard-classify.ts` (o tipo `ScoreLite.closure_rate` passa a `number | null`), `renderForDirector`,
`renderForLeader` e `LeaderSemaphoreRow` (`Math.round((sc.closure_rate ?? 0) * 100)` hoje imprimiria
**0%** pra quem não tem nota — precisa imprimir nada).

### 7.4 Faixas dentro do bloco da pessoa

```
🆕 Caiu hoje  → days === 1
⏳ Arrastando → days >= 2, ordenado por days desc
```

Faixa vazia não é renderizada. Se só existe uma faixa, o rótulo dela é omitido (não vale 2 linhas
pra 1 item).

### 7.5 Corte de itens

Máximo **3 itens por faixa** + `_+N_`. O card precisa caber num screenshot.
`⚠️ cobrada 3x` (stuck) e `days >= 30` **furam a fila**: sempre entram nos 3, porque são o motivo
da cor.

### 7.6 Quem aparece

- `dot === '🔴' || dot === '🟡'` → card completo.
- `dot === '🟢'` → só o primeiro nome na linha `🟢 _No ritmo: ..._`.
- Pessoa cujo único líder é o CEO **e que não é líder** → balde `Direto com você`.
- Líder (manager/coordinator/director) **sempre tem card próprio**; as tarefas dele vão no bloco
  `isSelf` do card dele — **não** caem em `Direto com você` (é a mudança vs. hoje).

---

## 8. Formato renderizado

```
🌅 *Governança · 17 de jul.*
_Visão da empresa · 6 líderes precisam de você_
━━━━━━━━━━━━━━━━━━━
🔴 *Juliana* — 15% · 13 pendências
_11 do time · 2 dela_
_pedagógico dividido com o Quintela_

  *Peterson* · 9
   🆕 *Caiu hoje*
    • Plano de aula 3º ano — 1d
   ⏳ *Arrastando*
    • Conciliação — 45d ⚠️ cobrada 3x
    • Devolutiva Ramon — 12d
    _+6_
   💡 _9 paradas, todas pedagógico. Cobrar já não resolve — marca 1:1._

  *Dai* · 1
    • Relatório de faltas — 2d

  *Dela* · 2
    • Escala de julho — 3d
    • Contrato Leo — 1d
───────────────────
🔴 *Clayton* — 40% · 9 pendências
_5 do time · 4 dele_

  *Daiana* · 5
   ⏳ *Arrastando*
    • Caixa Recreio — 8d
    • Planilha de faltas — 6d
    _+3_
   📅 Reunião de fechamento (ontem 14h)
      _sem devolutiva_

  *Dele* · 4
    • Devolutiva do Arthur — 2d
    _+3_
━━━━━━━━━━━━━━━━━━━
🟢 _No ritmo: Rose · Ana_
_Abre a dashboard 📊 · pra cobrar: "cobra [nome] sobre [tarefa]"_
```

Separadores: `━━━` (`HR` de `governance-digest.js`) entre seções; `───` entre cards.

---

## 9. Zero-regressão

| Risco | Mitigação |
|---|---|
| **Tarefa some** no agrupamento hierárquico | Teste de conservação: `soma(itens em todos os cards) + unassigned === tasks.length`. Quebra se sumir uma. |
| `scorecard-classify.ts` é PORT de `scorecard-builder.js` — divergir faz app e WhatsApp discordarem | Mesmo commit, mesmos casos de teste dos dois lados. Ver [[project_governance_viewer_single_source]]. |
| **Digest do LÍDER** (`sendLeaderGovernanceDigest`) não pode virar primário | Continua com `governanceViewerIdsOf` (fan-out). Teste: Quintela vê Peterson. |
| **`monday-scorecard.js`** consome o mesmo `leader_scorecards` — a métrica nova muda a mensagem de segunda dos líderes | **Muda de propósito** (é o mesmo defeito). Precisa de OK do Alf antes do deploy: 10 líderes recebem. |
| Ordem não-determinística (§3.2) | Desempate na função pura + teste que embaralha a entrada e exige saída estável. |
| Voz/tom do TOM | Nada aqui toca SOUL/skills. É montagem determinística. O único texto de LLM é o `💡`, que já existe e não muda de prompt. |
| Deploy reverter produção | `.deploy-hold` na raiz **antes** de tocar `src/`; deploy cirúrgico sobre cópia FRESCA; `md5` VPS==local antes do restart. |

**Migration:** nenhuma. Todos os campos usados já existem.

---

## 10. Testes (TDD — teste antes do código)

`src/rituals/leader-cards.test.js` (`node --test`):

1. **Conservação** — nenhuma tarefa some: soma dos cards + unassigned == entrada.
2. **Peterson** — 9 atrasadas de um `collaborator` pintam a Juliana de 🔴 (o caso que hoje falha).
3. **Sem duplicata** — pessoa com 4 líderes (Gabi) aparece em **exatamente 1** card.
4. **Determinismo** — embaralhar a ordem de `collabs`/`group_leader_ids` produz **a mesma** saída.
5. **100% de zero** — líder com conjunto vazio → `closurePct === null` e o card não imprime `%`.
6. **Líder afogado** — 8 próprias + time limpo → 🔴 (não 🟢). É o buraco da opção A recusada.
7. **`stuck` visível** — tarefa com `coordination_request_count >= 3` renderiza `⚠️ cobrada 3x`
   **e** entra nos 3 itens do corte (§7.5).
7b. **Guard de `null`** — líder com `closure_rate === null` e 0 pendências → 🟢, **nunca** 🔴
   (`null < 60` é `true` em JS). Espelhado em `scorecard-classify.test.ts`.
8. **Faixas** — `days === 1` → `🆕`; `days >= 2` → `⏳`; faixa vazia não renderiza rótulo.
9. **`isSelf` por último** — o bloco "Dele/Dela" fecha o card.
10. **Direto com você** — não-líder cujo único líder é o CEO cai no balde.
11. **Líder não cai no balde** — as tarefas do Clayton vão no `isSelf` do card dele.

`web/src/lib/scorecard-classify.test.ts`: os mesmos casos 5 e 6, pra provar paridade JS↔TS.

`src/services/leader-routing.test.js`: os 18 testes atuais **continuam passando** + o novo de
determinismo.

---

## 11. Fora de escopo (YAGNI)

- Coluna de prioridade em `governance_leaders` pra o Alf escolher o líder principal a dedo (§3.2).
- Mudar `send_time`, quiet-hours ou o gate `digest_enabled` (o toggle acabou de subir).
- Redesenhar o dashboard desktop além do cabeçalho do `TeamDrillPanel`.
- Mexer no digest do LÍDER além de garantir que ele não regride.
- Trocar os thresholds da régua de cor (§7.2) — muda o escopo e a fonte, não a régua.
