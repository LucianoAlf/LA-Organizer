# Relatórios — Fatia 2: Saldos consolidados — Implementation Plan

> REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Convenções do repo: testes puros backend = `scripts/smoke-*.js` (node assert); PWA = vitest. NÃO commitar entre tasks; backend via scp+pm2 na task final; web auto-deploy. ABSOLUTE paths. Sonnet/Opus, nunca Haiku.

**Goal:** "💰 Seus Saldos" no padrão-ouro: carteiras com semáforo + total + posição (saldo em contas, limite disponível, total disponível), no TOM (`query_accounts` reescrito) e no PWA (card de posição no dashboard).

**Architecture:** `reports/balances.js` (builder puro) → `wa-format` (balanceLine/positionBlock/renderBalances) ← engine `query_accounts`. PWA: `computePosition` (TS puro, paridade) + card na FinanceiroPage. Reusa `listAccounts/listCards/cardUsage` (backend) e `useAccounts/useCardsWithUsage` (PWA).

**Decisões:** semáforo 🔴<0 / ✅≥0 (🟡 deferido); `limiteDisponivel` = Σ max(0, cardUsage.available); `totalDisponivel` = saldo + limite.

---

## Task 1: `wa-format` — balanceLine + positionBlock + renderBalances
**Files:** Modify `src/finance/wa-format/index.js`; Modify `scripts/smoke-wa-format.js`.

- [ ] **Step 1:** append to `scripts/smoke-wa-format.js` antes do `console.log` final:
```js
const { balanceLine, positionBlock, renderBalances } = require('../src/finance/wa-format');
assert.strictEqual(balanceLine({ name:'Nubank', icon:'💜', balance:5221, status:'✅' }), '💜 *Nubank* R$ 5.221,00 ✅');
assert.strictEqual(balanceLine({ name:'Cheque', balance:-30 }), '🏦 *Cheque* -R$ 30,00 🔴'); // sem status → deriva
assert.ok(positionBlock({ totalSaldo:10161, limiteDisponivel:60121, totalDisponivel:70282 }).includes('Total disponível: R$ 70.282,00'));
const bm = { accounts:[{name:'Nubank',icon:'💜',balance:5221,status:'✅'},{name:'Itau',icon:'🧡',balance:4820,status:'✅'}], totalSaldo:10041, limiteDisponivel:1000, totalDisponivel:11041 };
const rb = renderBalances(bm);
assert.ok(rb.startsWith('💰 *Seus Saldos*'));
assert.ok(rb.includes('💜 *Nubank* R$ 5.221,00 ✅'));
assert.ok(rb.includes('💰 *Total: R$ 10.041,00*'));
assert.ok(rb.includes('💳 Limite disponível: R$ 1.000,00'));
assert.ok(renderBalances({ accounts:[], totalSaldo:0, limiteDisponivel:0, totalDisponivel:0 }).includes('ainda não tem'));
```
NOTE: `money()` formats negative as `-R$ 30,00` (the `-` precedes "R$"); the assert reflects whatever `Number(-30).toLocaleString('pt-BR',{minimumFractionDigits:2})` yields prefixed by `R$ `. If the real output differs (e.g. `R$ -30,00`), adjust the assert to the ACTUAL `money(-30)` output — run `node -e "console.log(require('./src/services/finance-format').money(-30))"` first and match it.

- [ ] **Step 2:** run `node /d/la-organizer/_remote/scripts/smoke-wa-format.js` → FAIL (balanceLine is not a function).

- [ ] **Step 3:** add to `src/finance/wa-format/index.js` before `module.exports`, and add the 3 names to the export:
```js
function _semaforo(balance) { return Number(balance) < 0 ? '🔴' : '✅'; }
function balanceLine(acc) {
  const st = acc.status || _semaforo(acc.balance);
  return `${acc.icon || '🏦'} *${acc.name}* ${money(Number(acc.balance) || 0)} ${st}`;
}
function positionBlock(p) {
  return ['📊 *Posição*',
    `🏦 Saldo em contas: ${money(p.totalSaldo)}`,
    `💳 Limite disponível: ${money(p.limiteDisponivel)}`,
    `📈 Total disponível: ${money(p.totalDisponivel)}`].join('\n');
}
function renderBalances(model) {
  if ((!model.accounts || !model.accounts.length) && !model.limiteDisponivel) {
    return 'Você ainda não tem carteiras nem cartões. Quer criar? Ex: _"cria carteira Nubank"_.';
  }
  const linhas = model.accounts.map(balanceLine).join('\n');
  return assemble([
    header('💰', 'Seus Saldos'),
    linhas,
    totalHighlight('', model.totalSaldo),
    positionBlock(model),
    quickActions(['extrato', 'minhas contas a pagar', 'quanto gastei esse mês']),
  ]);
}
```

