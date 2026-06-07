# Relatórios — Fatia 3: Checkup das contas (TOM) — Implementation Plan

> REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Testes puros = `scripts/smoke-*.js` (node assert). Sem commit entre tasks; backend via scp+pm2 na task final. ABSOLUTE paths. Sonnet/Opus.

**Goal:** "🩺 Checkup das contas" no padrão-ouro: agrupa contas por severidade (🔴 urgentes / 🟠 importantes) com diagnóstico por conta (💬 "venceu em DD/MM e sem pagamento" / "valor não informado") + headline + oferta de ajuda. Ação TOM `query_checkup`.

**Architecture:** `report-domain.billDueDateLabel` (DD/MM) → `reports/checkup.js` (`buildCheckup` + `billCheckupMessage`) → `wa-format.renderCheckup` ← engine `query_checkup`. Reusa `classifyBillSeverity` (F0), `listActiveBills`. PWA: saúde das contas já coberta (chips de alerta + aba "A pagar"); sem trabalho PWA nesta fatia.

---

## Task 1: `report-domain.js` — `billDueDateLabel`
**Files:** Modify `src/finance/report-domain.js`; Modify `scripts/smoke-report-domain.js`.

- [ ] **Step 1:** append asserts antes do `console.log` final de `scripts/smoke-report-domain.js`:
```js
const { billDueDateLabel } = require('../src/finance/report-domain');
assert.strictEqual(billDueDateLabel({ recurrence:'monthly', due_day:5 }, '2026-04-10'), '05/04');
assert.strictEqual(billDueDateLabel({ recurrence:'monthly', due_day:31 }, '2026-02-10'), '28/02'); // clampa
assert.strictEqual(billDueDateLabel({ recurrence:'once', due_date:'2026-06-15' }, '2026-04-10'), '15/06');
assert.strictEqual(billDueDateLabel({ recurrence:'once', due_date:null }, '2026-04-10'), '—');
```
- [ ] **Step 2:** run `node /d/la-organizer/_remote/scripts/smoke-report-domain.js` → FAIL.
- [ ] **Step 3:** add to `src/finance/report-domain.js` before `module.exports` (and add `billDueDateLabel` to the export list):
```js
// Rótulo DD/MM do vencimento (monthly = due_day no mês de today, clampado; once = due_date).
function billDueDateLabel(bill, today) {
  if (bill.recurrence === 'once') {
    if (!bill.due_date) return '—';
    return String(bill.due_date).slice(8, 10) + '/' + String(bill.due_date).slice(5, 7);
  }
  const [, m] = String(today).split('-').map(Number);
  const y = Number(String(today).slice(0, 4));
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const dd = Math.min(Number(bill.due_day), lastDay);
  return String(dd).padStart(2, '0') + '/' + String(m).padStart(2, '0');
}
```
- [ ] **Step 4:** run → PASS; `node --check`.

---

## Task 2: `reports/checkup.js` — buildCheckup + billCheckupMessage
**Files:** Create `src/finance/reports/checkup.js`; Create `scripts/smoke-reports-checkup.js`.

