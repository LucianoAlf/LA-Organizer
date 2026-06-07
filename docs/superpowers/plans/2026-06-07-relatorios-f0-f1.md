# Relatórios Financeiros — Fatia 0 + Fatia 1 (backend/TOM) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps usam checkbox (`- [ ]`).
>
> **Convenções deste repo (sobrepõem o default do skill):**
> - **Testes de lógica pura backend = `scripts/smoke-<nome>.js`** com `const assert = require('assert')`, rodados por `node scripts/smoke-<nome>.js`. NÃO existe `.test.js` no backend.
> - **NÃO commitar entre tasks.** Trabalha tudo em `D:\la-organizer\_remote`. Backend sobe por `scp`+`pm2 restart` na task final; web sobe sozinho no Stop hook. (`_remote` não é git repo.)
> - Backend é **CommonJS** (`require`/`module.exports`). Validar com `node --check`.
> - Rodar comandos com **caminho absoluto** (`node /d/la-organizer/_remote/scripts/...`) — o cwd do bash reseta.

**Goal:** Dar ao TOM a fundação de relatórios (regras puras + kit visual dos templates-ouro) e corrigir a semântica "minhas contas fixas" (relação COMPLETA) × "contas a pagar" (em aberto/vencidas + fatura), com a gramática visual dos templates.

**Architecture:** Camadas puras: `report-domain.js` (regras) → `reports/bills.js` (builders → ReportModel) → `wa-format/` (blocos B01–B17 + render). Handlers `query_*` no engine consomem builder→render. Reusa `bills-query.js`, `finance-format.js`, `financeiro-service.js`.

**Tech Stack:** Node CommonJS (TOM engine), Supabase, smoke tests via `node assert`.

**Escopo desta fatia:** F0 (fundação) + F1 lado **backend/TOM**. O lado **PWA** da F1 (tela "todas × a pagar") é o próximo plano.

---

## Estrutura de arquivos

**Criar:**
- `src/finance/report-domain.js` — regras puras: `diasRestantesDoMes`, `billRelativeLabel`, `billDueDeltaDays`, `classifyBillSeverity`.
- `src/finance/reports/bills.js` — builders: `buildFixedBills`, `buildBillsToPay` (→ ReportModel).
- `src/finance/wa-format/index.js` — kit de blocos (`header`,`sep`,`severityTiers`,`billItem`,`quickActions`,`totalHighlight`,`tomTip`,`assemble`) + render (`renderFixedBills`,`renderBillsToPay`).
- `scripts/smoke-report-domain.js`, `scripts/smoke-reports-bills.js`, `scripts/smoke-wa-format.js`.

**Modificar:**
- `src/services/financeiro-service.js` — add `pendingCardInvoices` + export.
- `src/engine.js` — trocar `query_bills` por `query_fixed_bills` + `query_bills_to_pay`; atualizar `FINANCE_ACTIONS`.
- `skills/financeiro-pessoal.md` — trocar a doc de `query_bills` pelas duas ações.

**Reusa (não altera):** `src/finance/bills-query.js` (`isBillPaidThisCycle`, `billDueDom`), `src/services/finance-format.js` (`money`, `SEP`), `financeiro-service.listActiveBills/listCards/cardInvoice/currentCompetencia`.

---

## FASE 0 — Fundação

### Task 1: `report-domain.js` — datas e label relativo
**Files:** Create `src/finance/report-domain.js`; Create `scripts/smoke-report-domain.js`.

- [ ] **Step 1: Escrever o smoke que falha** (`scripts/smoke-report-domain.js`):
```js
const assert = require('assert');
const { diasRestantesDoMes, billDueDeltaDays, billRelativeLabel } = require('../src/finance/report-domain');

// diasRestantesDoMes: dias após hoje até o fim do mês.
assert.strictEqual(diasRestantesDoMes('2026-04-10'), 20, 'abril tem 30 dias → 30-10');
assert.strictEqual(diasRestantesDoMes('2026-02-28'), 0, 'fev/2026 (28 dias)');

// billDueDeltaDays: delta em dias (neg = vencida, 0 = hoje, pos = futuro).
const monthly = { recurrence: 'monthly', due_day: 10 };
assert.strictEqual(billDueDeltaDays(monthly, '2026-04-10'), 0);
assert.strictEqual(billDueDeltaDays(monthly, '2026-04-04'), 6);
assert.strictEqual(billDueDeltaDays(monthly, '2026-04-16'), -6);
const once = { recurrence: 'once', due_date: '2026-04-15' };
assert.strictEqual(billDueDeltaDays(once, '2026-04-10'), 5);

// billRelativeLabel
assert.strictEqual(billRelativeLabel(monthly, '2026-04-10'), 'vence hoje');
assert.strictEqual(billRelativeLabel(monthly, '2026-04-04'), 'em 6d');
assert.strictEqual(billRelativeLabel(monthly, '2026-04-16'), 'há 6d');

console.log('PASS — report-domain datas/label OK.');
```