- [ ] **Step 4:** run smoke → PASS; `node --check /d/la-organizer/_remote/src/finance/wa-format/index.js`.

---

## Task 2: `reports/balances.js` — buildBalances (builder puro)
**Files:** Create `src/finance/reports/balances.js`; Create `scripts/smoke-reports-balances.js`.

- [ ] **Step 1:** `scripts/smoke-reports-balances.js`:
```js
const assert = require('assert');
const { buildBalances } = require('../src/finance/reports/balances');
const accounts = [
  { name:'Nubank', icon:'💜', balance:5221 },
  { name:'Itau', icon:'🧡', balance:4820 },
  { name:'Cheque', balance:-30 },
];
const cardsUsage = [
  { card:{ name:'Nubank' }, usage:{ available:1000, used:200, limit:1200, pct:0.16 } },
  { card:{ name:'Estourado' }, usage:{ available:-50, used:550, limit:500, pct:1.1 } }, // negativo não conta
];
const m = buildBalances(accounts, cardsUsage);
assert.strictEqual(m.accounts.length, 3);
assert.strictEqual(m.accounts[0].status, '✅');
assert.strictEqual(m.accounts[2].status, '🔴'); // saldo negativo
assert.strictEqual(m.totalSaldo, 5221 + 4820 - 30);     // 10011
assert.strictEqual(m.limiteDisponivel, 1000);            // estourado clampado a 0
assert.strictEqual(m.totalDisponivel, 10011 + 1000);     // 11011
assert.strictEqual(buildBalances([], []).totalDisponivel, 0);
console.log('PASS — buildBalances OK.');
```

- [ ] **Step 2:** run → FAIL.

- [ ] **Step 3:** `src/finance/reports/balances.js`:
```js
'use strict';
// Builder puro de Saldos consolidados → ReportModel (agnóstico de canal).
function _semaforo(b) { return Number(b) < 0 ? '🔴' : '✅'; }
function buildBalances(accounts, cardsUsage) {
  const accs = (accounts || []).map((a) => ({
    name: a.name, icon: a.icon || '🏦', balance: Number(a.balance) || 0, status: _semaforo(a.balance),
  }));
  const totalSaldo = accs.reduce((s, a) => s + a.balance, 0);
  const limiteDisponivel = (cardsUsage || []).reduce(
    (s, cu) => s + Math.max(0, Number(cu && cu.usage && cu.usage.available) || 0), 0);
  return { accounts: accs, totalSaldo, limiteDisponivel, totalDisponivel: totalSaldo + limiteDisponivel };
}
module.exports = { buildBalances };
```

- [ ] **Step 4:** run → PASS; `node --check`.

---

## Task 3: Engine — reescrever `query_accounts`
**Files:** Modify `src/engine.js`.

- [ ] **Step 1:** substituir o `case 'query_accounts': { ... }` atual (carteiras-only) por:
```js
    case 'query_accounts': {
      const { buildBalances } = require('./finance/reports/balances');
      const wa = require('./finance/wa-format');
      const accounts = await financeService.listAccounts(cid);
      const cards = await financeService.listCards(cid);
      const cardsUsage = await Promise.all(
        cards.map(async (c) => ({ card: c, usage: await financeService.cardUsage(cid, c) })));
      return wa.renderBalances(buildBalances(accounts, cardsUsage));
    }
```
- [ ] **Step 2:** `node --check /d/la-organizer/_remote/src/engine.js` → OK. (`query_accounts` já está em FINANCE_ACTIONS — não mexer na lista.)

---

## Task 4: Skill — doc do query_accounts
**Files:** Modify `skills/financeiro-pessoal.md`.

- [ ] **Step 1:** substituir a linha do `query_accounts` por:
```markdown
- `query_accounts` — sem params. Mostra "💰 Seus Saldos": carteiras com semáforo (🔴 negativo / ✅ ok) + total + Posição (saldo em contas, limite disponível dos cartões, total disponível). Use em "meus saldos", "quanto tenho", "quais minhas carteiras", "minha posição", "saldo geral".
```
- [ ] **Step 2:** `grep -n "query_accounts" /d/la-organizer/_remote/skills/financeiro-pessoal.md` → aparece a doc nova.

---

