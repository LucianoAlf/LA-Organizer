# Fatia 5 — Gastos + Conta + Extrato — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Entregar os 3 relatórios sob demanda da Fatia 5 no TOM — **R-GASTOS** (gastos do período, "quanto gastei"), **R-CONTA** (painel de uma carteira, "saldo do nubank") e **R-EXTRATO** (lançamentos cronológicos por conta) — reusando o núcleo puro (finance-domain → reports → wa-format) já estabelecido nas Fatias 0-4.

**Architecture:** Camadas puras de cima p/ baixo: `report-analysis`/`report-domain` (regras) → `reports/*` builders (ReportModel, sem I/O) → `wa-format` (string). Consumidor TOM = handlers `query_*` no `engine.js` que carregam dados via `financeiro-service.js` (sempre `cid = collab.id`, `.eq('collaborator_id', cid)`), montam o model e renderizam. Service ganha 1 query nova (`queryPeriodReport`) + extensão de `queryTransactions` (filtros account_id/card_id/dateFrom/dateTo). Nenhuma camada pura toca banco.

**Tech Stack:** Node CommonJS; Supabase JS (`supabase.from('pf_transactions')`); smokes `scripts/smoke-*.js` com `const assert = require('assert')` rodados via `node D:/la-organizer/_remote/scripts/smoke-<name>.js`. Deploy: `scp` p/ `tom:/opt/LA-Organizer/...` + `pm2 restart tom`.

**Escopo desta fatia (YAGNI):** núcleo TOM dos 3 relatórios + docs da skill + gate de NLU. **Paridade PWA** (`CarteiraDetalhePage`/`TransacoesPage` consumindo os mesmos builders) fica como follow-up curto pós-E2E, consistente com F3/F4 — não silenciada, explicitamente adiada.

---

## Convenções de dados (verificadas no schema real)

`pf_transactions`: `type` ('income'|'expense'), `category` (slug), `amount` (numeric), `description` (text|null), `transaction_date` ('YYYY-MM-DD'), `account_id` (uuid|null), `card_id` (uuid|null), `via` (text), `is_adjustment` (bool). Datas comparadas como string ISO (`>=`, `<=`, `<`) — ordenação lexicográfica = cronológica.

`money(v)` → `'R$ 1.234,56'` (R$ + espaço; negativo = sinal após R$). `mesDaComp('2026-04-01')` → `'abril'`. `monthBounds(ref)` → `{ start:'YYYY-MM-01', end:'YYYY-MM-01'(mês+1) }` (end exclusivo). `CAT_META[slug]` → `{ emoji, label }`.

---

## File Structure

| Arquivo | Responsabilidade | Ação |
|---|---|---|
| `src/finance/wa-format/index.js` | blocos B14 `recentMovement` + B16 `periodSummary`; `comparison(c,labels?)`; renders `renderPeriodExpenses`/`renderAccountDetail`/`renderStatement`; helpers privados `_ddmm`/`_accStatus`/`_stmtLine` | Modificar |
| `src/finance/report-domain.js` | helper puro `shiftDays(ymd, n)` | Modificar |
| `src/finance/reports/expenses.js` | `buildPeriodExpenses(report, prev)` → ReportModel R-GASTOS | Criar |
| `src/finance/reports/account.js` | `buildAccountDetail(acc, txns, today)` → ReportModel R-CONTA | Criar |
| `src/finance/reports/statement.js` | `buildStatement(acc, rows, opts)` → ReportModel R-EXTRATO | Criar |
| `src/services/financeiro-service.js` | `queryPeriodReport(cid, from, to)`; estender `queryTransactions` | Modificar |
| `src/engine.js` | 3 handlers `query_*` + entradas em `FINANCE_ACTIONS` | Modificar |
| `skills/financeiro-pessoal.md` | docs dos 3 relatórios + distinções de NLU | Modificar |
| `src/prompts/finance-gate.js` | termos de gate (extrato/gastei/saldo) | Modificar |
| `scripts/smoke-wa-format-f5.js` | smoke blocos+renders F5 | Criar |
| `scripts/smoke-reports-expenses.js` | smoke `buildPeriodExpenses` | Criar |
| `scripts/smoke-reports-account.js` | smoke `buildAccountDetail` + `shiftDays` | Criar |
| `scripts/smoke-reports-statement.js` | smoke `buildStatement` | Criar |

Ordem serial (T1→T7) porque T1-T... compartilham `wa-format/index.js` (T1) e o `engine.js` (T6) depende de T1-T5. T2/T3/T4 são arquivos disjuntos mas todos os renders já vivem em `wa-format` (T1), então T1 vem primeiro e fecha o arquivo de formatação.

---

### Task 1: Kit wa-format F5 (blocos B14/B16 + renders)

**Files:**
- Modify: `src/finance/wa-format/index.js`
- Test: `scripts/smoke-wa-format-f5.js`

Modelos consumidos pelos renders (produzidos por T2-T4):
- R-GASTOS: `{ label, total, count, mediaDiaria, top5:[{label,total,pct}], porTipo:{essenciais,estilo,essPct,estiloPct}, comparativo:{atual,anterior,variation:{label}}|null, tip:string|null, acoes:[] }`
- R-CONTA: `{ name, icon, balance, status, movement:{ lastIn:{desc,amount,date}|null, lastOut:{...}|null, var7d:{in,out,net} } }`
- R-EXTRATO: `{ name|null, icon|null, label, items:[{type,amount,date,desc,emoji,source}], count, shown, hasMore, totalIn, totalOut }`

- [ ] **Step 1: Escrever o smoke (falha)**

Criar `scripts/smoke-wa-format-f5.js`:

```js
'use strict';
const assert = require('assert');
const wa = require('D:/la-organizer/_remote/src/finance/wa-format');

// B16 periodSummary
const ps = wa.periodSummary({ label: 'Gastos de abril', total: 1234.56, count: 32, mediaDiaria: 41.15 });
assert.strictEqual(ps, '📊 *Gastos de abril* — *R$ 1.234,56*\n_32 lançamentos · R$ 41,15/dia_', 'periodSummary');
assert.ok(wa.periodSummary({ label: 'X', total: 10, count: 1, mediaDiaria: 10 }).includes('1 lançamento ·'), 'singular');

// B14 recentMovement
const rm = wa.recentMovement({
  lastIn: { desc: 'Salário', amount: 3000, date: '2026-06-05' },
  lastOut: { desc: 'Mercado', amount: 152.3, date: '2026-06-06' },
  var7d: { in: 3000, out: 152.3, net: 2847.7 },
});
assert.strictEqual(rm,
  '🔄 *Movimentação recente*\n🟢 Entrou: Salário +R$ 3.000,00 _(05/06)_\n🔴 Saiu: Mercado −R$ 152,30 _(06/06)_\n📈 7 dias: +R$ 2.847,70',
  'recentMovement cheio');
const rmNeg = wa.recentMovement({ lastIn: null, lastOut: null, var7d: { in: 0, out: 50, net: -50 } });
assert.ok(rmNeg.includes('Sem movimentação'), 'recentMovement vazio');
assert.ok(rmNeg.includes('📈 7 dias: −R$ 50,00'), 'net negativo');

// comparison com labels custom (retrocompat)
assert.ok(wa.comparison({ atual: 1, anterior: 2, variation: { label: '⬇️ -50%' } }).includes('Este mês'), 'comparison default');
assert.ok(wa.comparison({ atual: 1, anterior: 2, variation: { label: '⬇️ -50%' } }, { atual: 'Neste período', anterior: 'Período anterior' }).includes('Neste período'), 'comparison labels');

// renderPeriodExpenses
const rpe = wa.renderPeriodExpenses({
  label: 'Gastos de junho', total: 500, count: 4, mediaDiaria: 71.4,
  top5: [{ label: 'Mercado', total: 300, pct: 60 }, { label: 'Lazer', total: 200, pct: 40 }],
  porTipo: { essenciais: 300, estilo: 200, essPct: 60, estiloPct: 40 },
  comparativo: { atual: 500, anterior: 400, variation: { label: '⬆️ +25%' } },
  tip: 'Mercado puxou 60% do mês.', acoes: ['meus saldos'],
});
assert.ok(rpe.includes('📊 *Gastos de junho*') && rpe.includes('🥇 Mercado') && rpe.includes('🏷️ *Por tipo*') && rpe.includes('Variação: ⬆️ +25%') && rpe.includes('💡 *Dica do TOM*'), 'renderPeriodExpenses');
assert.ok(wa.renderPeriodExpenses({ label: 'Gastos de maio', total: 0, count: 0, mediaDiaria: 0, top5: [], porTipo: { essenciais: 0, estilo: 0, essPct: 0, estiloPct: 0 }, comparativo: null, tip: null, acoes: [] }).includes('Nenhum gasto'), 'gastos empty-state');

// renderAccountDetail
const rad = wa.renderAccountDetail({
  name: 'Nubank', icon: '💜', balance: 1958.04, status: '✅',
  movement: { lastIn: { desc: 'Salário', amount: 3000, date: '2026-06-05' }, lastOut: { desc: 'Mercado', amount: 152.3, date: '2026-06-06' }, var7d: { in: 3000, out: 152.3, net: 2847.7 } },
});
assert.ok(rad.includes('💜 *Nubank*') && rad.includes('Saldo atual: *R$ 1.958,04* ✅') && rad.includes('🔄 *Movimentação recente*') && rad.includes('⚡'), 'renderAccountDetail');

// renderStatement
const rs = wa.renderStatement({
  name: 'Nubank', icon: '💜', label: 'Extrato de junho',
  items: [
    { type: 'expense', amount: 152.3, date: '2026-06-06', desc: 'Mercado', emoji: '🛒', source: '' },
    { type: 'income', amount: 3000, date: '2026-06-05', desc: 'Salário', emoji: '💰', source: '' },
  ],
  count: 2, shown: 2, hasMore: false, totalIn: 3000, totalOut: 152.3,
});
assert.ok(rs.includes('💜 *Extrato de junho · Nubank*') && rs.includes('06/06 🛒 Mercado *−R$ 152,30*') && rs.includes('🟢 Entradas: R$ 3.000,00') && rs.includes('🔴 Saídas: R$ 152,30'), 'renderStatement');
const rsMore = wa.renderStatement({ name: null, icon: null, label: 'Extrato', items: [{ type: 'expense', amount: 10, date: '2026-06-01', desc: 'X', emoji: '📦', source: 'Itaú' }], count: 14, shown: 1, hasMore: true, totalIn: 0, totalOut: 10 });
assert.ok(rsMore.includes('+13 lançamentos') && rsMore.includes('_·Itaú_'), 'statement hasMore + source por linha');
assert.ok(wa.renderStatement({ name: 'Nubank', icon: '💜', label: 'Extrato', items: [], count: 0, shown: 0, hasMore: false, totalIn: 0, totalOut: 0 }).includes('Nenhum lançamento'), 'statement empty');

console.log('OK smoke-wa-format-f5');
```

- [ ] **Step 2: Rodar o smoke (deve falhar)**

Run: `node D:/la-organizer/_remote/scripts/smoke-wa-format-f5.js`
Expected: FAIL — `wa.periodSummary is not a function`.

- [ ] **Step 3: Implementar no `wa-format/index.js`**

Adicionar (antes do `module.exports`), helpers e funções:

```js
// ---- F5: data curta + blocos B14/B16 + renders ----
function _ddmm(d) { const s = String(d || ''); return s.length >= 10 ? `${s.slice(8, 10)}/${s.slice(5, 7)}` : s; }
function _accStatus(b) { b = Number(b) || 0; return b < 0 ? '🔴' : (b === 0 ? '🟡' : '✅'); }

// B16 — resumo de período (gastos)
function periodSummary(r) {
  const n = Number(r.count) || 0;
  return `📊 *${r.label}* — *${money(r.total)}*\n_${n} ${n === 1 ? 'lançamento' : 'lançamentos'} · ${money(r.mediaDiaria)}/dia_`;
}

// B14 — movimentação recente (última entrada/saída + variação 7d)
function recentMovement(m) {
  const lines = ['🔄 *Movimentação recente*'];
  if (m && m.lastIn) lines.push(`🟢 Entrou: ${m.lastIn.desc} +${money(m.lastIn.amount)} _(${_ddmm(m.lastIn.date)})_`);
  if (m && m.lastOut) lines.push(`🔴 Saiu: ${m.lastOut.desc} −${money(m.lastOut.amount)} _(${_ddmm(m.lastOut.date)})_`);
  if (!m || (!m.lastIn && !m.lastOut)) lines.push('_Sem movimentação registrada._');
  const net = Number(m && m.var7d && m.var7d.net) || 0;
  lines.push(`📈 7 dias: ${net >= 0 ? '+' : '−'}${money(Math.abs(net))}`);
  return lines.join('\n');
}

function renderPeriodExpenses(m) {
  if (!m.total) return `📊 *${m.label}*\nNenhum gasto nesse período. 🎉`;
  return assemble([
    periodSummary({ label: m.label, total: m.total, count: m.count, mediaDiaria: m.mediaDiaria }),
    (m.top5 && m.top5.length) ? `🏆 *Top gastos*\n${rankingTopN(m.top5)}` : '',
    (m.porTipo && (m.porTipo.essenciais || m.porTipo.estilo)) ? analysisByType(m.porTipo) : '',
    m.comparativo ? comparison(m.comparativo, { atual: 'Neste período', anterior: 'Período anterior' }) : '',
    m.tip ? tomTip(m.tip) : '',
    quickActions(m.acoes),
  ]);
}

function renderAccountDetail(m) {
  return assemble([
    header(m.icon || '🏦', m.name),
    `💼 Saldo atual: *${money(m.balance)}* ${m.status || _accStatus(m.balance)}`,
    recentMovement(m.movement),
    quickActions([`extrato ${String(m.name).toLowerCase()}`, 'meus saldos', 'quanto gastei esse mês']),
  ]);
}

function _stmtLine(it) {
  const sign = it.type === 'income' ? '+' : '−';
  const src = it.source ? ` _·${it.source}_` : '';
  return `${_ddmm(it.date)} ${it.emoji} ${it.desc} *${sign}${money(it.amount)}*${src}`;
}
function renderStatement(m) {
  const titulo = `${m.label}${m.name ? ` · ${m.name}` : ''}`;
  if (!m.items || !m.items.length) return `${m.icon || '🧾'} *${titulo}*\nNenhum lançamento nesse período.`;
  const lines = m.items.map(_stmtLine).join('\n');
  const more = m.hasMore ? `\n_+${m.count - m.shown} lançamentos — diga "completo" pra ver todos_` : '';
  return assemble([
    header(m.icon || '🧾', titulo, `${m.count} ${m.count === 1 ? 'lançamento' : 'lançamentos'}`),
    lines + more,
    `🟢 Entradas: ${money(m.totalIn)}\n🔴 Saídas: ${money(m.totalOut)}`,
    quickActions(['quanto gastei esse mês', 'meus saldos']),
  ]);
}
```

Substituir a função `comparison` existente por esta versão com labels opcionais (retrocompatível):

```js
function comparison(c, labels) {
  const L = labels || { atual: 'Este mês', anterior: 'Mês anterior' };
  return `📈 *Comparativo*\n• ${L.atual}: ${money(c.atual)}\n• ${L.anterior}: ${money(c.anterior)}\n• Variação: ${c.variation.label}`;
}
```

Atualizar o `module.exports` para incluir os novos nomes:

```js
module.exports = { header, sep, totalHighlight, tomTip, quickActions, severityTiers, billItem, assemble, money, SEP, renderFixedBills, renderBillsToPay, balanceLine, positionBlock, renderBalances, renderCheckup, rankingTopN, comparison, goalsBlock, analysisProjection, analysisByType, renderMonthAnalysis, periodSummary, recentMovement, renderPeriodExpenses, renderAccountDetail, renderStatement };
```

- [ ] **Step 4: Rodar o smoke (deve passar)**

Run: `node D:/la-organizer/_remote/scripts/smoke-wa-format-f5.js`
Expected: PASS — `OK smoke-wa-format-f5`.

- [ ] **Step 5: `node --check`**

Run: `node --check D:/la-organizer/_remote/src/finance/wa-format/index.js`
Expected: sem saída (ok).

---

### Task 2: Builder R-GASTOS (`reports/expenses.js`)

**Files:**
- Create: `src/finance/reports/expenses.js`
- Test: `scripts/smoke-reports-expenses.js`

`report` (de `queryPeriodReport`): `{ from, to, days, receitas, despesas, byCategory:[{slug,total,count}], count }`. `prev`: `{ despesas }` ou `null`.

- [ ] **Step 1: Escrever o smoke (falha)**

Criar `scripts/smoke-reports-expenses.js`:

```js
'use strict';
const assert = require('assert');
const { buildPeriodExpenses } = require('D:/la-organizer/_remote/src/finance/reports/expenses');

const report = {
  from: '2026-06-01', to: '2026-06-07', days: 7, receitas: 3000, despesas: 500, count: 4,
  byCategory: [
    { slug: 'mercado', total: 300, count: 2 },
    { slug: 'lazer', total: 200, count: 2 },
  ],
  label: 'Gastos de junho',
};
const m = buildPeriodExpenses(report, { despesas: 400 });
assert.strictEqual(m.total, 500, 'total');
assert.strictEqual(m.count, 4, 'count');
assert.ok(Math.abs(m.mediaDiaria - 500 / 7) < 1e-9, 'mediaDiaria = despesas/days');
assert.strictEqual(m.top5[0].label, 'Mercado', 'top label via CAT_META');
assert.strictEqual(m.top5[0].pct, 60, 'pct = total/despesas');
assert.strictEqual(m.porTipo.essenciais, 300, 'mercado = essencial'); // mercado ∈ ESSENTIAL
assert.strictEqual(m.porTipo.estilo, 200, 'lazer = estilo');
assert.strictEqual(m.porTipo.essPct, 60, 'essPct');
assert.ok(m.comparativo && m.comparativo.atual === 500 && m.comparativo.anterior === 400, 'comparativo');
assert.ok(m.comparativo.variation && typeof m.comparativo.variation.label === 'string', 'variation label');
assert.ok(Array.isArray(m.acoes), 'acoes array');

// sem prev → comparativo null
const m2 = buildPeriodExpenses({ ...report, byCategory: [] }, null);
assert.strictEqual(m2.comparativo, null, 'sem prev');
assert.deepStrictEqual(m2.top5, [], 'top5 vazio');

console.log('OK smoke-reports-expenses');
```

- [ ] **Step 2: Rodar (deve falhar)**

Run: `node D:/la-organizer/_remote/scripts/smoke-reports-expenses.js`
Expected: FAIL — `Cannot find module ...expenses`.

- [ ] **Step 3: Implementar `src/finance/reports/expenses.js`**

```js
'use strict';
const { classifyExpenseType, calcVariation, buildTomTip, buildQuickActions } = require('../report-analysis');
const { CAT_META } = require('../../services/finance-format');

// report: { from, to, days, receitas, despesas, byCategory:[{slug,total,count}], count, label? }
// prev:   { despesas } | null
function buildPeriodExpenses(report, prev) {
  const desp = Number(report.despesas) || 0;
  const cats = report.byCategory || [];
  const top5 = cats.slice().sort((a, b) => b.total - a.total).slice(0, 5).map((c) => ({
    slug: c.slug, label: (CAT_META[c.slug] || {}).label || c.slug,
    total: c.total, count: c.count, pct: desp > 0 ? Math.round((c.total / desp) * 100) : 0,
  }));
  let ess = 0, life = 0;
  for (const c of cats) {
    const t = classifyExpenseType(c.slug);
    if (t === 'essential') ess += c.total; else if (t === 'lifestyle') life += c.total;
  }
  const tot = ess + life;
  const porTipo = {
    essenciais: ess, estilo: life,
    essPct: tot > 0 ? Math.round((ess / tot) * 100) : 0,
    estiloPct: tot > 0 ? Math.round((life / tot) * 100) : 0,
  };
  const comparativo = prev ? { atual: desp, anterior: Number(prev.despesas) || 0, variation: calcVariation(desp, prev.despesas) } : null;
  const tip = top5.length ? buildTomTip({ saldoProjetado: 0, overdueCount: 0, topCategoria: top5[0].label, topPct: top5[0].pct }) : null;
  const days = Number(report.days) || 1;
  return {
    label: report.label || `Gastos do período`,
    total: desp, count: Number(report.count) || 0,
    mediaDiaria: days > 0 ? desp / days : desp,
    top5, porTipo, comparativo, tip, acoes: buildQuickActions(),
  };
}

module.exports = { buildPeriodExpenses };
```

> NOTA p/ o implementer: abrir `src/finance/report-analysis.js` e CONFERIR que `buildTomTip` com `{saldoProjetado:0, overdueCount:0, topCategoria, topPct}` retorna a dica de concentração de categoria (topPct) ou uma dica neutra — NÃO uma frase específica de "fecha o mês no azul/vermelho" (isso seria fora de contexto p/ um relatório de período). Se o ramo "saudável" do `buildTomTip` for específico de projeção mensal, retornar `tip: top5[0].pct >= 40 ? buildTomTip(...) : null` (só emite a dica quando há concentração relevante). Documentar a decisão no relatório final.

- [ ] **Step 4: Rodar (deve passar)**

Run: `node D:/la-organizer/_remote/scripts/smoke-reports-expenses.js`
Expected: PASS — `OK smoke-reports-expenses`.

---

### Task 3: Builder R-CONTA (`reports/account.js`) + `shiftDays`

**Files:**
- Modify: `src/finance/report-domain.js` (adicionar `shiftDays`)
- Create: `src/finance/reports/account.js`
- Test: `scripts/smoke-reports-account.js`

`txns`: linhas recentes (desc por data) `{ type, amount, description, category, transaction_date }`. `today`: 'YYYY-MM-DD'.

- [ ] **Step 1: Escrever o smoke (falha)**

Criar `scripts/smoke-reports-account.js`:

```js
'use strict';
const assert = require('assert');
const { shiftDays } = require('D:/la-organizer/_remote/src/finance/report-domain');
const { buildAccountDetail } = require('D:/la-organizer/_remote/src/finance/reports/account');

assert.strictEqual(shiftDays('2026-06-07', -7), '2026-05-31', 'shiftDays cruza mês');
assert.strictEqual(shiftDays('2026-06-07', 0), '2026-06-07', 'shiftDays 0');
assert.strictEqual(shiftDays('2026-03-01', -1), '2026-02-28', 'shiftDays fev');

const acc = { name: 'Nubank', icon: '💜', balance: 1958.04 };
const txns = [
  { type: 'expense', amount: 152.3, description: 'Mercado', category: 'mercado', transaction_date: '2026-06-06' },
  { type: 'income', amount: 3000, description: 'Salário', category: 'salario', transaction_date: '2026-06-05' },
  { type: 'expense', amount: 80, description: 'Uber', category: 'transporte', transaction_date: '2026-05-20' }, // fora da janela 7d
];
const m = buildAccountDetail(acc, txns, '2026-06-07');
assert.strictEqual(m.name, 'Nubank');
assert.strictEqual(m.status, '✅', 'saldo positivo');
assert.strictEqual(m.movement.lastOut.desc, 'Mercado', 'última saída');
assert.strictEqual(m.movement.lastIn.desc, 'Salário', 'última entrada');
assert.strictEqual(m.movement.var7d.in, 3000, '7d in só Salário');
assert.strictEqual(m.movement.var7d.out, 152.3, '7d out só Mercado (Uber fora)');
assert.ok(Math.abs(m.movement.var7d.net - 2847.7) < 1e-9, '7d net');

const vazio = buildAccountDetail({ name: 'Cofre', icon: '🐷', balance: 0 }, [], '2026-06-07');
assert.strictEqual(vazio.status, '🟡', 'saldo zero');
assert.strictEqual(vazio.movement.lastIn, null);
assert.strictEqual(vazio.movement.var7d.net, 0);

console.log('OK smoke-reports-account');
```