- [ ] **Step 2: Rodar e falhar** — `node /d/la-organizer/_remote/scripts/smoke-report-domain.js` → FAIL (Cannot find module).

- [ ] **Step 3: Implementar** (`src/finance/report-domain.js`):
```js
'use strict';
// Regras puras de relatório. `today` é SEMPRE injetado ('YYYY-MM-DD'), nunca new Date() interno.
const { isBillPaidThisCycle, billDueDom } = require('./bills-query');

function _ymdMs(s) {
  const [y, m, d] = String(s).split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

// Dias restantes do mês APÓS hoje (último dia do mês − dia de hoje).
function diasRestantesDoMes(today) {
  const [y, m, d] = String(today).split('-').map(Number);
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return Math.max(0, lastDay - d);
}

// Delta em dias entre o vencimento e hoje. Negativo = vencida; 0 = hoje; positivo = futuro.
// Monthly: usa due_day no mês de `today`. Once: usa due_date.
function billDueDeltaDays(bill, today) {
  const todayMs = _ymdMs(today);
  let dueMs;
  if (bill.recurrence === 'once' && bill.due_date) {
    dueMs = _ymdMs(bill.due_date);
  } else {
    const [y, m] = String(today).split('-').map(Number);
    dueMs = Date.UTC(y, m - 1, Number(bill.due_day));
  }
  return Math.round((dueMs - todayMs) / 86400000);
}

function billRelativeLabel(bill, today) {
  const delta = billDueDeltaDays(bill, today);
  if (delta === 0) return 'vence hoje';
  return delta > 0 ? `em ${delta}d` : `há ${-delta}d`;
}

module.exports = { diasRestantesDoMes, billDueDeltaDays, billRelativeLabel, isBillPaidThisCycle, billDueDom };
```

- [ ] **Step 4: Rodar e passar** — `node /d/la-organizer/_remote/scripts/smoke-report-domain.js` → PASS.

---

### Task 2: `report-domain.js` — `classifyBillSeverity`
**Files:** Modify `src/finance/report-domain.js`; Modify `scripts/smoke-report-domain.js`.

- [ ] **Step 1: Acrescentar asserts** ao final de `scripts/smoke-report-domain.js`, ANTES do `console.log` final:
```js
const { classifyBillSeverity } = require('../src/finance/report-domain');
const T = '2026-04-10';
// 🔴 urgente: vencida sem pagar OU vence hoje sem pagar
assert.strictEqual(classifyBillSeverity({ recurrence:'monthly', due_day:5, amount:99, last_paid_at:null }, T), 'urgente');
assert.strictEqual(classifyBillSeverity({ recurrence:'monthly', due_day:10, amount:99, last_paid_at:null }, T), 'urgente');
// 🟠 importante: vence em 1–7d com valor; OU valor zerado (qualquer prazo)
assert.strictEqual(classifyBillSeverity({ recurrence:'monthly', due_day:15, amount:250, last_paid_at:null }, T), 'importante');
assert.strictEqual(classifyBillSeverity({ recurrence:'monthly', due_day:25, amount:0, last_paid_at:null }, T), 'importante');
// 🟡 atenção: vence em 8–15d com valor
assert.strictEqual(classifyBillSeverity({ recurrence:'monthly', due_day:23, amount:100, last_paid_at:null }, T), 'atencao');
// 🟢 ok: paga no ciclo OU vence >15d com valor
assert.strictEqual(classifyBillSeverity({ recurrence:'monthly', due_day:10, amount:99, last_paid_at:'2026-04-03' }, T), 'ok');
assert.strictEqual(classifyBillSeverity({ recurrence:'monthly', due_day:28, amount:100, last_paid_at:null }, T), 'ok');
```

- [ ] **Step 2: Rodar e falhar** — `node /d/la-organizer/_remote/scripts/smoke-report-domain.js` → FAIL (classifyBillSeverity is not a function).

- [ ] **Step 3: Implementar** — adicionar a função em `src/finance/report-domain.js` (antes do `module.exports`) e exportá-la:
```js
// Severidade de uma conta. opts.zeroValueTier permite calibrar (default 'importante').
function classifyBillSeverity(bill, today, opts = {}) {
  const monthStart = String(today).slice(0, 7) + '-01';
  if (isBillPaidThisCycle(bill, monthStart)) return 'ok';
  const hasValue = Number(bill.amount) > 0;
  if (!hasValue) return opts.zeroValueTier || 'importante'; // valor zerado = dado incompleto
  const delta = billDueDeltaDays(bill, today);
  if (delta <= 0) return 'urgente';   // vencida ou vence hoje
  if (delta <= 7) return 'importante';
  if (delta <= 15) return 'atencao';
  return 'ok';
}
```
E trocar a linha de export para:
```js
module.exports = { diasRestantesDoMes, billDueDeltaDays, billRelativeLabel, classifyBillSeverity, isBillPaidThisCycle, billDueDom };
```

