# Central de Relatórios Financeiros do TOM — Design

**Data:** 2026-06-07
**Status:** aprovado (4 decisões travadas; aguardando review da spec → writing-plans Fatia 0+1)
**Origem:** brainstorming + workflow de design (4 análises paralelas + síntese opus) a partir dos templates-ouro do dono.

> Vision-doc da Central de Relatórios. Cada **Fatia** (§7) vira seu próprio spec/plano. Esta primeira rodada de implementação cobre **Fatia 0 + Fatia 1**.

## Decisões travadas (do dono)
1. **Persona das dicas:** `💡 Dica da Ana Clara` → **`💡 Dica do TOM`** (uma identidade só).
2. **Reuso TOM↔PWA:** **consolidar por fatia** — o PWA passa a importar o núcleo JS único conforme cada relatório é construído; a cópia TS divergente é removida aos poucos.
3. **Fatura de cartão em aberto:** **entra** no relatório "Contas a Pagar" e compõe o total pendente.
4. **Primeira entrega:** **Fatia 0 (fundação) + Fatia 1 (Contas Fixas × A Pagar)**.

## Decisões adiadas (default do design; calibrar na fatia que as toca)
- Limiar do tier 🟠 Importante: **1–7 dias** (calibrar por uso real) — Fatia 3.
- Valor zerado sempre 🟠 (vs rebaixar p/ 🟡 se vence >7d) — Fatia 1/3.
- Colapso de lista longa: top 3 + `_+N, digita 'completo'_` — Fatia 1/3.
- Escopo dos rituais cron na v1 — Fatia 6 (todos começam sob demanda; cron só sobre relatório já validado).
- Taxonomia Essenciais×Estilo de Vida (mapa proposto em §6) — Fatia 4.
- `pagar {conta}` nas Ações Rápidas: `pay_bill` já existe no engine → o comando é válido; confirmar UX na Fatia 1.

---

## 1. Objetivo e princípios

**Objetivo.** Uma Central de Relatórios com **uma única fonte de verdade** para a lógica (queries, agregações, projeções, classificações) e para a **gramática visual**, consumível pelo TOM (WhatsApp via `query_*`) e pelo PWA (hooks/telas). Hoje o relato do TOM é plano (sem semáforos/comparativos) e o PWA tem camada TS paralela (`web/src/lib/financeiro.ts`, `finance-utils.ts`) que **duplica** o Node (`src/finance/*.js`). O design fecha as duas lacunas.

**Princípios (YAGNI + fidelidade):**
1. **Lógica pura ≠ formatação.** Agregação/projeção/classificação nunca emitem string de WhatsApp; formatação nunca consulta banco. Encontram-se só no consumidor.
2. **Uma fonte de verdade** para regras que valem dinheiro (severidade, essencial×estilo, variação, tempo relativo), testadas com `.test.js`. PWA consome a mesma regra.
3. **Fidelidade ao kit** (blocos B01–B17), não invenção de layout.
4. **v1 enxuta e fiel:** poucos relatórios idênticos ao padrão-ouro > muitos meia-boca.
5. **Semântica correta desde a Fatia 1:** "contas fixas" (relação completa, inclui pagas) ≠ "a pagar" (em aberto/vencidas).
6. **Persona resolvida agora:** `Dica do TOM` antes de qualquer relatório em produção (evita retrabalho).
7. **Sem dado inventado:** valor zerado/ausente vira `⚠️ valor não informado` e fica **fora** de totais e projeção.

---

## 2. Arquitetura

Três camadas puras + dois consumidores (dependência só de cima p/ baixo):

```
CONSUMIDORES   TOM: ações query_* (engine.js)   |   PWA: useFinanceReport() + telas
      │                                          │
      ▼ (TOM)                                    ▼ (PWA renderiza JSX do mesmo core)
wa-report-format  (blocos B01–B17, string→string)
      │
      ▼
finance-reports   (builders → ReportModel, objeto agnóstico de canal, sem I/O)
      │
      ▼
finance-domain    PURO: classifyBillSeverity, classifyExpenseType, calcVariation,
                        billRelativeLabel, diasRestantesDoMes, weekBounds
                  QUERIES: financeiro-service.js (Supabase)
```

### 2.1 `finance-reports` (núcleo puro, `src/finance/reports/`)
Builders recebem **dados já carregados** e devolvem **ReportModel** (objeto estruturado, não string/JSX). Cada um com `.test.js`. Não acessa banco. Depende só de `finance-domain`.