- [ ] **Step 2: Rodar (deve falhar)**

Run: `node D:/la-organizer/_remote/scripts/smoke-reports-account.js`
Expected: FAIL — `shiftDays is not a function` (ou módulo account inexistente).

- [ ] **Step 3a: Adicionar `shiftDays` em `src/finance/report-domain.js`**

Adicionar a função e incluí-la no `module.exports` existente:

```js
// Soma n dias (pode ser negativo) a uma data 'YYYY-MM-DD' e devolve 'YYYY-MM-DD'.
function shiftDays(ymd, n) {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + Number(n || 0));
  return d.toISOString().slice(0, 10);
}
```

(no `module.exports`, acrescentar `shiftDays` à lista existente).

- [ ] **Step 3b: Implementar `src/finance/reports/account.js`**

```js
'use strict';
const { shiftDays } = require('../report-domain');
const { CAT_META } = require('../../services/finance-format');

function _status(b) { b = Number(b) || 0; return b < 0 ? '🔴' : (b === 0 ? '🟡' : '✅'); }
function _label(r, fallback) {
  return r.description || (CAT_META[r.category] || {}).label || fallback;
}

// acc: { name, icon, balance }; txns: linhas recentes desc; today: 'YYYY-MM-DD'
function buildAccountDetail(acc, txns, today) {
  const rows = txns || [];
  const lastIn = rows.find((r) => r.type === 'income') || null;
  const lastOut = rows.find((r) => r.type === 'expense') || null;
  const cut = shiftDays(today, -7);
  let in7 = 0, out7 = 0;
  for (const r of rows) {
    if (String(r.transaction_date) < cut) continue;
    const a = Number(r.amount) || 0;
    if (r.type === 'income') in7 += a; else out7 += a;
  }
  return {
    name: acc.name, icon: acc.icon, balance: Number(acc.balance) || 0, status: _status(acc.balance),
    movement: {
      lastIn: lastIn ? { desc: _label(lastIn, 'Entrada'), amount: Number(lastIn.amount) || 0, date: lastIn.transaction_date } : null,
      lastOut: lastOut ? { desc: _label(lastOut, 'Gasto'), amount: Number(lastOut.amount) || 0, date: lastOut.transaction_date } : null,
      var7d: { in: in7, out: out7, net: in7 - out7 },
    },
  };
}

module.exports = { buildAccountDetail };
```

- [ ] **Step 4: Rodar (deve passar)**

Run: `node D:/la-organizer/_remote/scripts/smoke-reports-account.js`
Expected: PASS — `OK smoke-reports-account`.

---

### Task 4: Builder R-EXTRATO (`reports/statement.js`)

**Files:**
- Create: `src/finance/reports/statement.js`
- Test: `scripts/smoke-reports-statement.js`

`rows`: linhas cronológicas (desc) `{ type, amount, description, category, transaction_date, account_id, card_id }`. `opts`: `{ label, limit, sourceMap }`.

- [ ] **Step 1: Escrever o smoke (falha)**

Criar `scripts/smoke-reports-statement.js`:

```js
'use strict';
const assert = require('assert');
const { buildStatement } = require('D:/la-organizer/_remote/src/finance/reports/statement');

const rows = [
  { type: 'expense', amount: 152.3, description: 'Mercado', category: 'mercado', transaction_date: '2026-06-06', account_id: 'a1' },
  { type: 'income', amount: 3000, description: null, category: 'salario', transaction_date: '2026-06-05', account_id: 'a1' },
  { type: 'expense', amount: 40, description: 'Uber', category: 'transporte', transaction_date: '2026-06-04', account_id: 'a2' },
];
const m = buildStatement({ name: 'Nubank', icon: '💜' }, rows, { label: 'Extrato de junho', limit: 12 });
assert.strictEqual(m.name, 'Nubank');
assert.strictEqual(m.count, 3, 'count = total');
assert.strictEqual(m.shown, 3, 'shown');
assert.strictEqual(m.hasMore, false);
assert.strictEqual(m.totalIn, 3000, 'totalIn soma todas');
assert.ok(Math.abs(m.totalOut - 192.3) < 1e-9, 'totalOut soma todas');
assert.strictEqual(m.items[1].desc, 'Salário', 'desc nulo → label da categoria via CAT_META'); // salario → "Salário"
assert.ok(m.items[0].emoji && m.items[0].emoji !== '', 'emoji por categoria');
assert.strictEqual(m.items[0].source, '', 'sem sourceMap → source vazio (conta no header)');

// truncamento + sourceMap (extrato de todas as contas)
const many = Array.from({ length: 14 }, (_, i) => ({ type: 'expense', amount: 10, description: `T${i}`, category: 'mercado', transaction_date: '2026-06-01', account_id: i % 2 ? 'a1' : 'a2' }));
const m2 = buildStatement(null, many, { label: 'Extrato', limit: 12, sourceMap: { a1: 'Nubank', a2: 'Itaú' } });
assert.strictEqual(m2.count, 14);
assert.strictEqual(m2.shown, 12, 'trunca em 12');
assert.strictEqual(m2.hasMore, true);
assert.strictEqual(m2.name, null, 'sem conta');
assert.ok(['Nubank', 'Itaú'].includes(m2.items[0].source), 'source por linha via sourceMap');

console.log('OK smoke-reports-statement');
```