- [ ] **Step 4: Rodar e passar** — `node /d/la-organizer/_remote/scripts/smoke-report-domain.js` → PASS.

---

### Task 3: `wa-format/index.js` — kit de blocos
**Files:** Create `src/finance/wa-format/index.js`; Create `scripts/smoke-wa-format.js`.

- [ ] **Step 1: Smoke que falha** (`scripts/smoke-wa-format.js`):
```js
const assert = require('assert');
const wa = require('../src/finance/wa-format');

assert.strictEqual(wa.header('📋', 'Contas a Pagar'), '📋 *Contas a Pagar*');
assert.strictEqual(wa.header('📋', 'Contas', 'abril'), '📋 *Contas* — abril');
assert.strictEqual(wa.totalHighlight('pendente', 1390), '💰 *Total pendente: R$ 1.390,00*');
assert.strictEqual(wa.tomTip('Saldo saudável.'), '💡 *Dica do TOM*\nSaldo saudável.');
assert.strictEqual(wa.quickActions(['resumo do mês', 'extrato']), '⚡ _"resumo do mês"_ · _"extrato"_');

// severityTiers: só mostra tiers não-vazios, com contagem.
const tiers = { urgente: [{ name:'Aluguel' }], importante: [], atencao: [{ name:'Luz' }], ok: [] };
const out = wa.severityTiers(tiers, { urgente:'🔴 *Mais urgentes*', atencao:'🟡 *Atenção*' });
assert.ok(out.includes('🔴 *Mais urgentes* (1)'));
assert.ok(out.includes('🟡 *Atenção* (1)'));
assert.ok(!out.includes('importante'), 'tier vazio não aparece');

// billItem: nome — valor (rel)
assert.strictEqual(
  wa.billItem({ name:'Netflix', amount:57, rel:'há 1d' }),
  '• Netflix — R$ 57,00 _(há 1d)_'
);
// assemble intercala SEP entre blocos não-vazios; ignora vazios.
assert.strictEqual(wa.assemble(['A', '', 'B']), 'A\n━━━━━━━━━━━━━━━\nB');

console.log('PASS — wa-format kit OK.');
```

- [ ] **Step 2: Rodar e falhar** — `node /d/la-organizer/_remote/scripts/smoke-wa-format.js` → FAIL.

- [ ] **Step 3: Implementar** (`src/finance/wa-format/index.js`) — reusa `money`/`SEP` do `finance-format.js`:
```js
'use strict';
// Kit de blocos da gramática visual dos relatórios (templates-ouro). String puro → string.
// Reusa primitivos do finance-format (money, SEP) — não duplica.
const { money, SEP } = require('../../services/finance-format');

function header(emoji, titulo, sub) {
  return `${emoji} *${titulo}*` + (sub ? ` — ${sub}` : '');
}
function sep() { return SEP; }

function totalHighlight(label, v) {
  return `💰 *Total${label ? ' ' + label : ''}: ${money(v)}*`;
}
function tomTip(texto) {
  return `💡 *Dica do TOM*\n${texto}`;
}
function quickActions(cmds) {
  const list = (cmds || []).slice(0, 4).map((c) => `_"${c}"_`).join(' · ');
  return list ? `⚡ ${list}` : '';
}

// tiers: { key: item[] }. labels: { key: 'cabeçalho' }. Só renderiza tiers com itens.
function severityTiers(tiers, labels) {
  const blocks = [];
  for (const key of Object.keys(labels)) {
    const items = (tiers && tiers[key]) || [];
    if (!items.length) continue;
    const head = `${labels[key]} (${items.length})`;
    const lines = items.map((b) => billItem(b)).join('\n');
    blocks.push(`${head}\n${lines}`);
  }
  return blocks.join('\n\n');
}

// item de conta. b: { name, amount, rel?, due_day? }
function billItem(b) {
  const val = money(Number(b.amount) || 0);
  const rel = b.rel ? ` _(${b.rel})_` : (b.due_day != null ? ` _(dia ${b.due_day})_` : '');
  return `• ${b.name} — ${val}${rel}`;
}

// Intercala SEP entre blocos não-vazios.
function assemble(blocks) {
  return (blocks || []).filter((b) => b && String(b).trim()).join(`\n${SEP}\n`);
}

module.exports = { header, sep, totalHighlight, tomTip, quickActions, severityTiers, billItem, assemble, money, SEP };
```

