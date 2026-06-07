# Fatia 6 — Rituais (Diário / Semanal / Fechamento Mensal) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps usam checkbox (`- [ ]`).

**Goal:** Entregar os 3 resumos de ritual SOB DEMANDA no padrão-ouro — **R-DIARIO** ("resumo/balanço do dia"), **R-SEMANA** ("resumo da semana") e **R-MENSAL/fechamento** ("fechamento do mês", "resumo de maio" — mês FECHADO, sem projeção, olha pra trás) — reusando todo o núcleo das Fatias 0-5.

**Architecture:** `report-domain` ganha `weekBounds`; `reports/summaries.js` vira o builder dos 3 (consome `queryPeriodReport`, que já existe da F5 e cobre qualquer janela `[from,to]`); `wa-format` ganha o bloco B13 `dayBalance` + 3 renders. Handlers `query_*` no `engine.js` montam a janela (dia / semana seg–dom / mês fechado), chamam `queryPeriodReport` e renderizam. **Nenhuma query de service nova.** `cid = collab.id` sempre.

**Tech Stack:** Node CommonJS; smokes `scripts/smoke-*.js` rodados via `node D:/la-organizer/_remote/scripts/smoke-<name>.js`. Deploy `scp` + `pm2 restart tom`.

**Escopo (YAGNI):** apenas as versões SOB DEMANDA (núcleo TOM) + docs + gate. **Cron novo de diário/semanal: FORA desta fatia** — decisão adiada da spec ("cron só sobre relatório já validado"); os crons financeiros da Fase B (`checkFinanceBillReminders` 8h, `checkFinanceMonthly` dia 10, `checkFinanceReport` fechamento) continuam intactos e cobrem a proatividade hoje. Migrar esses crons pro padrão-ouro = follow-up pós-validação. PWA: nenhum (rituais são canal WhatsApp).

---

## Distinção crítica de NLU (spec §4)
- **R-MES** = `query_month_analysis` (F4): mês CORRENTE, COM projeção, olha pra FRENTE. Gatilhos: "resumo do mês", "analisa minhas contas".
- **R-MENSAL** = `query_monthly_closing` (F6): mês FECHADO, SEM projeção, olha pra TRÁS. Gatilhos: "fechamento do mês", "resumo de maio", "como fechou abril".
- **R-DIARIO** = `query_daily_summary`: hoje. "resumo do dia", "balanço do dia".
- **R-SEMANA** = `query_weekly_summary`: semana corrente (seg→hoje). "resumo da semana".

## Convenções (verificadas)
`queryPeriodReport(cid, from, to)` → `{ from, to, days, receitas, despesas, byCategory:[{slug,total,count}], count }` (inclusive, exclui `is_adjustment`). `monthBounds(ref)` → `{start:'YYYY-MM-01', end:'YYYY-MM-01'(+1)}`. `shiftDays(ymd,n)` (F5) e `calcVariation`/`classifyExpenseType`/`buildQuickActions` (F4) existem. wa-format já tem `header/assemble/rankingTopN/analysisByType/comparison(c,labels)/goalsBlock/tomTip/quickActions/money`.

---

## File Structure

| Arquivo | Responsabilidade | Ação |
|---|---|---|
| `src/finance/report-domain.js` | `weekBounds(date)` (seg→dom) | Modificar |
| `src/finance/wa-format/index.js` | B13 `dayBalance` + `renderDailySummary`/`renderWeeklySummary`/`renderMonthlyClosing` | Modificar |
| `src/finance/reports/summaries.js` | `buildDailySummary`/`buildWeeklySummary`/`buildMonthlyClosing` | Criar |
| `src/engine.js` | 3 handlers + `FINANCE_ACTIONS` | Modificar |
| `skills/financeiro-pessoal.md` | docs + distinção R-MES×R-MENSAL | Modificar |
| `src/prompts/finance-gate.js` | termos (resumo do dia/semana, fechamento, balanço) | Modificar |
| `scripts/smoke-report-domain-week.js` | smoke `weekBounds` | Criar |
| `scripts/smoke-wa-format-f6.js` | smoke B13 + 3 renders | Criar |
| `scripts/smoke-reports-summaries.js` | smoke 3 builders | Criar |

