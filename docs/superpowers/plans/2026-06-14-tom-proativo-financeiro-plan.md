# TOM Proativo Financeiro — Plano de Implementação (Fase C)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development ou superpowers:executing-plans. Steps usam checkbox `- [ ]`.

**Goal:** 3 alertas financeiros proativos determinísticos — previsão de fatura, gasto fora do padrão, assinaturas/aumento — entregues misto (anomalia inline + previsão/assinaturas no ritual diário), sem custo de LLM, com anti-spam e quiet gate.

**Architecture:** 3 módulos PUROS em `src/finance/` (testáveis isolados) + queries novas no `financeiro-service.js` + 1 ritual novo no `dispatcher.js` (previsão + assinaturas, claim/quiet) + anexo inline no `engine.js` (anomalia). Spec: `docs/superpowers/specs/2026-06-14-tom-proativo-financeiro-design.md`.

**Tech Stack:** Node.js CommonJS, Supabase, `node:test`, rituais via `ritual-claim`/`ritual_logs`.

---

## File Structure
- `src/finance/forecast-invoice.js` (+ `.test.js`) — puro: decide alerta de fatura.
- `src/finance/spending-anomaly.js` (+ `.test.js`) — puro: Z-score de gasto.
- `src/finance/recurring-detect.js` (+ `.test.js`) — puro: normaliza merchant + detecta recorrência/aumento.
- `src/finance/proactive-messages.js` (+ `.test.js`) — puro: monta os textos dos alertas.
- `src/services/financeiro-service.js` — MOD: queries `lastClosedInvoiceTotals`, `merchantSpendHistory`, `recurringTxns`.
- `src/rituals/dispatcher.js` — MOD: ritual `financeiro_proativo` (previsão + assinaturas).
- `src/engine.js` — MOD: anomalia inline nos handlers `card_purchase` + `register_transaction`.

---

## Task 1: forecast-invoice.js (puro, TDD)
**Files:** Create `src/finance/forecast-invoice.js` + `src/finance/forecast-invoice.test.js`

- [ ] **Step 1 — teste falhando** (`forecast-invoice.test.js`):
```js
const { test } = require('node:test'); const assert = require('node:assert');
const { forecastInvoiceAlert } = require('./forecast-invoice');
test('dispara quando perto de fechar e acima do threshold', () => {
  const r = forecastInvoiceAlert({ openTotal: 2100, closedTotals: [1600, 1700, 1620], daysToClose: 3 });
  assert.equal(r.alert, true); assert.equal(r.pctOver >= 25, true);
});
test('null sem histórico suficiente', () => {
  assert.equal(forecastInvoiceAlert({ openTotal: 2100, closedTotals: [1600], daysToClose: 3 }), null);
});
test('null se longe do fechamento', () => {
  assert.equal(forecastInvoiceAlert({ openTotal: 2100, closedTotals: [1600,1700], daysToClose: 12 }), null);
});
test('null se dentro da média', () => {
  assert.equal(forecastInvoiceAlert({ openTotal: 1650, closedTotals: [1600,1700], daysToClose: 3 }), null);
});
```
- [ ] **Step 2 — roda e falha:** `node --test src/finance/forecast-invoice.test.js`
- [ ] **Step 3 — implementação:**
```js
function forecastInvoiceAlert({ openTotal, closedTotals, daysToClose, threshold = 0.20, windowDays = 5 }) {
  const closed = (closedTotals || []).map(Number).filter((v) => Number.isFinite(v) && v > 0);
  if (closed.length < 2) return null;
  if (daysToClose == null || daysToClose < 0 || daysToClose > windowDays) return null;
  const avg = closed.reduce((s, v) => s + v, 0) / closed.length;
  if (avg <= 0 || Number(openTotal) < avg * (1 + threshold)) return null;
  return { alert: true, openTotal: Number(openTotal), avg: Math.round(avg * 100) / 100,
    pctOver: Math.round(((openTotal - avg) / avg) * 100), daysToClose };
}
module.exports = { forecastInvoiceAlert };
```
- [ ] **Step 4 — passa:** `node --test src/finance/forecast-invoice.test.js` → 4/4.
- [ ] **Step 5 — commit:** (auto-deploy cuida; sem commit manual).