- [ ] **Step 4: Rodar e passar** — `node /d/la-organizer/_remote/scripts/smoke-wa-format.js` → PASS.

---

## FASE 1 — Contas Fixas × A Pagar (backend/TOM)

### Task 4: `reports/bills.js` — `buildFixedBills` (relação COMPLETA)
**Files:** Create `src/finance/reports/bills.js`; Create `scripts/smoke-reports-bills.js`.

- [ ] **Step 1: Smoke que falha** (`scripts/smoke-reports-bills.js`):
```js
const assert = require('assert');
const { buildFixedBills } = require('../src/finance/reports/bills');

const T = '2026-04-10';
const bills = [
  { name:'Aluguel', amount:1500, due_day:10, recurrence:'monthly', type:'expense', last_paid_at:null },
  { name:'Internet', amount:120, due_day:25, recurrence:'monthly', type:'expense', last_paid_at:null },
  { name:'Luz (paga)', amount:200, due_day:10, recurrence:'monthly', type:'expense', last_paid_at:'2026-04-02' },
  { name:'Gás (sem valor)', amount:0, due_day:25, recurrence:'monthly', type:'expense', last_paid_at:null },
  { name:'Salário', amount:5000, due_day:5, recurrence:'monthly', type:'income', last_paid_at:null }, // ignorado (income)
];
const m = buildFixedBills(bills, T);
// COMPLETA: conta todas as despesas (inclui paga e sem valor), exclui income.
assert.strictEqual(m.count, 4);
assert.deepStrictEqual(m.groups.vencidas.map((b)=>b.name), ['Aluguel']);    // vence hoje sem pagar
assert.deepStrictEqual(m.groups.pendentes.map((b)=>b.name), ['Internet']);  // futuro com valor
assert.deepStrictEqual(m.groups.pagas.map((b)=>b.name), ['Luz (paga)']);
assert.deepStrictEqual(m.groups.semValor.map((b)=>b.name), ['Gás (sem valor)']);
assert.strictEqual(m.totals.aPagar, 1620); // pendentes + vencidas (sem valor não soma)

console.log('PASS — buildFixedBills OK.');
```

- [ ] **Step 2: Rodar e falhar** — `node /d/la-organizer/_remote/scripts/smoke-reports-bills.js` → FAIL.

- [ ] **Step 3: Implementar** (`src/finance/reports/bills.js`):
```js
'use strict';
// Builders de relatórios de contas → ReportModel (objeto, agnóstico de canal).
const { isBillPaidThisCycle, billDueDom, billRelativeLabel, billDueDeltaDays, classifyBillSeverity } = require('../report-domain');

function _expenseBills(bills) {
  return (bills || []).filter((b) => (b.type || 'expense') === 'expense');
}
function _item(b, today) {
  return {
    name: b.name,
    amount: Number(b.amount) || 0,
    due_day: billDueDom(b),
    recurrence: b.recurrence || 'monthly',
    rel: billRelativeLabel(b, today),
  };
}
const _byDueDay = (a, b) => (a.due_day || 99) - (b.due_day || 99);
const _sum = (arr) => arr.reduce((s, b) => s + (Number(b.amount) || 0), 0);

// RELAÇÃO COMPLETA: todas as contas fixas (despesa), agrupadas por status.
function buildFixedBills(bills, today) {
  const monthStart = String(today).slice(0, 7) + '-01';
  const groups = { vencidas: [], pendentes: [], pagas: [], semValor: [] };
  for (const b of _expenseBills(bills)) {
    const item = _item(b, today);
    if (isBillPaidThisCycle(b, monthStart)) groups.pagas.push(item);
    else if (!(Number(b.amount) > 0)) groups.semValor.push(item);
    else if (classifyBillSeverity(b, today) === 'urgente') groups.vencidas.push(item);
    else groups.pendentes.push(item);
  }
  for (const k of Object.keys(groups)) groups[k].sort(_byDueDay);
  const totals = {
    vencidas: _sum(groups.vencidas),
    pendentes: _sum(groups.pendentes),
    pagas: _sum(groups.pagas),
    aPagar: _sum(groups.vencidas) + _sum(groups.pendentes),
  };
  return { groups, totals, count: _expenseBills(bills).length };
}

module.exports = { buildFixedBills };
```

- [ ] **Step 4: Rodar e passar** — `node /d/la-organizer/_remote/scripts/smoke-reports-bills.js` → PASS.

---