T1 (domain), T2 (wa-format), T3 (summaries), T5 (skill+gate) tocam arquivos disjuntos → paralelos. T4 (engine) depende de T1-T3.

---

### Task 1: `weekBounds` em report-domain

**Files:** Modify `src/finance/report-domain.js`; Test `scripts/smoke-report-domain-week.js`

- [ ] **Step 1: smoke (falha)** — criar `scripts/smoke-report-domain-week.js`:

```js
'use strict';
const assert = require('assert');
const { weekBounds } = require('D:/la-organizer/_remote/src/finance/report-domain');

// 2024-01-01 é segunda-feira (âncora conhecida)
assert.deepStrictEqual(weekBounds('2024-01-01'), { start: '2024-01-01', end: '2024-01-07' }, 'segunda');
assert.deepStrictEqual(weekBounds('2024-01-03'), { start: '2024-01-01', end: '2024-01-07' }, 'quarta cai na mesma semana');
assert.deepStrictEqual(weekBounds('2024-01-07'), { start: '2024-01-01', end: '2024-01-07' }, 'domingo é o fim');
assert.deepStrictEqual(weekBounds('2024-01-08'), { start: '2024-01-08', end: '2024-01-14' }, 'próxima segunda vira nova semana');
console.log('OK smoke-report-domain-week');
```

Run: `node D:/la-organizer/_remote/scripts/smoke-report-domain-week.js` → FAIL (`weekBounds is not a function`).

- [ ] **Step 2: implementar** — adicionar a `report-domain.js` e incluir no `module.exports` existente:

```js
// Semana segunda→domingo. Aceita 'YYYY-MM-DD' ou Date. Devolve {start, end} em 'YYYY-MM-DD'.
function weekBounds(date) {
  const base = typeof date === 'string' ? date : new Date(date).toISOString().slice(0, 10);
  const d = new Date(`${base}T12:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7; // 0=segunda ... 6=domingo
  const start = new Date(d.getTime() - dow * 86400000).toISOString().slice(0, 10);
  const end = new Date(d.getTime() + (6 - dow) * 86400000).toISOString().slice(0, 10);
  return { start, end };
}
```

- [ ] **Step 3: rodar (passa)** — `node D:/la-organizer/_remote/scripts/smoke-report-domain-week.js` → `OK smoke-report-domain-week`. Depois `node --check D:/la-organizer/_remote/src/finance/report-domain.js`.

---

### Task 2: wa-format — B13 `dayBalance` + 3 renders

**Files:** Modify `src/finance/wa-format/index.js`; Test `scripts/smoke-wa-format-f6.js`

Modelos consumidos (produzidos por T3):
- Diário: `{ label, receitas, despesas, resultado, saldoTotal, count, top:[{label,total,pct}], temAtividade }`
- Semanal: `{ label, receitas, despesas, resultado, count, top, porTipo, comparativo:{atual,anterior,variation}|null, temAtividade, acoes }`
- Fechamento: `{ label, receitas, despesas, resultado, count, top, porTipo, comparativo|null, metas:[{name,pct,current,target}], tip, acoes }`

- [ ] **Step 1: smoke (falha)** — criar `scripts/smoke-wa-format-f6.js`:

```js
'use strict';
const assert = require('assert');
const wa = require('D:/la-organizer/_remote/src/finance/wa-format');

// B13 dayBalance
assert.strictEqual(wa.dayBalance(3000, 1719.69, 1280.31),
  '📊 *Balanço*\n🟢 Entrou: R$ 3.000,00\n🔴 Saiu: R$ 1.719,69\n💵 Resultado: *+R$ 1.280,31* 🟢', 'dayBalance positivo');
assert.ok(wa.dayBalance(100, 250, -150).includes('💵 Resultado: *−R$ 150,00* 🔴'), 'dayBalance negativo');