- [ ] **Step 2: Rodar (deve falhar)**

Run: `node D:/la-organizer/_remote/scripts/smoke-reports-statement.js`
Expected: FAIL — módulo inexistente.

- [ ] **Step 3: Implementar `src/finance/reports/statement.js`**

```js
'use strict';
const { CAT_META } = require('../../services/finance-format');

// acc: { name, icon } | null; rows: linhas desc; opts: { label, limit=12, sourceMap? }
function buildStatement(acc, rows, opts = {}) {
  const limit = opts.limit || 12;
  const all = rows || [];
  const shown = all.slice(0, limit);
  let totalIn = 0, totalOut = 0;
  for (const r of all) {
    const a = Number(r.amount) || 0;
    if (r.type === 'income') totalIn += a; else totalOut += a;
  }
  const items = shown.map((r) => {
    const meta = CAT_META[r.category] || {};
    return {
      type: r.type, amount: Number(r.amount) || 0, date: r.transaction_date,
      desc: r.description || meta.label || r.category || 'Lançamento',
      emoji: meta.emoji || '📦',
      source: opts.sourceMap ? (opts.sourceMap[r.account_id] || opts.sourceMap[r.card_id] || '') : '',
    };
  });
  return {
    name: acc ? acc.name : null, icon: acc ? acc.icon : null,
    label: opts.label || 'Extrato',
    items, count: all.length, shown: shown.length, hasMore: all.length > shown.length,
    totalIn, totalOut,
  };
}

module.exports = { buildStatement };
```

- [ ] **Step 4: Rodar (deve passar)**

Run: `node D:/la-organizer/_remote/scripts/smoke-reports-statement.js`
Expected: PASS — `OK smoke-reports-statement`.

---

### Task 5: Service — `queryPeriodReport` + estender `queryTransactions`

**Files:**
- Modify: `src/services/financeiro-service.js`

Segurança (service_role ignora RLS): TODAS as queries filtram `.eq('collaborator_id', collaboratorId)` — já é o padrão do arquivo. Não testar contra banco no subagent; validação real-data é feita pelo controlador (Task 7).

- [ ] **Step 1: Estender `queryTransactions` (linha ~176)**

Substituir a função atual por (adiciona filtros opcionais + colunas account_id/card_id/via + exclui ajustes + ordenação estável; retrocompatível com a chamada existente `{category,type,limit}`):

```js
// Consulta de leitura. Filtros opcionais: category, type, account_id, card_id, dateFrom, dateTo (YYYY-MM-DD).
async function queryTransactions(collaboratorId, { category, type, account_id, card_id, dateFrom, dateTo, limit = 8 } = {}) {
  let q = supabase.from('pf_transactions')
    .select('id, type, category, amount, description, transaction_date, account_id, card_id, via')
    .eq('collaborator_id', collaboratorId)
    .neq('is_adjustment', true)
    .order('transaction_date', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(limit);
  if (category) q = q.eq('category', category);
  if (type) q = q.eq('type', type);
  if (account_id) q = q.eq('account_id', account_id);
  if (card_id) q = q.eq('card_id', card_id);
  if (dateFrom) q = q.gte('transaction_date', dateFrom);
  if (dateTo) q = q.lte('transaction_date', dateTo);
  const { data, error } = await q;
  if (error) throw error;
  return data || [];
}
```

- [ ] **Step 2: Adicionar `queryPeriodReport` (perto de `monthCategoryBreakdown`, ~linha 422)**

```js
// Relatório de período arbitrário [from, to] INCLUSIVE: receitas, despesas, byCategory (total+count), count de gastos, days.
async function queryPeriodReport(collaboratorId, from, to) {
  const { data, error } = await supabase.from('pf_transactions')
    .select('type, category, amount')
    .eq('collaborator_id', collaboratorId)
    .gte('transaction_date', from).lte('transaction_date', to)
    .neq('is_adjustment', true);
  if (error) throw error;
  const rows = data || [];
  let receitas = 0, despesas = 0, count = 0;
  const byCat = {};
  for (const r of rows) {
    const amt = Number(r.amount) || 0;
    if (r.type === 'income') { receitas += amt; continue; }
    despesas += amt; count += 1;
    const k = r.category || 'outros';
    if (!byCat[k]) byCat[k] = { total: 0, count: 0 };
    byCat[k].total += amt; byCat[k].count += 1;
  }
  const byCategory = Object.entries(byCat).map(([slug, v]) => ({ slug, total: v.total, count: v.count }));
  const days = Math.max(1, Math.round((new Date(`${to}T12:00:00Z`) - new Date(`${from}T12:00:00Z`)) / 86400000) + 1);
  return { from, to, days, receitas, despesas, byCategory, count };
}
```

- [ ] **Step 3: Exportar `queryPeriodReport` no `module.exports` (linha ~614)**

Acrescentar `queryPeriodReport` à lista de exports (mantendo `queryTransactions`, que continua exportada).

- [ ] **Step 4: `node --check`**

Run: `node --check D:/la-organizer/_remote/src/services/financeiro-service.js`
Expected: sem saída (ok).

---

### Task 6: Engine — 3 handlers + `FINANCE_ACTIONS`

**Files:**
- Modify: `src/engine.js`

- [ ] **Step 1: Adicionar as 3 ações em `FINANCE_ACTIONS` (linha ~6126)**

Trocar a linha `'edit_transaction', 'delete_transaction', 'query_transactions',` por:

```js
  'edit_transaction', 'delete_transaction', 'query_transactions',
  'query_period_expenses', 'query_account_detail', 'query_statement',
```

- [ ] **Step 2: Inserir os 3 handlers (junto aos outros `case 'query_*'`, ~após o case `query_bills_to_pay` linha ~6605)**