### Task 5: `reports/bills.js` — `buildBillsToPay` (em aberto + fatura)
**Files:** Modify `src/finance/reports/bills.js`; Modify `scripts/smoke-reports-bills.js`.

- [ ] **Step 1: Acrescentar asserts** ao `scripts/smoke-reports-bills.js` (antes do `console.log`):
```js
const { buildBillsToPay } = require('../src/finance/reports/bills');
const cardInvoices = [{ cardName:'Nubank', remaining:2579, dueDay:22 }];
const p = buildBillsToPay(bills, cardInvoices, T);
assert.deepStrictEqual(p.vencidas.map((b)=>b.name), ['Aluguel']);     // delta <= 0
assert.deepStrictEqual(p.proximos7.map((b)=>b.name), []);             // nada 1–7d
assert.deepStrictEqual(p.restanteMes.map((b)=>b.name), ['Internet','Gás (sem valor)']); // >7d (sem valor entra na listagem, soma 0)
assert.deepStrictEqual(p.cards.map((c)=>c.name), ['Fatura Nubank']);
assert.strictEqual(p.totalPendente, 1500 + 120 + 0 + 2579); // vencidas+pendentes+restante+fatura
// filtro por dia (ex: "o que vence dia 10")
const d10 = buildBillsToPay(bills, [], T, { dueDay: 10 });
assert.deepStrictEqual(d10.filtered.map((b)=>b.name), ['Aluguel']);
assert.strictEqual(d10.totalPendente, 1500);
```

- [ ] **Step 2: Rodar e falhar** — `node /d/la-organizer/_remote/scripts/smoke-reports-bills.js` → FAIL (buildBillsToPay is not a function).

- [ ] **Step 3: Implementar** — adicionar em `src/finance/reports/bills.js` (antes do `module.exports`) e exportar:
```js
// SÓ O QUE FALTA PAGAR: contas em aberto agrupadas por urgência + faturas de cartão.
// opts.dueDay: filtra por um dia ("o que vence dia 10") → devolve { filtered, totalPendente }.
function buildBillsToPay(bills, cardInvoices, today, opts = {}) {
  const monthStart = String(today).slice(0, 7) + '-01';
  const open = _expenseBills(bills).filter((b) => !isBillPaidThisCycle(b, monthStart));

  if (opts.dueDay != null) {
    const filtered = open.filter((b) => billDueDom(b) === Number(opts.dueDay)).map((b) => _item(b, today)).sort(_byDueDay);
    return { filtered, totalPendente: _sum(filtered), dueDay: Number(opts.dueDay) };
  }

  const vencidas = [], proximos7 = [], restanteMes = [];
  for (const b of open) {
    const item = _item(b, today);
    const delta = billDueDeltaDays(b, today);
    if (delta <= 0) vencidas.push(item);
    else if (delta <= 7) proximos7.push(item);
    else restanteMes.push(item);
  }
  vencidas.sort(_byDueDay); proximos7.sort(_byDueDay); restanteMes.sort(_byDueDay);
  const cards = (cardInvoices || []).map((ci) => ({
    name: `Fatura ${ci.cardName}`, amount: Number(ci.remaining) || 0, due_day: ci.dueDay != null ? Number(ci.dueDay) : null, rel: '',
  }));
  const totalPendente = _sum(vencidas) + _sum(proximos7) + _sum(restanteMes) + _sum(cards);
  return { vencidas, proximos7, restanteMes, cards, totalPendente };
}
```
E atualizar o export:
```js
module.exports = { buildFixedBills, buildBillsToPay };
```

- [ ] **Step 4: Rodar e passar** — `node /d/la-organizer/_remote/scripts/smoke-reports-bills.js` → PASS.

---

### Task 6: `wa-format` — render dos dois relatórios
**Files:** Modify `src/finance/wa-format/index.js`; Modify `scripts/smoke-wa-format.js`.