// renderDailySummary
const d = wa.renderDailySummary({ label: 'Balanço de hoje', receitas: 400, despesas: 152.3, resultado: 247.7, saldoTotal: 1958.03, count: 2, top: [{ label: 'Mercado', total: 152.3, pct: 100 }], temAtividade: true });
assert.ok(d.includes('📅 *Balanço de hoje*') && d.includes('📊 *Balanço*') && d.includes('🏆 *Top do dia*') && d.includes('🏦 Saldo total: *R$ 1.958,03*'), 'renderDailySummary');
assert.ok(wa.renderDailySummary({ label: 'Balanço de hoje', receitas: 0, despesas: 0, resultado: 0, saldoTotal: 100, count: 0, top: [], temAtividade: false }).includes('Sem movimentação'), 'diário vazio');

// renderWeeklySummary
const w = wa.renderWeeklySummary({ label: 'Resumo da semana', receitas: 1000, despesas: 600, resultado: 400, count: 8, top: [{ label: 'Mercado', total: 400, pct: 67 }], porTipo: { essenciais: 400, estilo: 200, essPct: 67, estiloPct: 33 }, comparativo: { atual: 600, anterior: 500, variation: { label: '⬆️ +20%' } }, temAtividade: true, acoes: ['meus saldos'] });
assert.ok(w.includes('🗓️ *Resumo da semana*') && w.includes('Esta semana: R$ 600,00') && w.includes('Semana anterior: R$ 500,00') && w.includes('🏷️ *Por tipo*'), 'renderWeeklySummary + labels');
assert.ok(wa.renderWeeklySummary({ label: 'Resumo da semana', receitas: 0, despesas: 0, resultado: 0, count: 0, top: [], porTipo: { essenciais: 0, estilo: 0, essPct: 0, estiloPct: 0 }, comparativo: null, temAtividade: false, acoes: [] }).includes('sem movimentação'), 'semana vazia');

// renderMonthlyClosing
const c = wa.renderMonthlyClosing({ label: 'Fechamento de maio', receitas: 5000, despesas: 5300, resultado: -300, count: 40, top: [{ label: 'Moradia', total: 1500, pct: 28 }], porTipo: { essenciais: 4000, estilo: 1300, essPct: 75, estiloPct: 25 }, comparativo: { atual: 5300, anterior: 4800, variation: { label: '⬆️ +10%' } }, metas: [{ name: 'Viagem', pct: 40, current: 2000, target: 5000 }], tip: 'Fechou no vermelho: gastou mais do que ganhou. Bora ajustar o próximo mês?', acoes: ['resumo do mês'] });
assert.ok(c.includes('📆 *Fechamento de maio*') && c.includes('💵 Resultado: *−R$ 300,00* 🔴') && c.includes('🏆 *Onde foi o dinheiro*') && c.includes('🎯 *Metas*') && c.includes('💡 *Dica do TOM*'), 'renderMonthlyClosing');
assert.ok(!c.includes('Projeção'), 'fechamento NÃO tem projeção'); // distinção vs R-MES

console.log('OK smoke-wa-format-f6');
```

Run: `node D:/la-organizer/_remote/scripts/smoke-wa-format-f6.js` → FAIL.

- [ ] **Step 2: implementar** — adicionar antes do `module.exports` (reusa `money/header/assemble/rankingTopN/analysisByType/comparison/goalsBlock/tomTip/quickActions` já no arquivo):

```js
// B13 — balanço (entrou/saiu/resultado)
function dayBalance(inV, outV, res) {
  const r = Number(res) || 0;
  return `📊 *Balanço*\n🟢 Entrou: ${money(inV)}\n🔴 Saiu: ${money(outV)}\n💵 Resultado: *${r < 0 ? '−' : '+'}${money(Math.abs(r))}* ${r >= 0 ? '🟢' : '🔴'}`;
}

function renderDailySummary(m) {
  if (!m.temAtividade) return `📅 *${m.label}*\nSem movimentação hoje. 😌\n🏦 Saldo total: *${money(m.saldoTotal)}*`;
  return assemble([
    header('📅', m.label),
    dayBalance(m.receitas, m.despesas, m.resultado),
    (m.top && m.top.length) ? `🏆 *Top do dia*\n${rankingTopN(m.top)}` : '',
    `🏦 Saldo total: *${money(m.saldoTotal)}*`,
    quickActions(['quanto gastei esse mês', 'meus saldos']),
  ]);
}

