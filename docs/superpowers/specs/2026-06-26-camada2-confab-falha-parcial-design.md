# Camada-2 — Confab de falha PARCIAL (design)

**Data:** 2026-06-26
**Autor:** Auditoria das 7 (Claude) · homologado pelo revisor-catraca
**Status:** design aprovado — Fase 0 pronta pra plano; Fase 1 condicional (depende dos dados da Fase 0)
**Known-issue (provisório):** `CONFAB-PARTIAL-LEAK` (registrar só se a Fase 0 provar o resíduo)

---

## 1. Problema

O TOM emite N markers num turno. Quando **alguns** falham e **outros** persistem, a afirmação
sobre o que **falhou** vaza na resposta — mas a Camada-1 (anti-confab no-marker) **não dispara**,
porque algo persistiu.

Caso-mãe (Jhonatan, 26/06): LLM emitiu `<<TASK_UPDATE>>` (executou — "movi pra amanhã") **+**
`<<PREFS_UPDATE>>` com `do_not_disturb_until` (rejeitado — campo dropado de propósito). A reply
dizia "movi pra amanhã **e fico quieto pro resto da noite**". O "movi" é verdade; o "fico quieto"
é **confab** — o DND nunca foi setado.

> Nota: o caso Jhonatan **exato já fechou** na 1ª linha (`PREFS-DND-ROUTE`, 26/06: o DND-via-PREFS
> agora é roteado pra `applyDnd`, o marker **sucede**). Esta Camada-2 existe pra a **classe** que
> sobra: rejeição não-recuperável de um domínio coexistindo com execução de outro, com frase de
> alegação do domínio rejeitado. **Não sabemos ainda se essa classe tem resíduo real além do
> Jhonatan** — descobrir isso é a Fase 0.

---

## 2. Princípio (a disciplina que rege o design)

1. **Prova antes de cirurgia.** O caso-mãe já está resolvido na origem. Antes de embarcar uma
   máquina frágil (denylist de frases em prosa livre), a Fase 0 **observa** e responde: "o fantasma
   é real?". Pode terminar **sem escrever a Camada-2** — e isso é **sucesso**, não falha.

2. **Precisão > recall.** Um *miss* = status quo (já vaza hoje, não regride). Um *over-match* =
   apaga frase **verdadeira** = dano à **voz do TOM** = **LINHA VERMELHA** (comportamento é sagrado).
   Tudo se inclina pra precisão; vazamento residual é aceitável, apagar verdade não é.

3. **Reusar, não reinventar.** A Camada-2 (se existir) reusa `sanitizeOptimisticConfirm` + o "rabo
   honesto" dos handlers (ex. blocos 9545/9786: "não consegui ativar o silêncio: [razão]"). Plumbing
   nova = mínima.

4. **Aditiva, não substitutiva.** A Camada-1 (gate binário no-marker) está **certa** pro caso dela e
   **não se toca**. A Camada-2 é um predicado **irmão e separado**.

---

## 3. Por que a Camada-1 não pega isto

`enforceNoMarkerHonesty` (optimistic-confirm.js:144) é no-op quando
`!o.nothingPersisted` → como o `TASK_UPDATE` persistiu, `nothingPersisted=false` → a Camada-1 sai
inteira. Ela é **turn-level binária**: "nada persistiu" vs "algo persistiu". A falha **parcial** cai
no vão entre os dois.

---

## 4. A trava obrigatória do revisor (o furo que provei no código)

A versão original da Fase 0 gateava em 3 condições, sendo a 3ª "a reply **contém frase de alegação**
do domínio rejeitado". **Isso é chicken-and-egg:** exige um detector de "frase de alegação" — que é
justamente o que a Fase 0 existe pra descobrir. E o detector que já temos **erra a classe-alvo**:

`_isOptimisticLine` (optimistic-confirm.js:57) testado contra `"fico quieto pro resto da noite"`:
- sem emoji de sucesso (`SUCCESS_EMOJI_RE`) → false;
- não casa `RECUR_RE`;
- `COMPLETION_ANCHORED` é **particípio/passado de conclusão** (`criad|movi|fechei|feito|pronto…`,
  l.27-35) — **"fico" é presente/estado**, não casa;
- sem totalizador (`TOTALIZER_RE`); não casa `PLANNING_CLAIM_RE`.
- → **`false`.** O `hasCompletionClaim` (l.134) usa o mesmo léxico → **erra igual**.

O léxico de confab que temos é feito pra **"eu FIZ X"** (conclusão), não pra **"eu FICO quieto"**
(estado/promessa). **Se a Fase 0 gatear nesse detector, ela sub-reporta a própria classe que
investiga → conclui "sem resíduo" → fecha a Camada-2 por engano.** Pior resultado possível: a
ferramenta de prova dá falso-negativo.

**Fix (incorporado):** o gate da Fase 0 é **estrutural puro** — não toca em léxico de alegação. Loga
a **reply inteira**; o **olho humano** acha a frase na amostra (que é pequena). O léxico da Fase 1
nasce **das frases observadas**, não de um detector que as pré-filtra (bônus: pega fraseados que
nunca adivinharíamos).

---

## 5. Fase 0 — Observabilidade (faz AGORA)

Objetivo: **provar (ou refutar) que existe resíduo não-recuperável** de confab parcial, sem mexer em
nenhuma reply. Risco de voz/regressão = **zero** (observe-only).

### 5.1 Coleta — no SINK, não nos handlers
No `logMarker` (engine.js:201), por onde **todo** result de marker já passa, acumular
`{ type, result }` num coletor **turn-scoped**. Lê-se o coletor no fim do turno, perto da Camada-1.

- **Por que no sink:** evita editar ~14 handlers (drift + edição em massa). É o ponto único onde a
  info já existe.
- **Requisito de design (pro plano resolver):** o coletor precisa ser **concorrência-safe** — o
  `logMarker` é função module-level; o acúmulo deve estar atado ao **contexto do turno** (o mesmo que
  carrega `_metrics` até o call-site da Camada-1), não a um global solto que dois turnos interleaveem.
  Mecanismo exato (objeto de contexto vs `_metrics.markerResults`) = decisão do plano.

### 5.2 Gate do detector — ESTRUTURAL PURO
Dispara quando, **no mesmo turno**:

> ∃ marker com `result ∈ {rejected, malformed}` de tipo **R**, **E** ∃ marker com
> `result = executed` de tipo **E**, com **R ≠ E**.

- **`R ≠ E` (cross-tipo) é deliberado:** falha parcial **mesmo-tipo** (ex. 3 `TASK`, 1 falha) já é
  coberta pelo `sanitizeOptimisticConfirm('partial')` do próprio handler do TASK → não é a classe
  nova, não loga (evita ruído).
- **`skipped` fica de fora** do gatilho — é não-ação legítima, já tratada (ex. dup do NOTE em 9856).
  Só `rejected`/`malformed` contam.
- **Sem detector de léxico** no gate (a trava da §4). Depende só de `type` + `result`.

### 5.3 O que loga — tabela DESCARTÁVEL, fora do `marker_logs`
**NÃO escreve no `marker_logs`.** A catraca confirmou 2 furos que fariam a observação **falhar calada**
— o mesmo padrão da §4 por outra porta:

- **Furo A — CHECK de `result`:** `marker_logs_result_check`
  (`20260529180000_marker_logs_allow_fallback.sql:6-7`) só aceita
  `('executed','rejected','skipped','redirected','fallback')`. `'observed'` seria **rejeitado pelo
  CHECK** → `[marker_logs] insert err … result=observed` (engine.js:212) → linha perdida → o índice da
  barra de 14 dias (§5.4) conta **zero** → fecha a Camada-2 por engano. Precedente exato: essa
  migration existe porque `result='fallback'` dava o mesmíssimo "linha perdida + erro recorrente".