- [ ] **Step 1: Acrescentar asserts** ao `scripts/smoke-wa-format.js` (antes do `console.log`):
```js
const { renderFixedBills, renderBillsToPay } = require('../src/finance/wa-format');
const fixed = {
  groups: {
    vencidas: [{ name:'Aluguel', amount:1500, due_day:10, rel:'há 1d' }],
    pendentes: [{ name:'Internet', amount:120, due_day:25, rel:'em 15d' }],
    pagas: [{ name:'Luz', amount:200, due_day:10 }],
    semValor: [{ name:'Gás', amount:0, due_day:25 }],
  },
  totals: { vencidas:1500, pendentes:120, pagas:200, aPagar:1620 }, count:4,
};
const rf = renderFixedBills(fixed);
assert.ok(rf.startsWith('📋 *Suas Contas Fixas*'));
assert.ok(rf.includes('🔴 *Vencidas* (1)'));
assert.ok(rf.includes('✅ *Pagas* (1)'));
assert.ok(rf.includes('⚠️ *Sem valor* (1)'));
assert.ok(rf.includes('💰 *Total a pagar: R$ 1.620,00*'));

const pay = { vencidas:[{name:'Aluguel',amount:1500,rel:'há 1d'}], proximos7:[], restanteMes:[{name:'Internet',amount:120,rel:'em 15d'}], cards:[{name:'Fatura Nubank',amount:2579}], totalPendente:4199 };
const rp = renderBillsToPay(pay);
assert.ok(rp.startsWith('📋 *Suas Contas a Pagar*'));
assert.ok(rp.includes('🔴 *Vencidas* (1)'));
assert.ok(rp.includes('💳 *Faturas* (1)'));
assert.ok(rp.includes('💰 *Total pendente: R$ 4.199,00*'));
// filtro por dia
const rpDia = renderBillsToPay({ filtered:[{name:'Aluguel',amount:1500,due_day:10}], totalPendente:1500, dueDay:10 });
assert.ok(rpDia.includes('vencem dia 10'));
assert.ok(rpDia.includes('💰 *Total: R$ 1.500,00*'));
// vazio
assert.ok(renderBillsToPay({ vencidas:[],proximos7:[],restanteMes:[],cards:[],totalPendente:0 }).includes('Tá tudo pago'));
```

- [ ] **Step 2: Rodar e falhar** — `node /d/la-organizer/_remote/scripts/smoke-wa-format.js` → FAIL.

- [ ] **Step 3: Implementar** — adicionar em `src/finance/wa-format/index.js` (antes do `module.exports`) e exportar:
```js
const _ACOES_CONTAS = ['minhas contas a pagar', 'quanto gastei esse mês', 'meus saldos'];

function renderFixedBills(model) {
  const g = model.groups;
  const tiers = severityTiers(g, {
    vencidas: '🔴 *Vencidas*', pendentes: '⏳ *Pendentes*', pagas: '✅ *Pagas*', semValor: '⚠️ *Sem valor*',
  });
  const total = totalHighlight('a pagar', model.totals.aPagar);
  return assemble([
    header('📋', 'Suas Contas Fixas', `${model.count} no total`),
    tiers,
    `${total}\n_pagas e sem valor não entram no total_`,
    quickActions(_ACOES_CONTAS),
  ]);
}

function renderBillsToPay(model) {
  // Variante filtrada por dia.
  if (model.dueDay != null) {
    if (!model.filtered.length) return `📅 Nada em aberto vencendo dia ${model.dueDay}. 🎉`;
    const lines = model.filtered.map((b) => billItem(b)).join('\n');
    return assemble([
      header('📅', `Contas que vencem dia ${model.dueDay}`, `${model.filtered.length} ${model.filtered.length === 1 ? 'conta' : 'contas'}`),
      lines,
      totalHighlight('', model.totalPendente),
    ]);
  }
  const nAberto = model.vencidas.length + model.proximos7.length + model.restanteMes.length + model.cards.length;
  if (nAberto === 0) return '📋 *Suas Contas a Pagar*\nTá tudo pago por aqui. 🎉';
  const tiers = severityTiers(
    { vencidas: model.vencidas, proximos7: model.proximos7, restanteMes: model.restanteMes, cards: model.cards },
    { vencidas: '🔴 *Vencidas*', proximos7: '🟡 *Próximos 7 dias*', restanteMes: '🟢 *Restante do mês*', cards: '💳 *Faturas*' },
  );
  return assemble([
    header('📋', 'Suas Contas a Pagar'),
    tiers,
    totalHighlight('pendente', model.totalPendente),
    quickActions(['paguei a conta X', 'minhas contas fixas', 'resumo do mês']),
  ]);
}
```
E atualizar o export final para incluir `renderFixedBills, renderBillsToPay`.

- [ ] **Step 4: Rodar e passar** — `node /d/la-organizer/_remote/scripts/smoke-wa-format.js` → PASS.

---

### Task 7: `financeiro-service.js` — `pendingCardInvoices`
**Files:** Modify `src/services/financeiro-service.js`.

- [ ] **Step 1: Adicionar a função** logo após `listActiveBills` (criada antes):
```js
// Faturas de cartão EM ABERTO (competência corrente, com saldo a pagar) — pra entrar no "a pagar".
async function pendingCardInvoices(collaboratorId) {
  const cards = await listCards(collaboratorId);
  const out = [];
  for (const card of cards) {
    const comp = currentCompetencia(card);
    const inv = await cardInvoice(collaboratorId, card.id, comp);
    if (inv && Number(inv.remaining) > 0 && !inv.isPaid) {
      out.push({ cardName: card.name, remaining: Number(inv.remaining), dueDay: card.due_day });
    }
  }
  return out;
}
```