function renderWeeklySummary(m) {
  if (!m.temAtividade) return `🗓️ *${m.label}*\nSemana sem movimentação. 😌`;
  return assemble([
    header('🗓️', m.label),
    dayBalance(m.receitas, m.despesas, m.resultado),
    (m.top && m.top.length) ? `🏆 *Top gastos*\n${rankingTopN(m.top)}` : '',
    (m.porTipo && (m.porTipo.essenciais || m.porTipo.estilo)) ? analysisByType(m.porTipo) : '',
    m.comparativo ? comparison(m.comparativo, { atual: 'Esta semana', anterior: 'Semana anterior' }) : '',
    quickActions(m.acoes),
  ]);
}

function renderMonthlyClosing(m) {
  return assemble([
    header('📆', m.label),
    dayBalance(m.receitas, m.despesas, m.resultado),
    (m.top && m.top.length) ? `🏆 *Onde foi o dinheiro*\n${rankingTopN(m.top)}` : '',
    (m.porTipo && (m.porTipo.essenciais || m.porTipo.estilo)) ? analysisByType(m.porTipo) : '',
    m.comparativo ? comparison(m.comparativo, { atual: 'Este mês', anterior: 'Mês anterior' }) : '',
    goalsBlock(m.metas),
    m.tip ? tomTip(m.tip) : '',
    quickActions(m.acoes),
  ]);
}
```

Atualizar `module.exports` incluindo `dayBalance, renderDailySummary, renderWeeklySummary, renderMonthlyClosing` (preservar TODOS os exports atuais).

- [ ] **Step 3: rodar (passa)** — smoke → `OK smoke-wa-format-f6`; `node --check`.

---

### Task 3: `reports/summaries.js` — 3 builders

**Files:** Create `src/finance/reports/summaries.js`; Test `scripts/smoke-reports-summaries.js`

- [ ] **Step 1: smoke (falha)** — criar `scripts/smoke-reports-summaries.js`:

```js
'use strict';
const assert = require('assert');
const { buildDailySummary, buildWeeklySummary, buildMonthlyClosing } = require('D:/la-organizer/_remote/src/finance/reports/summaries');

const rep = { from: '2026-06-07', to: '2026-06-07', days: 1, receitas: 400, despesas: 175.8, count: 2, byCategory: [{ slug: 'mercado', total: 152.3, count: 1 }, { slug: 'transporte', total: 23.5, count: 1 }] };

const d = buildDailySummary({ label: 'Balanço de hoje', report: rep, saldoTotal: 1958.03 });
assert.strictEqual(d.resultado, 400 - 175.8, 'resultado dia');
assert.strictEqual(d.saldoTotal, 1958.03);
assert.strictEqual(d.temAtividade, true);
assert.strictEqual(d.top[0].label, 'Mercado', 'top via CAT_META');
assert.strictEqual(buildDailySummary({ label: 'x', report: { receitas: 0, despesas: 0, count: 0, byCategory: [] }, saldoTotal: 5 }).temAtividade, false, 'sem atividade');

const w = buildWeeklySummary({ label: 'Resumo da semana', report: { ...rep, days: 7, despesas: 600 }, prev: { despesas: 500 } });
assert.strictEqual(w.resultado, 400 - 600, 'resultado semana');
assert.ok(w.comparativo && w.comparativo.anterior === 500 && typeof w.comparativo.variation.label === 'string', 'comparativo semana');
assert.ok(w.porTipo.essenciais > 0, 'porTipo'); // mercado+transporte são essenciais
assert.ok(Array.isArray(w.acoes), 'acoes');
assert.strictEqual(buildWeeklySummary({ label: 'x', report: { receitas: 0, despesas: 0, count: 0, byCategory: [] }, prev: null }).comparativo, null, 'sem prev');