| Unidade | Interface | ReportModel |
|---|---|---|
| `buildFixedBills(bills, today)` | **todas** as contas fixas | `{ groups:{pagas,pendentes,vencidas,semValor}, totals, count }` ← **F1** |
| `buildBillsToPay(bills, cardInvoices, today)` | só em aberto + fatura | `{ vencidas, proximos7, restanteMes, totalPendente }` ← **F1** |
| `buildBalances(accounts, cards)` | contas+cartões | `{ accounts:[{name,balance,status}], totalSaldo, limiteDisponivel, totalDisponivel }` |
| `buildCheckup(bills, today, opts)` | contas+hoje | `{ tiers:{urgente,importante,atencao,ok}, totalRelevante, headline }` |
| `buildMonthAnalysis(current, previous, bills, goals)` | 2 meses+bills+metas | `{ saldos, comparativo, ranking, taxonomia, projecao, metas, dica, acoes }` |
| `buildDailySummary(today, yesterday, accounts, cards, bills)` | 2 dias | seções do diário |
| `buildPeriodExpenses(report, comparison)` | agregação | `{ resumo, top5, porTipo, variacoes }` |
| `buildAccountDetail(acc, txns, projection, goals, today)` | 1 conta | painel da conta |

### 2.2 `wa-report-format` (toolkit WhatsApp, `src/finance/wa-format/`)
Funções puras `B01..B17` + `grammar.js` (separadores, hierarquia, moeda, truncamento, `assemble(blocks[])`). **Extrai e exporta** o que já existe em `finance-format.js` (`money`, `bar`, `txnList`, `CAT_META` hoje não são exportados como kit) — reaproveita, não duplica. Recebe pedaços do ReportModel já prontos; não consulta banco nem conhece `finance-reports`.

### 2.3 `finance-domain` (regras puras + queries)
**Regras puras novas** (cada uma `.test.js`):
- `classifyBillSeverity(bill, today, opts)` → `'urgente'|'importante'|'atencao'|'ok'` (§6.1).
- `classifyExpenseType(slug)` → `'essential'|'lifestyle'|'other'`.
- `calcVariation(current, previous)` → `{ delta, pct, label }` (`⬆️+15%`/`⬇️-8%`/`➡️0%`).
- `billRelativeLabel(bill, today)` → `"há 6d"`/`"em 4d"`/`"vence hoje"`.
- `diasRestantesDoMes(date?)`, `weekBounds(date)`.
- `buildTomTip(context)`, `buildQuickActions(context)` (conteúdo da dica/ações; B10/B11 só envelopam).
- **`today` sempre injetado** (parâmetro), nunca `new Date()` interno — testabilidade.

**Queries** (`financeiro-service.js`, estendidas): `queryPeriodReport(cid, from, to)` (L5); `queryTransactions` + `account_id/card_id/dateFrom/dateTo` (L7); `monthComparison(cid)`, `pendingCardInvoices(cid)`, `accountBalance7dAgo(cid, accountId)`.

### 2.4 Fonte única TOM(JS)↔PWA(TS) — **consolidar por fatia**
`finance-domain` (regras puras JS, sem deps de runtime) é a fonte canônica. Conforme cada relatório é construído, o PWA importa a função pura do core (com `.d.ts` fino) e a cópia TS divergente (`deriveBillStatus`, `monthBounds`, …) vira re-export do core. **v1 não** publica pacote npm nem monta pipeline cross-runtime elaborado — só consolida imports e remove cópias, fatia por fatia.

---

## 3. Kit de componentes visuais (B01–B17)

Cada bloco do padrão-ouro = uma função pura em `wa-report-format` (entrada = pedaço do ReportModel, saída = string):

| Bloco | Função | Nota |
|---|---|---|
| B01 Header | `header(emoji, titulo, sub?)` | abre seção; sem `━━━` antes |
| B02 Separador | `sep()`/`sepLight()` | só entre blocos principais |
| B03 Saldo/Posição | `balanceLine(accounts)`/`positionBlock(p)` | semáforo ✅/🟡/🔴 |
| B04 Ranking | `rankingTopN(items, n)` | `🥇🥈🥉 {cat} R${v} ({%})` |
| B05 Barra | `progressBar(pct, w=14)` | `█=round(pct/100*w)` |
| B06 Severidade | `severityTiers(tiers)` | `🔴/🟠/🟡/🟢 *LABEL* ({n})`; overflow `_+N_` |
| B07 Item conta | `billItem(bill, today)` | usa `billRelativeLabel` |
| B08 Projeção | `projectionBlock(p)` | saldo→a pagar→projetado; variante "dias restantes" |
| B09 Metas | `goalsBlock(goals)` | `🎯` após B08 |
| B10 Dica | `tomTip(texto)` | **`💡 *Dica do TOM*`** (renomeado) |
| B11 Ações | `quickActions(cmds)` | máx 4, linha única, `·` |
| B12 Comparativo | `comparison(c)` | `⬆️⬇️➡️ {pct}` vs ontem/mês |
| B13 Balanço | `dayBalance(in,out,res)` | `📊 *BALANÇO* … *+R${res}* 🟢` |
| B14 Movimentação | `recentMovement(m)` | última entrada/saída + var 7d |
| B15 Análise por tipo | `analysisByType(ess,life)` | usa `classifyExpenseType` |
| B16 Resumo período | `periodSummary(r)` | total/nº/média diária |
| B17 Total destaque | `totalHighlight(label,v)` | `💰 *Total {label} R${v}*` |