## Task 2: spending-anomaly.js (puro, TDD)
**Files:** Create `src/finance/spending-anomaly.js` + `.test.js`
- [ ] **Step 1 — testes:** poucos samples → `{isAnomaly:false}`; `[40,45,50,42]` + `89` → `isAnomaly:true` (z≥2); `[40,45,50,42]` + `48` → false; sd=0 `[50,50,50]` + `90` → true.
- [ ] **Step 2 — roda e falha.**
- [ ] **Step 3 — implementação:**
```js
function detectAnomaly({ amount, history, minSamples = 3, zThreshold = 2 }) {
  const a = Number(amount);
  if (!Number.isFinite(a) || a <= 0) return { isAnomaly: false };
  const vals = (history || []).map(Number).filter((v) => Number.isFinite(v) && v > 0);
  if (vals.length < minSamples) return { isAnomaly: false, reason: 'few_samples' };
  const avg = vals.reduce((s, v) => s + v, 0) / vals.length;
  const sd = Math.sqrt(vals.reduce((s, v) => s + (v - avg) ** 2, 0) / vals.length);
  const r2 = (n) => Math.round(n * 100) / 100;
  if (sd === 0) return { isAnomaly: a > avg * 1.5, avg: r2(avg), ratio: r2(a / avg), z: null };
  const z = (a - avg) / sd;
  return { isAnomaly: z >= zThreshold && a > avg, z: Math.round(z * 10) / 10, avg: r2(avg), ratio: Math.round((a / avg) * 10) / 10 };
}
module.exports = { detectAnomaly };
```
- [ ] **Step 4 — passa.** **Step 5 — commit.**

## Task 3: recurring-detect.js (puro, TDD)
**Files:** Create `src/finance/recurring-detect.js` + `.test.js`
- [ ] **Step 1 — testes:** `normalizeMerchant('NETFLIX.COM *123ABC')` → `'netflix com'`; `normalizeMerchant('Amazonmktplc *Frc (1/6)')` → sem `1/6`/sufixo. `detectRecurring` com 3 meses de "Netflix" (55,55,68) → 1 item `priceChanged:true deltaPct>0 lastAmount:68 prevAmount:55`; "iFood" 1x → não recorrente (fora).
- [ ] **Step 2 — roda e falha.**
- [ ] **Step 3 — implementação:**
```js
function normalizeMerchant(desc) {
  return String(desc || '').toLowerCase()
    .replace(/\(\s*\d{1,2}\s*\/\s*\d{1,2}\s*\)/g, '')   // (1/6)
    .replace(/\b\d{1,2}\/\d{1,2}\b/g, '')               // 1/6
    .replace(/[*#].*$/, '')                             // sufixo após * ou #
    .replace(/\b\d{3,}\b/g, '')                         // ids longos
    .replace(/[^a-z0-9à-ú ]/gi, ' ').replace(/\s+/g, ' ').trim();
}
function detectRecurring(transactions) {
  const groups = new Map();
  for (const t of (transactions || [])) {
    const m = normalizeMerchant(t.descricao || t.description);
    if (!m) continue;
    if (!groups.has(m)) groups.set(m, []);
    groups.get(m).push({ amount: Math.abs(Number(t.valor ?? t.amount) || 0), date: t.data || t.transaction_date });
  }
  const out = [];
  for (const [merchant, occ] of groups) {
    if (occ.length < 2) continue;
    occ.sort((a, b) => String(a.date).localeCompare(String(b.date)));
    // intervalo médio ~mensal (20–40 dias) entre ocorrências
    const gaps = [];
    for (let i = 1; i < occ.length; i++) gaps.push((new Date(occ[i].date) - new Date(occ[i - 1].date)) / 864e5);
    const avgGap = gaps.reduce((s, g) => s + g, 0) / gaps.length;
    if (avgGap < 20 || avgGap > 40) continue;
    const last = occ[occ.length - 1], prev = occ[occ.length - 2];
    const priceChanged = Math.abs(last.amount - prev.amount) >= 0.01;
    out.push({ merchant, occurrences: occ.length, lastAmount: last.amount, prevAmount: prev.amount,
      priceChanged, deltaPct: prev.amount ? Math.round(((last.amount - prev.amount) / prev.amount) * 100) : 0,
      isNew: occ.length === 2 });
  }
  return out;
}
module.exports = { normalizeMerchant, detectRecurring };
```
- [ ] **Step 4 — passa.** **Step 5 — commit.**