const cNeg = buildMonthlyClosing({ label: 'Fechamento de maio', report: { receitas: 5000, despesas: 5300, count: 40, byCategory: [{ slug: 'moradia', total: 1500, count: 1 }] }, prev: { despesas: 4800 }, goals: [{ name: 'Viagem', pct: 40 }] });
assert.strictEqual(cNeg.resultado, -300, 'resultado fechamento');
assert.ok(/vermelho/i.test(cNeg.tip), 'tip vermelho quando resultado<0');
assert.deepStrictEqual(cNeg.metas, [{ name: 'Viagem', pct: 40 }], 'metas passthrough');
const cPos = buildMonthlyClosing({ label: 'Fechamento de abril', report: { receitas: 5000, despesas: 4000, count: 30, byCategory: [] }, prev: null, goals: [] });
assert.ok(/azul/i.test(cPos.tip), 'tip azul quando resultado>=0');

console.log('OK smoke-reports-summaries');
```

Run: `node D:/la-organizer/_remote/scripts/smoke-reports-summaries.js` → FAIL.

- [ ] **Step 2: implementar `src/finance/reports/summaries.js`**

```js
'use strict';
const { classifyExpenseType, calcVariation, buildQuickActions } = require('../report-analysis');
const { CAT_META } = require('../../services/finance-format');

function _rank(byCategory, despesas, n) {
  return (byCategory || []).slice().sort((a, b) => b.total - a.total).slice(0, n).map((c) => ({
    slug: c.slug, label: (CAT_META[c.slug] || {}).label || c.slug,
    total: c.total, count: c.count, pct: despesas > 0 ? Math.round((c.total / despesas) * 100) : 0,
  }));
}
function _porTipo(byCategory) {
  let ess = 0, life = 0;
  for (const c of (byCategory || [])) {
    const t = classifyExpenseType(c.slug);
    if (t === 'essential') ess += c.total; else if (t === 'lifestyle') life += c.total;
  }
  const tot = ess + life;
  return { essenciais: ess, estilo: life, essPct: tot > 0 ? Math.round((ess / tot) * 100) : 0, estiloPct: tot > 0 ? Math.round((life / tot) * 100) : 0 };
}

// R-DIARIO — { label, report, saldoTotal }
function buildDailySummary({ label, report, saldoTotal }) {
  const receitas = Number(report.receitas) || 0, despesas = Number(report.despesas) || 0;
  return {
    label, receitas, despesas, resultado: receitas - despesas, saldoTotal: Number(saldoTotal) || 0,
    count: Number(report.count) || 0, top: _rank(report.byCategory, despesas, 3),
    temAtividade: receitas > 0 || despesas > 0,
  };
}

// R-SEMANA — { label, report, prev }
function buildWeeklySummary({ label, report, prev }) {
  const receitas = Number(report.receitas) || 0, despesas = Number(report.despesas) || 0;
  return {
    label, receitas, despesas, resultado: receitas - despesas, count: Number(report.count) || 0,
    top: _rank(report.byCategory, despesas, 5), porTipo: _porTipo(report.byCategory),
    comparativo: prev ? { atual: despesas, anterior: Number(prev.despesas) || 0, variation: calcVariation(despesas, prev.despesas) } : null,
    temAtividade: receitas > 0 || despesas > 0, acoes: buildQuickActions(),
  };
}

// R-MENSAL (fechamento — mês FECHADO, sem projeção) — { label, report, prev, goals }
function buildMonthlyClosing({ label, report, prev, goals = [] }) {
  const receitas = Number(report.receitas) || 0, despesas = Number(report.despesas) || 0;
  const resultado = receitas - despesas;
  const tip = resultado < 0
    ? 'Fechou no vermelho: gastou mais do que ganhou. Bora ajustar o próximo mês?'
    : 'Fechou no azul! Que tal mandar parte do saldo pra uma meta ou reserva?';
  return {
    label, receitas, despesas, resultado, count: Number(report.count) || 0,
    top: _rank(report.byCategory, despesas, 5), porTipo: _porTipo(report.byCategory),
    comparativo: prev ? { atual: despesas, anterior: Number(prev.despesas) || 0, variation: calcVariation(despesas, prev.despesas) } : null,
    metas: goals, tip, acoes: buildQuickActions(),
  };
}

module.exports = { buildDailySummary, buildWeeklySummary, buildMonthlyClosing };
```

- [ ] **Step 3: rodar (passa)** — smoke → `OK smoke-reports-summaries`.

---

### Task 4: Engine — 3 handlers + `FINANCE_ACTIONS`

**Files:** Modify `src/engine.js`

- [ ] **Step 1:** No array `FINANCE_ACTIONS`, acrescentar (após a linha das ações da F5 `'query_period_expenses', 'query_account_detail', 'query_statement',`):

```js
  'query_daily_summary', 'query_weekly_summary', 'query_monthly_closing',