```js
    case 'query_period_expenses': {
      const { buildPeriodExpenses } = require('./finance/reports/expenses');
      const wa = require('./finance/wa-format');
      const now = new Date();
      const todayStr = now.toISOString().slice(0, 10);
      let from, to, label, prevReport = null;
      if (params.from && params.to) {
        from = params.from; to = params.to; label = 'Gastos do período';
      } else {
        let ref = now;
        if (params.month && /^\d{4}-\d{2}$/.test(params.month)) ref = new Date(`${params.month}-15T12:00:00Z`);
        const mb = financeService.monthBounds(ref);
        const lastDay = new Date(new Date(`${mb.end}T12:00:00Z`).getTime() - 86400000).toISOString().slice(0, 10);
        const isCurrent = ref.getUTCFullYear() === now.getUTCFullYear() && ref.getUTCMonth() === now.getUTCMonth();
        from = mb.start; to = isCurrent ? todayStr : lastDay;
        label = `Gastos de ${financeFmt.mesDaComp(mb.start)}`;
        const prevRef = new Date(Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth() - 1, 15));
        const pmb = financeService.monthBounds(prevRef);
        const pLast = new Date(new Date(`${pmb.end}T12:00:00Z`).getTime() - 86400000).toISOString().slice(0, 10);
        prevReport = await financeService.queryPeriodReport(cid, pmb.start, pLast);
      }
      const report = await financeService.queryPeriodReport(cid, from, to);
      report.label = label;
      return wa.renderPeriodExpenses(buildPeriodExpenses(report, prevReport));
    }
    case 'query_account_detail': {
      const { buildAccountDetail } = require('./finance/reports/account');
      const wa = require('./finance/wa-format');
      const today = new Date().toISOString().slice(0, 10);
      const acc = await financeService.findAccountByName(cid, params.account || params.name || '');
      if (!acc) {
        const accs = await financeService.listAccounts(cid);
        return accs.length
          ? `Não achei essa carteira. Tenho: ${accs.map((a) => a.name).join(', ')}.`
          : 'Você ainda não tem carteiras. Quer criar uma? Ex: _"cria carteira Nubank"_.';
      }
      const txns = await financeService.queryTransactions(cid, { account_id: acc.id, limit: 40 });
      return wa.renderAccountDetail(buildAccountDetail(acc, txns, today));
    }
    case 'query_statement': {
      const { buildStatement } = require('./finance/reports/statement');
      const wa = require('./finance/wa-format');
      const now = new Date();
      const todayStr = now.toISOString().slice(0, 10);
      let from, to, label;
      if (params.from && params.to) { from = params.from; to = params.to; label = 'Extrato'; }
      else {
        let ref = now;
        if (params.month && /^\d{4}-\d{2}$/.test(params.month)) ref = new Date(`${params.month}-15T12:00:00Z`);
        const mb = financeService.monthBounds(ref);
        const lastDay = new Date(new Date(`${mb.end}T12:00:00Z`).getTime() - 86400000).toISOString().slice(0, 10);
        const isCurrent = ref.getUTCFullYear() === now.getUTCFullYear() && ref.getUTCMonth() === now.getUTCMonth();
        from = mb.start; to = isCurrent ? todayStr : lastDay;
        label = `Extrato de ${financeFmt.mesDaComp(mb.start)}`;
      }
      const full = params.full === true || /completo/i.test(String(params.detail || ''));
      let acc = null;
      if (params.account || params.name) acc = await financeService.findAccountByName(cid, params.account || params.name);
      const sourceMap = {};
      if (!acc) {
        for (const a of await financeService.listAccounts(cid)) sourceMap[a.id] = a.name;
        for (const c of await financeService.listCards(cid)) sourceMap[c.id] = c.name;
      }
      const rows = await financeService.queryTransactions(cid, {
        account_id: acc ? acc.id : undefined, dateFrom: from, dateTo: to, limit: 60,
      });
      const model = buildStatement(acc, rows, { label, limit: full ? 60 : 12, sourceMap: acc ? null : sourceMap });
      return wa.renderStatement(model);
    }
```

- [ ] **Step 3: `node --check`**

Run: `node --check D:/la-organizer/_remote/src/engine.js`
Expected: sem saída (ok).

---

### Task 7: Skill docs + gate de NLU

**Files:**
- Modify: `skills/financeiro-pessoal.md`
- Modify: `src/prompts/finance-gate.js`
- Test: `scripts/smoke-finance-gate.js` (já existe — estender)

- [ ] **Step 1: Estender o gate — escrever asserts (falha)**

Em `scripts/smoke-finance-gate.js`, adicionar asserts de que estas frases passam no gate:

```js
for (const msg of [
  'quanto gastei em abril', 'meus gastos do mês', 'onde gasto mais',
  'extrato do nubank', 'lançamentos de maio',
  'saldo do nubank', 'como está o itaú',
]) assert.ok(financeGateMatches(msg), `gate deve pegar: ${msg}`);
```

Run: `node D:/la-organizer/_remote/scripts/smoke-finance-gate.js` → Expected: FAIL em alguma frase nova.

- [ ] **Step 2: Ajustar `FINANCE_RE` em `src/prompts/finance-gate.js`**

Abrir o arquivo, e ampliar a regex/lista de termos para cobrir: `extrato`, `gastei|gasto|gastos`, `lançament`, `saldo`, `quanto tenho`, `como (está|ta) (o|a|meu|minha)`. Reaproveitar o estilo já presente. Rodar o smoke até passar:

Run: `node D:/la-organizer/_remote/scripts/smoke-finance-gate.js` → Expected: PASS.

- [ ] **Step 3: Documentar as 3 ações na skill `financeiro-pessoal.md`**

Adicionar uma subseção (mesmo estilo das outras `query_*`) com gatilhos e a **distinção obrigatória de NLU**:

```markdown
### query_period_expenses — "quanto gastei" / gastos do período (R-GASTOS)
Gatilhos: "quanto gastei", "gastos de abril", "onde gasto mais", "meus gastos do mês".
Params: `{ month?: "YYYY-MM", from?: "YYYY-MM-DD", to?: "YYYY-MM-DD" }`. Sem params = mês corrente até hoje.
Mostra: total + média diária, top 5 categorias (%), essencial×estilo, comparativo vs período anterior, Dica do TOM.

### query_account_detail — painel de UMA carteira (R-CONTA)
Gatilhos: "saldo do nubank", "como está o itaú", "minha carteira nubank".
Params: `{ account: "<nome>" }` (obrigatório). Mostra: saldo + semáforo, última entrada/saída, variação 7 dias.

### query_statement — extrato cronológico (R-EXTRATO)
Gatilhos: "extrato do nubank", "lançamentos de maio", "extrato".
Params: `{ account?: "<nome>", month?/from?/to?, full?: true }`. Sem account = todas as contas (mostra a fonte por linha). Sem janela = mês corrente. Lista cronológica (12 itens, "completo" expande).

**Distinção obrigatória:**
- **query_account_detail** (painel: saldo + saúde da conta) ≠ **query_statement** (lista de lançamentos).
- **query_period_expenses** (agregado por categoria, olha gastos) ≠ **query_statement** (linha a linha).
- "saldo do nubank" → account_detail; "extrato do nubank" → statement; "quanto gastei" → period_expenses.
```

- [ ] **Step 4: `node --check` no gate**

Run: `node --check D:/la-organizer/_remote/src/prompts/finance-gate.js`
Expected: ok.

---

### Task 8: Deploy + smoke real-data + registro (CONTROLADOR)

> Executada pelo controlador (não subagent): tem SSH/SCP/MCP.

- [ ] **Step 1: Rodar todos os smokes locais**

```
node D:/la-organizer/_remote/scripts/smoke-wa-format-f5.js
node D:/la-organizer/_remote/scripts/smoke-reports-expenses.js
node D:/la-organizer/_remote/scripts/smoke-reports-account.js
node D:/la-organizer/_remote/scripts/smoke-reports-statement.js
node D:/la-organizer/_remote/scripts/smoke-finance-gate.js
```
Todos devem imprimir `OK ...`.

- [ ] **Step 2: `node --check` nos arquivos tocados**

`wa-format/index.js`, `report-domain.js`, `reports/expenses.js`, `reports/account.js`, `reports/statement.js`, `financeiro-service.js`, `engine.js`, `finance-gate.js`.

- [ ] **Step 3: Deploy (scp + restart) e md5 local==vps**

```
scp D:/la-organizer/_remote/src/finance/wa-format/index.js tom:/opt/LA-Organizer/src/finance/wa-format/index.js
scp D:/la-organizer/_remote/src/finance/report-domain.js tom:/opt/LA-Organizer/src/finance/report-domain.js
scp D:/la-organizer/_remote/src/finance/reports/expenses.js tom:/opt/LA-Organizer/src/finance/reports/expenses.js
scp D:/la-organizer/_remote/src/finance/reports/account.js tom:/opt/LA-Organizer/src/finance/reports/account.js
scp D:/la-organizer/_remote/src/finance/reports/statement.js tom:/opt/LA-Organizer/src/finance/reports/statement.js
scp D:/la-organizer/_remote/src/services/financeiro-service.js tom:/opt/LA-Organizer/src/services/financeiro-service.js
scp D:/la-organizer/_remote/src/engine.js tom:/opt/LA-Organizer/src/engine.js
scp D:/la-organizer/_remote/src/prompts/finance-gate.js tom:/opt/LA-Organizer/src/prompts/finance-gate.js
scp D:/la-organizer/_remote/skills/financeiro-pessoal.md tom:/opt/LA-Organizer/skills/financeiro-pessoal.md
ssh tom "pm2 restart tom && pm2 logs tom --lines 5 --nostream"
```
Verificar md5 local==vps de cada um.

- [ ] **Step 4: Smoke real-data via MCP (colaborador Matheus)**

Replicar via `execute_sql` os números que `queryPeriodReport(cid, monthStart, hoje)` deve produzir p/ o Matheus (despesas do mês, top categorias) e conferir que batem com o relatório renderizado. Conferir `query_account_detail` numa conta real e `query_statement`.

- [ ] **Step 5: Registrar no `tom_known_issues` se algum bug aparecer; senão, anotar a entrega.**

---

## Self-Review (preenchido)

**Cobertura da spec §7 Fatia 5:** `queryPeriodReport` ✅ (T5); `queryTransactions` estendido ✅ (T5); `accountBalance7dAgo` → substituído por cálculo no builder (`var7d` em T3, YAGNI: sem tabela de histórico de saldo, derivamos das transações da janela); `buildPeriodExpenses` ✅ (T2); `buildAccountDetail` ✅ (T3); extrato com fonte por linha ✅ (T4, `sourceMap`); B14 `recentMovement` ✅, B15 `analysisByType` (já existia, reusado), B16 `periodSummary` ✅ (T1); handlers `query_period_expenses`/`query_account_detail`/`query_statement` ✅ (T6). PWA reuse → adiado explicitamente (follow-up pós-E2E).

**Placeholders:** nenhum — todo passo tem código completo e comando com saída esperada.

**Consistência de tipos:** model de R-GASTOS usa `top5`/`porTipo`/`comparativo` nos mesmos formatos que `rankingTopN`/`analysisByType`/`comparison` aceitam (verificado contra `wa-format/index.js`). `byCategory:[{slug,total,count}]` idêntico ao de `monthCategoryBreakdown`/`buildMonthAnalysis`. `recentMovement` consome `{lastIn,lastOut,var7d}` exatamente como `buildAccountDetail` emite. `buildStatement` emite `{items:[{type,amount,date,desc,emoji,source}],count,shown,hasMore,totalIn,totalOut}` exatamente como `renderStatement` consome.

**Decisão registrada:** comparação em R-GASTOS usa mês-anterior-cheio vs mês-corrente-até-hoje (mesma convenção do F4 `buildMonthAnalysis`), aceitável; para janelas `from/to` arbitrárias não há comparativo (null).