- [ ] **Step 1:** `scripts/smoke-reports-checkup.js`:
```js
const assert = require('assert');
const { buildCheckup } = require('../src/finance/reports/checkup');
const T = '2026-04-10';
const bills = [
  { name:'Celular', amount:99, due_day:5, recurrence:'monthly', type:'expense', last_paid_at:null },     // urgente (venceu)
  { name:'Aluguel', amount:1500, due_day:10, recurrence:'monthly', type:'expense', last_paid_at:null },   // urgente (hoje)
  { name:'Internet', amount:120, due_day:15, recurrence:'monthly', type:'expense', last_paid_at:null },    // importante (5d)
  { name:'Gas', amount:0, due_day:25, recurrence:'monthly', type:'expense', last_paid_at:null },           // importante (sem valor)
  { name:'Seguro', amount:300, due_day:28, recurrence:'monthly', type:'expense', last_paid_at:null },      // ok (>15d) — não relevante
  { name:'Salario', amount:5000, due_day:5, recurrence:'monthly', type:'income', last_paid_at:null },      // income ignorado
];
const m = buildCheckup(bills, T);
assert.strictEqual(m.tiers.urgente.map((b)=>b.name).sort().join(','), 'Aluguel,Celular');
assert.strictEqual(m.tiers.importante.map((b)=>b.name).sort().join(','), 'Gas,Internet');
assert.strictEqual(m.count, 4); // urgente + importante
assert.strictEqual(m.totalRelevante, 99 + 1500 + 120); // Gas (sem valor) não soma
assert.ok(/venceu em 05\/04/.test(m.tiers.urgente.find((b)=>b.name==='Celular').message));
assert.ok(/vence hoje/.test(m.tiers.urgente.find((b)=>b.name==='Aluguel').message));
assert.ok(/valor não informado/.test(m.tiers.importante.find((b)=>b.name==='Gas').message));
assert.ok(/merecem atenção/.test(m.headline));
assert.ok(/em ordem/.test(buildCheckup([], T).headline));
console.log('PASS — buildCheckup OK.');
```
- [ ] **Step 2:** run → FAIL.
- [ ] **Step 3:** `src/finance/reports/checkup.js`:
```js
'use strict';
const { classifyBillSeverity, billDueDateLabel, billDueDeltaDays } = require('../report-domain');

function billCheckupMessage(bill, today, severity) {
  const nome = bill.name;
  const dataLabel = billDueDateLabel(bill, today);
  if (!(Number(bill.amount) > 0)) return `A conta '${nome}' (vence ${dataLabel}) está com valor não informado.`;
  const delta = billDueDeltaDays(bill, today);
  if (delta == null) return `A conta '${nome}' está sem data de vencimento definida.`;
  if (severity === 'urgente') {
    return delta === 0
      ? `A conta '${nome}' vence hoje (${dataLabel}) e ainda não foi paga.`
      : `A conta '${nome}' venceu em ${dataLabel} e ainda não tem pagamento registrado.`;
  }
  return `A conta '${nome}' vence em ${delta}d (${dataLabel}).`;
}

// Checkup: agrupa contas (despesa) por severidade + diagnóstico por conta + headline.
function buildCheckup(bills, today) {
  const tiers = { urgente: [], importante: [], atencao: [], ok: [] };
  for (const b of (bills || []).filter((x) => (x.type || 'expense') === 'expense')) {
    const sev = classifyBillSeverity(b, today);
    tiers[sev].push({
      name: b.name,
      amount: Number(b.amount) || 0,
      hasValue: Number(b.amount) > 0,
      dueLabel: billDueDateLabel(b, today),
      message: billCheckupMessage(b, today, sev),
    });
  }
  const count = tiers.urgente.length + tiers.importante.length;
  const totalRelevante = [...tiers.urgente, ...tiers.importante]
    .filter((b) => b.hasValue).reduce((s, b) => s + b.amount, 0);
  const headline = count === 0
    ? 'Suas contas estão em ordem — nada vencido ou pendente de atenção agora. 👍'
    : `Encontrei ${count} ${count === 1 ? 'ponto que merece' : 'pontos que merecem'} atenção:`;
  return { tiers, totalRelevante, headline, count };
}

module.exports = { buildCheckup, billCheckupMessage };
```
- [ ] **Step 4:** run → PASS; `node --check`.

---

## Task 3: `wa-format` — renderCheckup
**Files:** Modify `src/finance/wa-format/index.js`; Modify `scripts/smoke-wa-format.js`.