```

- [ ] **Step 2:** Inserir os 3 cases junto aos outros `query_*` (ex.: logo após `case 'query_statement'`):

```js
    case 'query_daily_summary': {
      const { buildDailySummary } = require('./finance/reports/summaries');
      const wa = require('./finance/wa-format');
      const now = new Date();
      const todayStr = now.toISOString().slice(0, 10);
      const day = (params.date && /^\d{4}-\d{2}-\d{2}$/.test(params.date)) ? params.date : todayStr;
      const report = await financeService.queryPeriodReport(cid, day, day);
      const accounts = await financeService.listAccounts(cid);
      const saldoTotal = accounts.reduce((s, a) => s + Number(a.balance || 0), 0);
      const label = day === todayStr ? 'Balanço de hoje' : `Balanço de ${day.slice(8, 10)}/${day.slice(5, 7)}`;
      return wa.renderDailySummary(buildDailySummary({ label, report, saldoTotal }));
    }
    case 'query_weekly_summary': {
      const { buildWeeklySummary } = require('./finance/reports/summaries');
      const { weekBounds, shiftDays } = require('./finance/report-domain');
      const wa = require('./finance/wa-format');
      const now = new Date();
      const todayStr = now.toISOString().slice(0, 10);
      const wb = weekBounds(now);
      const to = todayStr < wb.end ? todayStr : wb.end; // semana corrente até hoje
      const report = await financeService.queryPeriodReport(cid, wb.start, to);
      const prev = await financeService.queryPeriodReport(cid, shiftDays(wb.start, -7), shiftDays(wb.start, -1));
      return wa.renderWeeklySummary(buildWeeklySummary({ label: 'Resumo da semana', report, prev }));
    }
    case 'query_monthly_closing': {
      const { buildMonthlyClosing } = require('./finance/reports/summaries');
      const wa = require('./finance/wa-format');
      const now = new Date();
      let ref;
      if (params.month && /^\d{4}-\d{2}$/.test(params.month)) ref = new Date(`${params.month}-15T12:00:00Z`);
      else ref = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 15)); // default: mês anterior (fechado)
      const mb = financeService.monthBounds(ref);
      const lastDay = new Date(new Date(`${mb.end}T12:00:00Z`).getTime() - 86400000).toISOString().slice(0, 10);
      const report = await financeService.queryPeriodReport(cid, mb.start, lastDay);
      const prevRef = new Date(Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth() - 1, 15));
      const pmb = financeService.monthBounds(prevRef);
      const pLast = new Date(new Date(`${pmb.end}T12:00:00Z`).getTime() - 86400000).toISOString().slice(0, 10);
      const prev = await financeService.queryPeriodReport(cid, pmb.start, pLast);
      const goalsRaw = await financeService.listGoals(cid);
      const goals = goalsRaw.map((g) => ({
        name: g.name, current: Number(g.current_amount) || 0, target: Number(g.target_amount) || 0,
        pct: Number(g.target_amount) > 0 ? Math.round((Number(g.current_amount) / Number(g.target_amount)) * 100) : 0,
      }));
      const label = `Fechamento de ${financeFmt.mesDaComp(mb.start)}`;
      return wa.renderMonthlyClosing(buildMonthlyClosing({ label, report, prev, goals }));
    }