- **Furo B — auditor varre `marker_type+reason` ignorando `result`:** `evaluate_known_issues()`
  (`20260529150000_tom_known_issues.sql:56`) casa `(marker_type || ' ' || coalesce(reason,'')) ILIKE
  sinal_padrao` em **toda** linha de `marker_logs` (sem filtrar `result`). A observação
  `CONFAB_PARTIAL_OBSERVE` + reason poderia casar um `sinal_padrao` existente → bumpa
  ocorrência/last_seen → ressurge no relatório (cicatriz `AUDIT-REPORT-7D-WINDOW`, agora com mecanismo
  concreto).

**Fix estrutural (mata os dois de uma vez):** a observação vai pra uma **tabela descartável própria**,
`confab_partial_observations`:
- Colunas: `id`, `collaborator_id`, `reply text` (**inteira, sem truncar** — é o que o olho lê),
  `rejected_types text[]`, `executed_types text[]`, `reason text`, `created_at`.
- **console.log** (reply inteira + R + E + razão) permanece, pro tail ao vivo.
- Sidesteppa o Furo A (tabela própria, **sem** CHECK de `result`) e o Furo B **estruturalmente**:
  `evaluate_known_issues` e `checkConversationQuality` leem só `marker_logs`/`conversation_history` →
  uma tabela à parte é **invisível** pra eles. Sem migration de constraint, sem segundo guard frágil.

**Invariante (cicatriz `AUDIT-REPORT-7D-WINDOW`):** a observação **não toca** `marker_logs` nem
qualquer fonte do relatório das 07h. O plano **prova com query** que nem `evaluate_known_issues` nem
`checkConversationQuality` referenciam `confab_partial_observations` (trivial — tabela nova). Contagem
da barra: `SELECT count(*) FROM confab_partial_observations WHERE created_at > now() - interval '14 days'`.

> **Alternativa rejeitada:** ficar no `marker_logs` exigiria migration adicionando `'observed'` ao
> CHECK **+** query provando que `'CONFAB_PARTIAL_OBSERVE '||<reason>` não casa nenhum `sinal_padrao`.
> Dois guards frágeis em vez de um beco estrutural → descartada.

### 5.4 Janela e barra de decisão (PINAR AGORA, antes de codar)
- **Janela:** 14 dias corridos de observação.
- **Barra:** **≥ 1 vazamento não-recuperável genuíno** (confirmado a olho) na janela → constrói a
  Fase 1. **Zero** na janela → fecha a Camada-2 como **"observada, desnecessária"** (a 1ª linha
  `PREFS-DND-ROUTE` bastou). Sem barra pré-acordada, a decisão vira discussão depois.
- **Definição de "vazamento não-recuperável genuíno"** (pro olho julgar consistente): a reply afirma
  a ação de um marker **rejeitado/malformed**, **E** nenhum `sanitize` por-handler cobriu aquela
  frase, **E** a Camada-1 não disparou (algo persistiu). Frase decorativa, pergunta, ou alegação que
  o handler já rebaixou **não** contam.

---

## 6. Gate de decisão (após a Fase 0)

```
contagem de vazamentos genuínos na janela de 14d
   ├─ ≥ 1  → abre Fase 1 (brainstorm próprio: léxico nasce das frases observadas)
   └─ = 0  → fecha "observada, desnecessária"; remove a instrumentação (detector + coletor)
            e DROPA a tabela confab_partial_observations
```

---

## 7. Fase 1 — Léxico por domínio (CONDICIONAL — só se a Fase 0 provar)

**Não especificada em detalhe aqui de propósito (YAGNI):** o léxico **depende das frases que a Fase 0
observar**. Pré-especificar a denylist agora é adivinhar — exatamente o erro da §4. A Fase 1, se
acontecer, terá seu **próprio** brainstorm → spec → plano, alimentado pelos dados. O que o design
**fixa** sobre a Fase 1 é a **forma da máquina**, não o conteúdo:

- **Predicado irmão da Camada-1**, aditivo, roda **depois** dos sanitizes por-handler e do no-op-check
  da Camada-1. Lê `markerResults`.
- **Domain-scoped:** pra cada domínio **D** com marker rejeitado **e nenhum** executado de D, aplica o
  léxico de D pra rebaixar **só as cláusulas de D**. (Domínio agrupa tipos correlatos, ex.
  DND/PREFS = "silêncio"; o agrupamento é detalhe da Fase 1.)
- **Granularidade = cláusula** (sub-linha), pra não apagar "Movi pra amanhã" junto com "fico quieto".
- **Reuso:** `sanitizeOptimisticConfirm` parametrizado por léxico de domínio + "rabo honesto" dos
  blocos 9545/9786. Não reinventa a ação.
- **Precision-first** (§2.2): léxico mirado nas frases **observadas**; tunar pra precisão, aceitar
  miss.
- **NÃO toca** o gate binário da Camada-1.

---

## 8. Escopo / YAGNI — o que este design NÃO inclui

- **Classe (c): confab DEFENSIVA turn-posterior** (LLM fabrica fato circunstancial pra se justificar,
  ex. Rose "você pediu ontem, mandei às 9h" — era há 2min). É **não-determinística** e de **turno
  posterior** → fora do alcance de um pós-processador same-turn. **Nomeada e adiada explicitamente**;
  precisa de item próprio.
- **Rose-scheduling** (agendamento de recado em `COORDINATION_REQUEST`): é **feature** (o motor não
  agenda), não confab. Brainstorm separado.
- **Pré-especificação do léxico da Fase 1:** deferida até os dados da Fase 0 existirem (§7).

---

## 9. Testes

**Fase 0** (puro, sem rede):
- Detector estrutural: dispara em (R rejected, E executed, R≠E); **não** dispara em (mesmo tipo
  partial), (só executed), (só rejected), (rejected + skipped), (R=E).
- Coletor: acumula `{type,result}` por turno com **turnos genuinamente interleaved** — dois turnos
  concorrentes não vazam markers um pro outro. Não basta dois objetos separados: simular a
  intercalação real (turno A loga, turno B loga, turno A lê → só vê os seus).
- Invariante 07h (**query real, não prosa**): a observação escreve **só** em
  `confab_partial_observations` (nunca em `marker_logs`); nenhum caminho do auditor
  (`evaluate_known_issues`, `checkConversationQuality`) referencia essa tabela.

**Fase 1** (se existir): testes do predicado domain-scoped + léxico precision-first — **com casos
reais da Fase 0** (não inventados). Peso de revisão concentra aqui.

---

## 10. Riscos

| Risco | Mitigação |
|---|---|
| Observação viola CHECK de `marker_logs.result` (Furo A) → linha perdida, conta zero, fecha por engano | Tabela descartável `confab_partial_observations`, **sem** CHECK de `result` (§5.3). |
| Observação varrida por `evaluate_known_issues` ignorando `result` (Furo B) → ressurge no relatório das 07h | Tabela à parte, invisível ao auditor (lê só `marker_logs`); prova por query (§9). |
| Coletor vaza entre turnos (concorrência) | Coletor atado ao contexto do turno, não global; teste de turnos interleaved reais (§9). |
| Fase 1 over-match apaga verdade (dano à voz) | Precision-first; granularidade cláusula; léxico só das frases observadas; LINHA VERMELHA. |
| Construir Fase 1 sem necessidade | Barra de decisão pinada (§5.4): zero vazamento → fecha, não coda. |

---

## 11. Resumo de uma linha

Observabilidade barata (gate estrutural puro, captura a reply inteira, olho humano acha a frase) por
14 dias responde "o fantasma é real?" **antes** de qualquer cirurgia; só então — e só se sim — nasce
o léxico por domínio, precision-first, reusando o que já existe, sem tocar a Camada-1.