`assemble(blocks[])` intercala `sep()` entre blocos principais (nunca antes do header, nunca dentro de bloco simples). Moeda `R$10.161`/`R$44,90`; truncamento `_+{n} itens_`; ordem canônica das seções → `grammar.js`.

---

## 4. Catálogo de relatórios

| # | Relatório | Acionamento | Gatilhos | Fatia |
|---|---|---|---|---|
| R-FIXAS | **Contas fixas** (relação completa) | sob demanda | "minhas contas fixas", "todas as contas", "quais contas tenho" | **F1** |
| R-PAGAR | **Contas a pagar** (aberto/vencidas + fatura) | semanal + sob demanda | "contas a pagar", "o que falta pagar", "atrasadas", "em aberto" | **F1** |
| R-SALDOS | Saldos consolidados | sob demanda | "meus saldos", "quanto tenho", "posição atual" | F2 |
| R-CHECKUP | Checkup (severidade) | semanal + sob demanda | "checkup", "tem problema nas contas", "alguma vencida" | F3 |
| R-MES | Análise do mês (com projeção) | mensal + sob demanda | "resumo do mês", "analisa minhas contas" | F4 |
| R-CONTA | Saldo por conta (painel) | sob demanda | "saldo nubank", "como está o itaú" | F5 |
| R-GASTOS | Gastos do período/hoje | sob demanda | "quanto gastei", "gastos de abril", "onde gasto mais" | F5 |
| R-EXTRATO | Extrato por conta | sob demanda | "extrato nubank", "lançamentos de abril" | F5 |
| R-DIARIO | Resumo diário | cron 08h + sob demanda | "resumo do dia", "balanço do dia" | F6 |
| R-SEMANA | Resumo semanal | cron semanal + sob demanda | "resumo da semana" | F6 |
| R-MENSAL | Fechamento mensal | cron 1º dia útil | "fechamento do mês", "resumo de maio" | F6 |

**Distinções críticas no roteamento de intenção (NLU):** R-FIXAS (completa) × R-PAGAR (recorte); R-CONTA (painel) × R-EXTRATO (lista cronológica); R-MES (mês corrente, com projeção, olha p/ frente) × R-MENSAL (mês encerrado, sem projeção, olha p/ trás).

---

## 5. Reuso vs criar

**Reusa como está:** `listAccounts/listCards/cardUsage`, `querySummary/monthlyReport/monthCategoryTotal`, `listActiveBills/billsDueWithin/billsToPay`, `isBillDue/isBillPaidThisCycle/billDueDom`, `listGoals/projection.js/formatMonths`, `money/bar/txnList/CAT_META`.

**Refatorar/estender:** extrair formatters do `finance-format.js` → `wa-report-format` (exportar B01–B17); `queryTransactions` ganha `account_id/card_id/dateFrom/dateTo` (L7); `monthlyReport` ganha % + contagem por categoria; `billsToPaySummary` → `buildBillsToPay` + `severityTiers`; `cardInvoice` → `pendingCardInvoices` (L6); `EDU_TIPS` → `buildTomTip(context)` (L8); cópias TS [WEB] apontam p/ `finance-domain`.

**Criar:** `classifyBillSeverity`, `classifyExpenseType`+mapas, `calcVariation`, `billRelativeLabel`, `diasRestantesDoMes`/`weekBounds`, `queryPeriodReport` (L5), `pendingCardInvoices` (L6), `buildTomTip`/`buildQuickActions`, builders `build*`, blocos B01–B17+`assemble`, handlers `query_*`.

**Bloqueadores de maior impacto:** (1) `queryPeriodReport` → R-DIARIO/SEMANA/GASTOS; (2) `classifyExpenseType`; (3) `billRelativeLabel`+`classifyBillSeverity`; (4) extensão `queryTransactions`; (5) kit de formatação.

---

## 6. Checkup/severidade e educação