```

- [ ] **Step 3:** `node --check D:/la-organizer/_remote/src/engine.js` → ok.

---

### Task 5: Skill docs + gate

**Files:** Modify `skills/financeiro-pessoal.md`, `src/prompts/finance-gate.js`; Test `scripts/smoke-finance-gate.js`

- [ ] **Step 1: estender smoke do gate (falha)** — adicionar asserts:

```js
for (const msg of ['resumo do dia', 'balanço do dia', 'resumo da semana', 'fechamento do mês', 'resumo de maio', 'como fechou abril']) assert.ok(financeGateMatches(msg), `gate F6: ${msg}`);
```

Run gate smoke → FAIL.

- [ ] **Step 2: ampliar `FINANCE_RE`** — cobrir `resumo (do|da) (dia|semana|m[êe]s)`, `balan[çc]o do dia`, `fechamento`, `como fechou`, `resumo de <mês>`. LER o arquivo primeiro e reaproveitar o estilo. Rodar até PASS. NÃO quebrar no-matches existentes.

- [ ] **Step 3: documentar na skill** — adicionar subseção (mesmo estilo):

```markdown
### query_daily_summary — balanço do dia (R-DIARIO)
Gatilhos: "resumo do dia", "balanço do dia". Params: `{ date?: "YYYY-MM-DD" }` (default hoje). Mostra: entrou/saiu/resultado, top do dia, saldo total.

### query_weekly_summary — resumo da semana (R-SEMANA)
Gatilhos: "resumo da semana". Sem params (semana corrente seg→hoje). Mostra: balanço, top 5, essencial×estilo, comparativo vs semana anterior.

### query_monthly_closing — fechamento mensal (R-MENSAL)
Gatilhos: "fechamento do mês", "resumo de maio", "como fechou abril". Params: `{ month?: "YYYY-MM" }` (default mês anterior FECHADO). Mostra: balanço do mês, onde foi o dinheiro, essencial×estilo, comparativo, metas, Dica do TOM. SEM projeção.

**Distinção obrigatória R-MES × R-MENSAL:**
- `query_month_analysis` = mês CORRENTE, COM projeção, olha pra FRENTE ("resumo do mês", "analisa minhas contas").
- `query_monthly_closing` = mês FECHADO, SEM projeção, olha pra TRÁS ("fechamento", "resumo de maio", "como fechou X").
- Na dúvida entre os dois: se o usuário cita um mês passado pelo nome → closing; se fala do mês atual/futuro → month_analysis.
```

- [ ] **Step 4:** `node --check D:/la-organizer/_remote/src/prompts/finance-gate.js` → ok.

---

### Task 6: Deploy + smoke real-data + registro (CONTROLADOR)

- [ ] **Step 1:** rodar todos os smokes F6 (`smoke-report-domain-week`, `smoke-wa-format-f6`, `smoke-reports-summaries`, `smoke-finance-gate`) → todos `OK`/`PASS`.
- [ ] **Step 2:** `node --check` em `report-domain.js`, `wa-format/index.js`, `reports/summaries.js`, `engine.js`, `finance-gate.js`.
- [ ] **Step 3:** deploy `scp` dos 5 arquivos de código + skill, `pm2 restart tom`, md5 local==vps.
- [ ] **Step 4:** smoke real-data via MCP (Matheus): `query_daily_summary` (hoje 2026-06-07), `query_weekly_summary` (semana 06-01..06-07), `query_monthly_closing` (maio = 0, junho fechado se aplicável) — conferir números vs `queryPeriodReport`.
- [ ] **Step 5:** registrar bug em `tom_known_issues` se houver; senão anotar entrega.

---

## Self-Review (preenchido)

**Cobertura spec §7 F6:** `weekBounds` ✅ (T1); `buildDailySummary`/`buildWeeklySummary`/`buildMonthlyClosing` ✅ (T3, puro reuso de `queryPeriodReport`); B13 `dayBalance` ✅ (T2); handlers sob demanda ✅ (T4). Crons diário/semanal: **adiado** (decisão da spec — cron só após validado; crons da Fase B intactos). Distinção R-MES×R-MENSAL documentada (T5).

**Placeholders:** nenhum.

**Consistência de tipos:** modelos de T3 batem com renders de T2 (campos `top`/`porTipo`/`comparativo`/`metas`/`temAtividade`); `comparison(c, labels)` usa a assinatura estendida na F5; `rankingTopN`/`analysisByType`/`goalsBlock`/`tomTip` reusados sem mudança. `queryPeriodReport` (F5) já entrega `{receitas,despesas,byCategory,count}` — sem query nova.

**Tense-correctness:** `buildMonthlyClosing` emite dica no passado ("Fechou no vermelho/azul"), nunca a frase forward-looking do `buildTomTip` — correto para mês encerrado.
