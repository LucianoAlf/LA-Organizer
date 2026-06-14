# Pluggy D2 — Conciliação (matching) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Steps usam checkbox.

**Goal:** Classificar cada movimento do staging em `matched` (você já lançou) / `internal` (transferência própria, pagamento de fatura, investimento) / `noise` (rendimento, IOF) / `pending` (gasto-receita externo a perguntar) — casar ANTES de perguntar.

**Architecture:** `reconcile.js` puro (regras de classificação, TDD com os casos reais do staging do Alf) + `pluggy-reconcile.js` serviço (lê staging pending → busca lançamentos do app + peers → classifica → grava status). Matching v1 por valor+data+direção (vínculo de conta confirmado fica pro D4).

**Tech Stack:** Node CommonJS, `node:test`, Supabase service_role, deploy scp+pm2.

---

### Task 1: `reconcile.js` — classificação pura (TDD)

**Files:** Create `src/finance/reconcile.js`, `src/finance/reconcile.test.js`.

Buckets fundados no staging real: NOISE = `Proceeds interests and dividends`, `Tax on financial operations`. INTERNAL = `Same person transfer`, `Credit card payment`, `Investments`, ou descrição de fatura, ou contraparte interna (par oposto mesmo valor ±2d em conta diferente). MATCHED = lançamento do app valor±0,01 + data±3d + mesma direção (precedência máxima). Resto = PENDING.

- [ ] **Step 1: teste** (código completo em `reconcile.test.js`):

```js
const { test } = require('node:test');
const assert = require('node:assert');
const { classify } = require('./reconcile');
const T = (o) => ({ id: 'x', pluggy_account_id: 'acc1', direction: 'out', amount: 50, posted_date: '2026-06-10', description: '', pluggy_category: null, ...o });

test('matched: app txn mesmo valor/data/direção → matched + id', () => {
  const r = classify(T({ amount: 50, posted_date: '2026-06-10' }), { appTxns: [{ id: 'app1', direction: 'out', amount: 50, transaction_date: '2026-06-11' }], peers: [] });
  assert.equal(r.status, 'matched'); assert.equal(r.matchedId, 'app1');
});
test('matched respeita janela: data > 3 dias NÃO casa', () => {
  const r = classify(T({ amount: 50, posted_date: '2026-06-10' }), { appTxns: [{ id: 'app1', direction: 'out', amount: 50, transaction_date: '2026-06-20' }], peers: [] });
  assert.notEqual(r.status, 'matched');
});
test('noise: rendimento e IOF', () => {
  assert.equal(classify(T({ direction: 'in', amount: 0.05, pluggy_category: 'Proceeds interests and dividends' }), {}).status, 'noise');
  assert.equal(classify(T({ pluggy_category: 'Tax on financial operations', amount: 3 }), {}).status, 'noise');
});
test('internal por categoria', () => {
  assert.equal(classify(T({ pluggy_category: 'Same person transfer' }), {}).status, 'internal');
  assert.equal(classify(T({ pluggy_category: 'Credit card payment', direction: 'in' }), {}).status, 'internal');
  assert.equal(classify(T({ pluggy_category: 'Investments', direction: 'in' }), {}).status, 'internal');
});
test('internal por descrição de fatura', () => {
  assert.equal(classify(T({ description: 'Pagamento de fatura', pluggy_category: 'Transfers' }), {}).status, 'internal');
  assert.equal(classify(T({ description: 'PGTO FATURA CARTAO C6', pluggy_category: 'Investments' }), {}).status, 'internal');
});
test('internal por contraparte (saída numa conta = entrada em outra ±2d)', () => {
  const txn = T({ id: 'o1', direction: 'out', amount: 2100, posted_date: '2026-06-10', pluggy_account_id: 'accA', pluggy_category: 'Transfers' });
  const peers = [txn, { id: 'i1', direction: 'in', amount: 2100, posted_date: '2026-06-11', pluggy_account_id: 'accB' }];
  assert.equal(classify(txn, { peers }).status, 'internal');
});
test('pending: gasto externo sem match', () => {
  assert.equal(classify(T({ pluggy_category: 'Food delivery', amount: 53.91, description: 'IFD*JATOBA' }), { appTxns: [], peers: [] }).status, 'pending');
});
test('matched tem precedência sobre internal', () => {
  const r = classify(T({ amount: 100, posted_date: '2026-06-10', pluggy_category: 'Same person transfer' }), { appTxns: [{ id: 'a1', direction: 'out', amount: 100, transaction_date: '2026-06-10' }], peers: [] });
  assert.equal(r.status, 'matched');
});
test('não casa o mesmo app txn duas vezes', () => {
  const ctx = { appTxns: [{ id: 'a1', direction: 'out', amount: 30, transaction_date: '2026-06-10' }], peers: [] };
  assert.equal(classify(T({ id: 't1', amount: 30, posted_date: '2026-06-10' }), ctx).status, 'matched');
  assert.notEqual(classify(T({ id: 't2', amount: 30, posted_date: '2026-06-10' }), ctx).status, 'matched');
});
```

- [ ] **Step 2:** rodar → FAIL.
- [ ] **Step 3: implementar** (código completo em `reconcile.js`):