- [ ] **Step 1:** append asserts antes do `console.log` final de `scripts/smoke-wa-format.js`:
```js
const { renderCheckup } = require('../src/finance/wa-format');
const cm = {
  tiers: {
    urgente: [{ name:'Celular', amount:99, hasValue:true, dueLabel:'05/04', message:"A conta 'Celular' venceu em 05/04 e ainda não tem pagamento registrado." }],
    importante: [{ name:'Gas', amount:0, hasValue:false, dueLabel:'25/04', message:"A conta 'Gas' (vence 25/04) está com valor não informado." }],
    atencao: [], ok: [],
  }, totalRelevante:99, headline:'Encontrei 2 pontos que merecem atenção:', count:2,
};
const rc = renderCheckup(cm);
assert.ok(rc.startsWith('🩺 *Checkup das contas*'));
assert.ok(rc.includes('🔴 *Mais urgentes* (1)'));
assert.ok(rc.includes('🟠 *Importantes* (1)'));
assert.ok(rc.includes('💰 R$ 99,00'));
assert.ok(rc.includes('💰 não informado'));
assert.ok(rc.includes('💬'));
assert.ok(renderCheckup({ tiers:{urgente:[],importante:[],atencao:[],ok:[]}, totalRelevante:0, headline:'Suas contas estão em ordem — nada vencido ou pendente de atenção agora. 👍', count:0 }).includes('em ordem'));
```
- [ ] **Step 2:** run → FAIL.
- [ ] **Step 3:** add to `src/finance/wa-format/index.js` before `module.exports` (+ export `renderCheckup`):
```js
function _checkupItem(b) {
  const valor = b.hasValue ? money(b.amount) : 'não informado';
  return `⚠️ *${b.name}*\n💰 ${valor}\n📅 Vence: ${b.dueLabel}\n💬 ${b.message}`;
}
function renderCheckup(model) {
  if (!model.count) return `🩺 *Checkup das contas*\n${model.headline}`;
  const blocks = [`🩺 *Checkup das contas*\n${model.headline}`];
  if (model.tiers.urgente.length) {
    blocks.push(`🔴 *Mais urgentes* (${model.tiers.urgente.length})\n` + model.tiers.urgente.map(_checkupItem).join('\n\n'));
  }
  if (model.tiers.importante.length) {
    blocks.push(`🟠 *Importantes* (${model.tiers.importante.length})\n` + model.tiers.importante.map(_checkupItem).join('\n\n'));
  }
  blocks.push('_Quer ajuda com a mais urgente? Me chama._');
  return blocks.join('\n\n');
}
```
- [ ] **Step 4:** run → PASS; `node --check`.

---

## Task 4: Engine — `query_checkup`
**Files:** Modify `src/engine.js`.

- [ ] **Step 1:** em `FINANCE_ACTIONS`, adicionar `'query_checkup'` (ex.: depois de `'query_bills_to_pay'`).
- [ ] **Step 2:** adicionar o case (perto dos outros query_*):
```js
    case 'query_checkup': {
      const { buildCheckup } = require('./finance/reports/checkup');
      const wa = require('./finance/wa-format');
      const today = new Date().toISOString().slice(0, 10);
      const bills = await financeService.listActiveBills(cid);
      return wa.renderCheckup(buildCheckup(bills, today));
    }
```
- [ ] **Step 3:** `node --check /d/la-organizer/_remote/src/engine.js`.

---

## Task 5: Skill — doc do query_checkup
**Files:** Modify `skills/financeiro-pessoal.md`.

- [ ] **Step 1:** adicionar após a linha do `query_bills_to_pay`:
```markdown
- `query_checkup` — sem params. "🩺 Checkup das contas": diagnóstico das contas que merecem atenção (🔴 urgentes = vencidas/hoje sem pagar; 🟠 importantes = vencem em até 7 dias ou com valor não informado), com explicação por conta. Use em "analisa minhas contas", "checkup", "tem problema nas contas?", "alguma conta vencida?".
```
- [ ] **Step 2:** `grep -n "query_checkup" /d/la-organizer/_remote/skills/financeiro-pessoal.md`.

---

## Task 6: Deploy + smoke
- [ ] **Step 1:** rodar `node scripts/smoke-report-domain.js && node scripts/smoke-reports-checkup.js && node scripts/smoke-wa-format.js` + `node --check` em report-domain, reports/checkup, wa-format/index, engine.
- [ ] **Step 2:** scp (report-domain.js, reports/checkup.js, wa-format/index.js, engine.js, financeiro-pessoal.md, 3 smokes) + md5 (checkup, wa-format, engine) + smoke VPS + `pm2 restart tom`.
- [ ] **Step 3:** smoke real: "analisa minhas contas" do Matheus → confere severidade (17 dia-10 a vencer em ~3d → importantes; nenhuma vencida hoje).

## Self-review
- Cobertura: billDueDateLabel (T1), buildCheckup+message (T2), renderCheckup (T3), engine (T4), skill (T5). PWA fora (já coberto por chips/aba). ✓
- Tipos: tiers `{urgente,importante,atencao,ok}` de itens `{name,amount,hasValue,dueLabel,message}`; render lê exatamente. ✓
- Guards: once sem due_date → dueLabel '—' + message "sem data"; valor zerado → "não informado" e fora do totalRelevante. ✓