- [ ] **Step 2: Exportar** — no `module.exports`, adicionar `pendingCardInvoices` junto de `listActiveBills`:
```js
  billsDueWithin, listActiveBills, pendingCardInvoices, monthlyReport, collaboratorsWithActivity, collaboratorsForFinanceRitual,
```

- [ ] **Step 3: Validar** — `node --check /d/la-organizer/_remote/src/services/financeiro-service.js` → sem erro.

---

### Task 8: `engine.js` — handlers `query_fixed_bills` + `query_bills_to_pay`
**Files:** Modify `src/engine.js`.

- [ ] **Step 1: Atualizar `FINANCE_ACTIONS`** — trocar `'query_bills'` por as duas ações:
```js
const FINANCE_ACTIONS = [
  'register_transaction', 'register_bill', 'pay_bill', 'query_fixed_bills', 'query_bills_to_pay', 'create_goal',
```
(remover `'query_bills'` da lista.)

- [ ] **Step 2: Substituir o case `query_bills`** inteiro (o bloco atual que usa `billsToPay`/`billsToPaySummary`) por:
```js
    case 'query_fixed_bills': {
      const { buildFixedBills } = require('./finance/reports/bills');
      const wa = require('./finance/wa-format');
      const today = new Date().toISOString().slice(0, 10);
      const bills = await financeService.listActiveBills(cid);
      return wa.renderFixedBills(buildFixedBills(bills, today));
    }
    case 'query_bills_to_pay': {
      const { buildBillsToPay } = require('./finance/reports/bills');
      const wa = require('./finance/wa-format');
      const today = new Date().toISOString().slice(0, 10);
      const dueDay = params.due_day != null && String(params.due_day).trim() !== '' ? parseInt(params.due_day, 10) : null;
      const bills = await financeService.listActiveBills(cid);
      const cardInvoices = await financeService.pendingCardInvoices(cid).catch(() => []);
      const model = buildBillsToPay(bills, cardInvoices, today, dueDay != null ? { dueDay } : {});
      return wa.renderBillsToPay(model);
    }
```

- [ ] **Step 3: Validar** — `node --check /d/la-organizer/_remote/src/engine.js` → sem erro.

---

### Task 9: `skills/financeiro-pessoal.md` — separar as duas intenções
**Files:** Modify `skills/financeiro-pessoal.md`.

- [ ] **Step 1: Substituir** a linha atual da ação `query_bills` (que começa com ``- `query_bills` — params: due_day(opcional). Lista e SOMA as contas fixas EM ABERTO``) por:
```markdown
- `query_fixed_bills` — sem params. Lista a RELAÇÃO COMPLETA das contas fixas do usuário (todas as cadastradas: pagas, pendentes, vencidas e sem valor), agrupadas. Use quando pedir a lista/relação: "minhas contas fixas", "todas as minhas contas", "quais contas eu tenho cadastradas".
- `query_bills_to_pay` — params: due_day(opcional). Lista e SOMA só o que está EM ABERTO (vencidas + próximos 7 dias + restante do mês + faturas de cartão). Use quando pedir o que falta pagar: "contas a pagar", "o que falta pagar", "contas atrasadas/em aberto", "quanto tenho pra pagar dia 10" (→ due_day=10). 🚨 NUNCA diga que "não tem a lista aqui" nem mande "olhar no app": emita a ação e o engine traz somado.
  - **Distinção obrigatória:** "minhas contas fixas/todas/relação" → `query_fixed_bills` (completa). "a pagar/em aberto/atrasadas/o que falta/dia X" → `query_bills_to_pay` (recorte). São coisas diferentes.
```

- [ ] **Step 2: Conferência** — `grep -n "query_fixed_bills\|query_bills_to_pay\|query_bills" /d/la-organizer/_remote/skills/financeiro-pessoal.md` → só as duas novas aparecem (nenhum `query_bills` solto).

---

### Task 10: Deploy backend + smoke E2E + registro
**Files:** —

- [ ] **Step 1: Rodar todos os smokes** localmente:
```bash
node /d/la-organizer/_remote/scripts/smoke-report-domain.js && node /d/la-organizer/_remote/scripts/smoke-wa-format.js && node /d/la-organizer/_remote/scripts/smoke-reports-bills.js
```
Expected: 3× PASS.

- [ ] **Step 2: `node --check`** nos arquivos novos/modificados:
```bash
for f in src/finance/report-domain.js src/finance/reports/bills.js src/finance/wa-format/index.js src/services/financeiro-service.js src/engine.js; do node --check /d/la-organizer/_remote/$f || echo "FALHOU $f"; done
```
Expected: sem "FALHOU".