## Task 4: proactive-messages.js (puro, TDD)
**Files:** Create `src/finance/proactive-messages.js` + `.test.js`
- [ ] Builders puros: `buildForecastLine(card, fc)` → `💳 A fatura do *Nubank* fecha em 3 dias e já está em R$ 2.100 — 28% acima da sua média (R$ 1.640).`; `buildRecurringLines(items)` → linhas `🔁 *Netflix* subiu de R$ 55 → R$ 68` / `🆕`; `buildAnomalyNote(anom, desc)` → `⚠️ Tá ~2× o seu normal aí (média R$ 45).`. Testes batem o formato (assert.match). Commit.

## Task 5: queries no financeiro-service.js
**Files:** Modify `src/services/financeiro-service.js` (+ export no `module.exports`)
- [ ] `lastClosedInvoiceTotals(cid, card, n=3)` — soma de `cardInvoice` das n competências fechadas anteriores à corrente (usar `currentCompetencia` + `addMonthsToCompetencia(comp, -i)`).
- [ ] `merchantSpendHistory(cid, descricao, {months=6})` — valores de gastos passados com descrição normalizada igual (LIKE por prefixo do merchant), p/ anomalia.
- [ ] `recurringTxns(cid, {months=4})` — transações (descricao, valor, data) dos últimos N meses do user, p/ `detectRecurring`.
- [ ] Smoke manual na VPS confirmando que retornam dados do Alf. Commit.

## Task 6: ritual financeiro_proativo no dispatcher
**Files:** Modify `src/rituals/dispatcher.js`
- [ ] Função `checkFinanceProactive(now)` no mesmo padrão de `checkFinanceMonthly`: itera colaboradores com cartões; pra cada cartão roda `forecastInvoiceAlert` (usa `lastClosedInvoiceTotals` + `cardInvoice` da competência aberta + `daysToClose` via `closing_day`); roda `detectRecurring(recurringTxns)`; monta a mensagem com `proactive-messages`. Gate: `isQuietNow(...,'personal')` + `claimRitualSend(supabase, c.id, 'financeiro_proativo', ymd)` + `alreadySent`. **NÃO logar 'error' sob `financeiro_proativo` quando há pré-gate `alreadySent`** (armadilha conhecida). Só envia se houver ao menos 1 alerta. Registrar no tick + no `RITUAL_TYPE_MAP` se preciso.
- [ ] Migration: garantir que `financeiro_proativo` entra no índice `ritual_logs_sent_daily_uq` (claim diário). Verificar a definição atual e adicionar o tipo.
- [ ] Smoke: `node src/rituals/dispatcher.js --force=financeiro_proativo --phone=<alf>` na VPS. Commit.

## Task 7: anomalia inline no engine
**Files:** Modify `src/engine.js` (handlers `card_purchase` linha ~7211 e `register_transaction`)
- [ ] Após inserir o gasto, chamar `financeService.merchantSpendHistory(cid, params.description)` + `detectAnomaly`. Se `isAnomaly`, anexar `'\n\n' + buildAnomalyNote(...)` à `reply`. Envolver em try/catch (nunca quebra o registro). Só pra despesas (amount>0).
- [ ] Smoke E2E na VPS: registrar gasto anômalo e ver a nota. Commit.

## Task 8: deploy + validação final
- [ ] `node --test src/finance/*.test.js` (todos verdes) + `node --check` nos arquivos tocados.
- [ ] scp dos arquivos + `pm2 restart tom` + boot limpo.
- [ ] Smoke: forçar `financeiro_proativo` pro Alf; registrar gasto anômalo; conferir mensagens.
- [ ] Registrar known issue/feature + atualizar memória.

---

## Self-review (spec coverage)
- Previsão de fatura → Task 1 + 5 + 6 ✅
- Anomalia inline → Task 2 + 5 + 7 ✅
- Assinaturas/aumento → Task 3 + 5 + 6 ✅
- Mensagens → Task 4 ✅
- Anti-spam (claim) + quiet → Task 6 ✅
- Determinístico, por usuário, thresholds ajustáveis → embutido nos módulos ✅
- Fora de escopo (ML/Pluggy/health) → não incluído ✅