### 6.1 `classifyBillSeverity(bill, today, opts)`
| Tier | Condição |
|---|---|
| 🔴 Urgente | vencida (data < hoje) e ≠ pago; **ou** vence hoje e ≠ pago |
| 🟠 Importante | vence em 1–7 dias, valor>0, ≠ pago; **ou** valor zerado/nulo (qualquer prazo) |
| 🟡 Atenção | vence em 8–15 dias e ≠ pago |
| 🟢 OK | pago **ou** vence em >15 dias com valor informado |

Regras: (a) valor zerado promove p/ 🟠 (default; calibrável); (b) valores zerados **nunca** entram no total relevante; (c) `today` injetado.

### 6.2 Educação — **Dica do TOM** (decisão travada)
`tomTip()` emite `💡 *Dica do TOM*`. Conteúdo por `buildTomTip(context)` contextual (categoria dominante, estouro de orçamento, conta vencida, projeção negativa), substituindo as 4 dicas genéricas de comando. Skill `educacao-financeira` continua sendo voz do próprio TOM.

---

## 7. Fatiamento (F0 → F1 → F2 → F3 → F4 → F5 → F6)

### Fatia 0 — Fundação compartilhada *(pré-requisito)*
- `finance-domain`: `classifyBillSeverity`, `billRelativeLabel`, `diasRestantesDoMes` + `.test.js`.
- `wa-report-format`: extrair/exportar blocos base **B01, B02, B06, B07, B11, B17** + `assemble()`; renomear B10 → **Dica do TOM**.
- Consolidação cross-runtime (§2.4): PWA importa status de conta do core; remove cópia TS divergente.

### Fatia 1 — Contas Fixas × A Pagar *(corrige a semântica)* ★
- `finance-reports`: `buildFixedBills` (relação **completa**, grupos ✅pagas/⏳pendentes/🔴vencidas/⚠️sem-valor, totais por grupo) **e** `buildBillsToPay` (vencidas/próx-7/restante + total pendente).
- `finance-service`: `pendingCardInvoices` (fatura entra no "a pagar" — decisão travada).
- **TOM:** handlers `query_fixed_bills` e `query_bills_to_pay` distintos; NLU separa "minhas contas fixas/todas" (fixas) de "a pagar/em aberto/atrasadas" (a pagar). Substitui o `query_bills` atual.
- **PWA:** lista completa vs filtro "a pagar" consumindo os mesmos builders.

### Fatia 2 — Saldos consolidados
`buildBalances` (semáforos + limite + total disponível); B03, B05 finalizados; TOM reescreve `query_accounts` no padrão-ouro; PWA reusa.

### Fatia 3 — Checkup
`buildCheckup` (usa `classifyBillSeverity`); headline + oferta de ajuda; colapso de lista. TOM `query_checkup` + gatilho semanal (só após validado sob demanda); PWA painel de saúde.

### Fatia 4 — Análise do mês
`classifyExpenseType`, `calcVariation`, `buildTomTip` contextual, `buildQuickActions`; `monthComparison` + `monthlyReport` estendido + projeção; `buildMonthAnalysis`; B04,B08,B09,B10,B12. TOM `query_month_analysis` + gatilho mensal; PWA reusa `FinanceCharts.tsx`.

### Fatia 5 — Gastos + Conta + Extrato
`queryPeriodReport` (L5), `queryTransactions` estendido (L7), `accountBalance7dAgo`; `buildPeriodExpenses`, `buildAccountDetail`, extrato com fonte por linha; B14,B15,B16. TOM `query_period_expenses`/`query_account_detail`/`query_statement`; PWA `CarteiraDetalhePage`/`TransacoesPage` reusam.

### Fatia 6 — Rituais cron
`weekBounds`; `buildDailySummary`/`buildWeeklySummary`/`buildMonthlyClosing` (puro reuso); crons (diário 08h, semanal, 1º dia útil) + versões sob demanda. Escopo dos crons a definir (decisão adiada).

---

## 8. Testes
- **Puro (node `.test.js`):** todas as regras de `finance-domain` + builders de `finance-reports` + blocos de `wa-report-format` (saída idêntica ao padrão-ouro em casos fixos).
- **Service:** queries novas/estendidas com `collaborator_id` explícito (segurança service_role).
- **Engine:** `node --check`; smoke por handler `query_*`.
- **PWA:** `tsc --noEmit` + `vite build`; reuso do core sem divergência.
- **Reconciliação:** relatório do TOM e tela do PWA partem do mesmo builder → números idênticos.

## 9. Fora de escopo (v1)
Pacote npm publicado; pipeline cross-runtime elaborado; relatórios além do catálogo; cron ligado antes de validado sob demanda.