- [ ] **Step 3: SCP + restart + md5** (criar os diretórios remotos antes):
```bash
ssh tom "mkdir -p /opt/LA-Organizer/src/finance/reports /opt/LA-Organizer/src/finance/wa-format"
for f in src/finance/report-domain.js src/finance/reports/bills.js src/finance/wa-format/index.js src/services/financeiro-service.js src/engine.js skills/financeiro-pessoal.md scripts/smoke-report-domain.js scripts/smoke-reports-bills.js scripts/smoke-wa-format.js; do scp /d/la-organizer/_remote/$f tom:/opt/LA-Organizer/$f; done
for f in src/engine.js src/finance/reports/bills.js src/finance/wa-format/index.js; do echo "$f: $(md5sum /d/la-organizer/_remote/$f|cut -d' ' -f1) | $(ssh tom "md5sum /opt/LA-Organizer/$f|cut -d' ' -f1")"; done
ssh tom "node /opt/LA-Organizer/scripts/smoke-reports-bills.js && pm2 restart tom >/dev/null 2>&1 && echo RESTART_OK"
```
Expected: md5 iguais (local|vps) nos 3; smoke PASS no VPS; `RESTART_OK`.

- [ ] **Step 4: Smoke E2E real (SQL)** — validar contra dados reais do Matheus que `buildBillsToPay` (dia 10) e `buildFixedBills` (completa) batem: rodar a query de conferência (MCP `execute_sql`, project `cesnbnrynvxvgdhfmaua`) somando as contas dele por status e comparar com o esperado dos relatórios. (Matheus cid via `collaborators WHERE full_name ILIKE '%matheus%'`.)

- [ ] **Step 5: Registrar em `tom_known_issues`** (é correção de semântica, não só feature) — UPDATE/补 do `FIN-GATE-CONTAS` ou novo `FIN-FIXAS-VS-PAGAR`: "minhas contas fixas mostrava só em aberto; separado em query_fixed_bills (relação completa) vs query_bills_to_pay (recorte)".

---

## Self-review

**1. Cobertura da spec (F0+F1 backend):**
- F0 regras puras `classifyBillSeverity`/`billRelativeLabel`/`diasRestantesDoMes` → T1,T2 ✓ (`diasRestantesDoMes` criado em T1, usado em fatias futuras).
- F0 kit base B01(header)/B02(sep)/B06(severityTiers)/B07(billItem)/B11(quickActions)/B17(totalHighlight)/B10(tomTip)/assemble → T3 ✓.
- F1 `buildFixedBills` (relação completa) → T4 ✓; `buildBillsToPay` (aberto + fatura + dueDay) → T5 ✓.
- F1 fatura entra no total (decisão travada) → T5 `cards` somados + T7 `pendingCardInvoices` ✓.
- F1 handlers separados + NLU → T8 (engine) + T9 (skill, distinção obrigatória) ✓.
- Consolidação PWA / "Dica do TOM" no conteúdo contextual / Checkup → **fora desta fatia** (PWA = próximo plano; `buildTomTip` contextual = F4; checkup = F3). `tomTip()` já renomeado em T3.

**2. Placeholders:** nenhum — todo passo tem código/comando completo. (Step 4/5 da T10 referenciam ação concreta: query SQL de conferência + INSERT/UPDATE no known_issues; sem placeholder de lógica de produto.)

**3. Consistência de tipos/nomes:**
- `classifyBillSeverity(bill, today, opts?)`, `billDueDeltaDays(bill, today)`, `billRelativeLabel(bill, today)`, `billDueDom`/`isBillPaidThisCycle` (de bills-query) — usados igual em report-domain (T1/T2) e reports/bills (T4/T5). ✓
- ReportModel de `buildFixedBills` = `{ groups:{vencidas,pendentes,pagas,semValor}, totals:{...,aPagar}, count }` → `renderFixedBills` lê exatamente esses campos (T6). ✓
- `buildBillsToPay` → `{ vencidas,proximos7,restanteMes,cards,totalPendente }` (ou `{ filtered,totalPendente,dueDay }`) → `renderBillsToPay` lê exatamente. ✓
- `money()` tem espaço ("R$ 1.620,00") — asserts de T3/T6 usam o formato com espaço. ✓
- `severityTiers(tiers, labels)` itera `Object.keys(labels)` e usa `billItem` — chaves batem entre builder e labels do render. ✓

**Pendências conscientes (não-bloqueantes):** `billsToPaySummary` antigo em finance-format.js fica órfão (inofensivo) — remoção opcional num cleanup. `diasRestantesDoMes` é criado aqui mas só consumido nas Fatias 3/5 (ok, é fundação).