```js
// src/finance/reconcile.js — PURO: classifica 1 movimento do staging Pluggy.
// matched (usuário lançou) > noise (rendimento/IOF) > internal (transf própria/fatura/investimento) > pending.
const NOISE = new Set(['Proceeds interests and dividends', 'Tax on financial operations']);
const INTERNAL = new Set(['Same person transfer', 'Credit card payment', 'Investments']);
const RE_FATURA = /pagamento de fatura|pgto\s*fatura|fatura\s*cart[aã]o|inclusao de pagamento/i;

function daysBetween(a, b) { return (new Date(a) - new Date(b)) / 86400000; }

function findMatch(txn, appTxns) {
  return (appTxns || []).find((a) => !a._used && a.direction === txn.direction
    && Math.abs(Number(a.amount) - Number(txn.amount)) < 0.01
    && Math.abs(daysBetween(a.transaction_date, txn.posted_date)) <= 3) || null;
}
function hasInternalPeer(txn, peers) {
  const opp = txn.direction === 'out' ? 'in' : 'out';
  return (peers || []).some((p) => p.id !== txn.id && p.direction === opp
    && Math.abs(Number(p.amount) - Number(txn.amount)) < 0.01
    && p.pluggy_account_id !== txn.pluggy_account_id
    && Math.abs(daysBetween(p.posted_date, txn.posted_date)) <= 2);
}
function classify(txn, ctx = {}) {
  const m = findMatch(txn, ctx.appTxns);
  if (m) { m._used = true; return { status: 'matched', matchedId: m.id }; }
  if (NOISE.has(txn.pluggy_category)) return { status: 'noise' };
  if (INTERNAL.has(txn.pluggy_category) || RE_FATURA.test(txn.description || '')) return { status: 'internal' };
  if (hasInternalPeer(txn, ctx.peers)) return { status: 'internal' };
  return { status: 'pending' };
}
module.exports = { classify, findMatch, hasInternalPeer, daysBetween };
```

- [ ] **Step 4:** rodar → 9 pass.

---

### Task 2: `pluggy-reconcile.js` — serviço de reconciliação

**Files:** Create `src/services/pluggy-reconcile.js`.

- [ ] **Step 1: implementar**

```js
// src/services/pluggy-reconcile.js — classifica o staging pending: matched/internal/noise/pending.
// require supabase LAZY. (Fase D / D2)
const { classify } = require('../finance/reconcile');

async function reconcileStaging(collaboratorId) {
  const supabase = require('../supabase/client');
  const { data: staging } = await supabase.from('pf_pluggy_transactions')
    .select('id, pluggy_account_id, direction, amount, posted_date, description, pluggy_category')
    .eq('collaborator_id', collaboratorId).eq('status', 'pending');
  if (!staging || !staging.length) return { matched: 0, noise: 0, internal: 0, pending: 0 };

  let minDate = staging[0].posted_date;
  for (const s of staging) if (s.posted_date < minDate) minDate = s.posted_date;
  const { data: appRaw } = await supabase.from('pf_transactions')
    .select('id, type, amount, transaction_date')
    .eq('collaborator_id', collaboratorId).gte('transaction_date', minDate);
  const appTxns = (appRaw || []).map((a) => ({ id: a.id, direction: a.type === 'income' ? 'in' : 'out', amount: a.amount, transaction_date: a.transaction_date, _used: false }));

  const { data: peers } = await supabase.from('pf_pluggy_transactions')
    .select('id, direction, amount, posted_date, pluggy_account_id').eq('collaborator_id', collaboratorId);

  const counts = { matched: 0, noise: 0, internal: 0, pending: 0 };
  for (const txn of staging) {
    const r = classify(txn, { appTxns, peers });
    counts[r.status]++;
    if (r.status !== 'pending') {
      await supabase.from('pf_pluggy_transactions').update({
        status: r.status, matched_pf_transaction_id: r.matchedId || null, resolved_at: new Date().toISOString(),
      }).eq('id', txn.id);
    }
  }
  return counts;
}
module.exports = { reconcileStaging };
```

- [ ] **Step 2:** `node --check src/services/pluggy-reconcile.js`.

---

### Task 3: Deploy + smoke real + known issue

- [ ] **Step 1:** `node --test src/finance/reconcile.test.js` → 9 pass; `node --check` nos 2 arquivos.
- [ ] **Step 2:** scp `reconcile.js` + `pluggy-reconcile.js` + `pm2 restart`.
- [ ] **Step 3: smoke** (`D:\la-organizer\pluggy-d2-smoke.js`, fora de `_remote`): chama `reconcileStaging(ALF)` e mostra os counts + uma amostra de cada bucket. Esperado: noise pega os ~49 rendimentos, internal pega Same-person/Credit-card-payment/Investments/fatura, pending sobra com Shopping/Food/Transfers-terceiros.
- [ ] **Step 4: idempotência:** rodar 2×; 2ª vez `pending` inicial menor (já classificados saíram do pending) e sem reprocessar os resolvidos.
- [ ] **Step 5:** registrar `FIN-PLUGGY-D2-RECONCILE` + atualizar memória radar (D2 ✅).