## Task 5: PWA — `computePosition` (TS puro) + vitest
**Files:** Modify `web/src/lib/cartoes.ts` (ou `financeiro.ts`); Create `web/src/lib/position.test.ts`.

- [ ] **Step 1:** vitest `web/src/lib/position.test.ts` (FAIL primeiro):
```ts
import { describe, it, expect } from 'vitest';
import { computePosition } from './cartoes';

describe('computePosition', () => {
  it('soma saldos + limite disponível (clampa negativo)', () => {
    const accs = [{ balance: 5221 }, { balance: 4820 }, { balance: -30 }] as any;
    const cu = [{ usage: { available: 1000 } }, { usage: { available: -50 } }] as any;
    const p = computePosition(accs, cu);
    expect(p.totalSaldo).toBe(10011);
    expect(p.limiteDisponivel).toBe(1000);
    expect(p.totalDisponivel).toBe(11011);
  });
});
```
- [ ] **Step 2:** `cd /d/la-organizer/_remote/web && npx vitest run src/lib/position.test.ts` → FAIL.
- [ ] **Step 3:** add to `web/src/lib/cartoes.ts`:
```ts
export interface Position { totalSaldo: number; limiteDisponivel: number; totalDisponivel: number; }
export function computePosition(
  accounts: { balance: number }[],
  cardsUsage: { usage: { available: number } }[],
): Position {
  const totalSaldo = accounts.reduce((s, a) => s + Number(a.balance || 0), 0);
  const limiteDisponivel = cardsUsage.reduce((s, c) => s + Math.max(0, Number(c.usage?.available || 0)), 0);
  return { totalSaldo, limiteDisponivel, totalDisponivel: totalSaldo + limiteDisponivel };
}
```
- [ ] **Step 4:** vitest → PASS.

---

## Task 6: PWA — card "Posição" no dashboard
**Files:** Modify `web/src/screens/financeiro/FinanceiroPage.tsx`.

- [ ] **Step 1:** Read FinanceiroPage. Importar `useCardsWithUsage` (de `../../hooks/useFinanceiro`) e `computePosition` (de `../../lib/cartoes`). Com `useAccounts()` (já presente p/ hasAnyData) + `useCardsWithUsage()`, computar `const pos = useMemo(() => computePosition(accountsQ.data ?? [], cardsUsageQ.data ?? []), [accountsQ.data, cardsUsageQ.data])`.
- [ ] **Step 2:** Renderizar um card "Posição" (seguindo o padrão visual dos StatCards/section-card da página: `rounded-lg border border-border bg-bg-surface`), com 3 linhas: 🏦 Saldo em contas / 💳 Limite disponível / 📈 Total disponível (use o helper de formatação de moeda já usado na página). Mostrar só quando houver conta OU cartão (`(accountsQ.data?.length || cardsUsageQ.data?.length)`). NÃO quebrar os cards existentes (Receitas/Despesas/Saldo).
- [ ] **Step 3:** `cd /d/la-organizer/_remote/web && npx tsc --noEmit && npx vite build` → OK.

---

## Task 7: Deploy backend + smoke
- [ ] **Step 1:** rodar os 3 smokes backend afetados: `node scripts/smoke-wa-format.js && node scripts/smoke-reports-balances.js` + `node --check` em wa-format/index.js, reports/balances.js, engine.js.
- [ ] **Step 2:** scp (`src/finance/wa-format/index.js`, `src/finance/reports/balances.js`, `src/engine.js`, `skills/financeiro-pessoal.md`, `scripts/smoke-wa-format.js`, `scripts/smoke-reports-balances.js`) + md5 (wa-format, balances, engine) + smoke no VPS + `pm2 restart tom`.
- [ ] **Step 3:** smoke real: comparar `query_accounts` esperado com os saldos reais (SQL: `pf_accounts` + soma; cartões `cardUsage`).

---

## Self-review
- **Cobertura:** buildBalances (T2) + balanceLine/positionBlock/renderBalances (T1) + query_accounts rewrite (T3) + skill (T4) + PWA computePosition (T5) + card (T6). ✓
- **Tipos:** ReportModel `{accounts:[{name,icon,balance,status}], totalSaldo, limiteDisponivel, totalDisponivel}` — render lê exatamente; computePosition espelha os totais (paridade). ✓
- **Sem placeholder de lógica;** o ponto "formatação de moeda já usada na página" (T6) é localização por padrão existente.
- **money() negativo:** T1 Step 1 instrui rodar `money(-30)` e casar o assert ao output real (evita assumir o sinal).
