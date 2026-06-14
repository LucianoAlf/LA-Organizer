# Pluggy D1 — Fundação (sync do extrato real) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Conectar o TOM ao extrato real dos bancos via Pluggy e gravar cada movimento num staging deduplicado — "os olhos" da conciliação.

**Architecture:** Três unidades de responsabilidade única — `pluggy.js` (I/O HTTP com a API Pluggy), `pluggy-normalize.js` (puro: normaliza uma transação crua, resolve a direção pelo campo `type`), `pluggy-sync.js` (orquestra: lê itens do colaborador → puxa contas/transações → upsert no staging com dedup). Três tabelas `pf_pluggy_*` com RLS por `collaborator_id`. Tudo `collaborator_id`-first (service_role ignora RLS).

**Tech Stack:** Node.js CommonJS, `fetch` global (Node 24), `node:test`, Supabase (service_role client + MCP pra migrations), deploy via scp+pm2.

**Convenção de deploy:** segue o CLAUDE.md — NÃO commitar entre tasks; trabalhar local em `_remote/`; migrations via MCP; deploy (scp+pm2) só na Task 6. "Verificar" = rodar `node --test` / `node --check`.

---

### Task 1: Migrations — 3 tabelas `pf_pluggy_*` com RLS + índices

**Files:**
- Apply via MCP `apply_migration` (project `cesnbnrynvxvgdhfmaua`), uma migration por tabela.

- [ ] **Step 1: Aplicar `pf_pluggy_items`**

`apply_migration` name `pf_pluggy_items` query:
```sql
create table if not exists pf_pluggy_items (
  id uuid primary key default gen_random_uuid(),
  collaborator_id uuid not null,
  pluggy_item_id text not null unique,
  connector_name text,
  status text,
  last_synced_at timestamptz,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
alter table pf_pluggy_items enable row level security;
create policy pf_pluggy_items_owner on pf_pluggy_items for all
  using (collaborator_id = current_collab_id()) with check (collaborator_id = current_collab_id());
create index if not exists pf_pluggy_items_collab on pf_pluggy_items(collaborator_id);
```

- [ ] **Step 2: Aplicar `pf_pluggy_account_map`**

```sql
create table if not exists pf_pluggy_account_map (
  id uuid primary key default gen_random_uuid(),
  collaborator_id uuid not null,
  pluggy_account_id text not null unique,
  pluggy_item_id text not null,
  kind text not null check (kind in ('account','card')),
  pf_account_id uuid references pf_accounts(id) on delete set null,
  pf_card_id uuid references pf_cards(id) on delete set null,
  display_name text,
  confirmed boolean not null default false,
  created_at timestamptz not null default now()
);
alter table pf_pluggy_account_map enable row level security;
create policy pf_pluggy_account_map_owner on pf_pluggy_account_map for all
  using (collaborator_id = current_collab_id()) with check (collaborator_id = current_collab_id());
create index if not exists pf_pluggy_account_map_collab on pf_pluggy_account_map(collaborator_id);
```

- [ ] **Step 3: Aplicar `pf_pluggy_transactions` (staging)**

```sql
create table if not exists pf_pluggy_transactions (
  id uuid primary key default gen_random_uuid(),
  collaborator_id uuid not null,
  pluggy_transaction_id text not null unique,
  pluggy_account_id text not null,
  posted_date date not null,
  amount numeric not null,
  direction text not null check (direction in ('in','out')),
  description text,
  pluggy_category text,
  raw jsonb,
  status text not null default 'pending' check (status in ('pending','matched','internal','noise','future','ignored')),
  matched_pf_transaction_id uuid,
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);
alter table pf_pluggy_transactions enable row level security;
create policy pf_pluggy_transactions_owner on pf_pluggy_transactions for all
  using (collaborator_id = current_collab_id()) with check (collaborator_id = current_collab_id());
create index if not exists pf_pluggy_txns_collab_status on pf_pluggy_transactions(collaborator_id, status);
create index if not exists pf_pluggy_txns_collab_date on pf_pluggy_transactions(collaborator_id, posted_date);
```

- [ ] **Step 4: Verificar** — `list_tables` (MCP) ou `SELECT count(*) FROM pf_pluggy_items;` retorna 0 (tabela existe, vazia).

---

### Task 2: `pluggy-normalize.js` — normalização pura (TDD)

**Files:**
- Create: `src/finance/pluggy-normalize.js`
- Test: `src/finance/pluggy-normalize.test.js`

A pegadinha (vista no dado real): a direção vem do campo `type` — `DEBIT`=saída, `CREDIT`=entrada — em conta **E** cartão. O sinal do `amount` engana no cartão (compra vem positiva). `amount` é sempre guardado absoluto; a direção fica em `direction`.

- [ ] **Step 1: Escrever o teste que falha**

```js
const { test } = require('node:test');
const assert = require('node:assert');
const { normalizeTxn } = require('./pluggy-normalize');

test('conta: DEBIT (valor negativo) → out; CREDIT (positivo) → in', () => {
  const out = normalizeTxn({ id: 't1', accountId: 'a1', date: '2026-06-03T00:00:00Z', amount: -1414.99, type: 'DEBIT', description: 'PGTO FATURA' }, 'account', '2026-06-14');
  assert.equal(out.direction, 'out');
  assert.equal(out.amount, 1414.99);
  assert.equal(out.postedDate, '2026-06-03');
  const inc = normalizeTxn({ id: 't2', accountId: 'a1', date: '2026-06-10T00:00:00Z', amount: 700, type: 'CREDIT', description: 'PIX RECEBIDO' }, 'account', '2026-06-14');
  assert.equal(inc.direction, 'in');
  assert.equal(inc.amount, 700);
});

test('cartão: DEBIT com valor POSITIVO (compra) → out (a pegadinha)', () => {
  const buy = normalizeTxn({ id: 't3', accountId: 'c1', date: '2026-06-09T00:00:00Z', amount: 6.98, type: 'DEBIT', description: 'IFD*IFOOD' }, 'card', '2026-06-14');
  assert.equal(buy.direction, 'out');
  assert.equal(buy.amount, 6.98);
});

test('cartão: CREDIT (estorno/pagamento) → in', () => {
  const est = normalizeTxn({ id: 't4', accountId: 'c1', date: '2026-06-05T00:00:00Z', amount: 50, type: 'CREDIT', description: 'ESTORNO' }, 'card', '2026-06-14');
  assert.equal(est.direction, 'in');
});

test('parcela futura (date > hoje) → isFuture true', () => {
  const fut = normalizeTxn({ id: 't5', accountId: 'c1', date: '2026-07-15T00:00:00Z', amount: 56.5, type: 'DEBIT', description: 'ANUIDADE 12/12' }, 'card', '2026-06-14');
  assert.equal(fut.isFuture, true);
});

test('type ausente → fallback pelo sinal do amount', () => {
  const n = normalizeTxn({ id: 't6', accountId: 'a1', date: '2026-06-01T00:00:00Z', amount: -10, type: '', description: 'X' }, 'account', '2026-06-14');
  assert.equal(n.direction, 'out');
});

test('passa o id e accountId; raw preservado', () => {
  const n = normalizeTxn({ id: 'abc', accountId: 'xyz', date: '2026-06-01', amount: 5, type: 'DEBIT' }, 'card', '2026-06-14');
  assert.equal(n.pluggyTransactionId, 'abc');
  assert.equal(n.pluggyAccountId, 'xyz');
  assert.equal(n.raw.id, 'abc');
});
```

- [ ] **Step 2: Rodar e ver falhar** — `node --test src/finance/pluggy-normalize.test.js` → FAIL (módulo não existe).

- [ ] **Step 3: Implementar**

```js
// src/finance/pluggy-normalize.js — PURO: normaliza 1 transação Pluggy crua.
// Direção vem do campo `type` (DEBIT=out, CREDIT=in) — vale p/ conta E cartão.
// O sinal do amount NÃO decide direção (no cartão a compra vem positiva). amount = absoluto.
function normalizeTxn(raw, accountKind, todayYmd) {
  const postedDate = String(raw.date || '').slice(0, 10);
  const type = String(raw.type || '').toUpperCase();
  let direction;
  if (type === 'DEBIT') direction = 'out';
  else if (type === 'CREDIT') direction = 'in';
  else direction = Number(raw.amount) < 0 ? 'out' : 'in'; // fallback sem type
  return {
    pluggyTransactionId: raw.id,
    pluggyAccountId: raw.accountId,
    postedDate,
    amount: Math.abs(Number(raw.amount) || 0),
    direction,
    description: raw.description || '',
    category: raw.category || null,
    isFuture: todayYmd ? postedDate > todayYmd : false,
    accountKind,
    raw,
  };
}
module.exports = { normalizeTxn };
```

- [ ] **Step 4: Rodar e ver passar** — `node --test src/finance/pluggy-normalize.test.js` → 6 pass.

---

### Task 3: `pluggy.js` — cliente HTTP da API Pluggy

**Files:**
- Create: `src/services/pluggy.js`
- Test: `src/services/pluggy.test.js` (só o cache do apiKey, com `fetch` stub)

- [ ] **Step 1: Escrever o teste de cache**

```js
const { test } = require('node:test');
const assert = require('node:assert');

test('getApiKey autentica 1x e cacheia (2ª chamada não chama fetch de novo)', async () => {
  let calls = 0;
  const realFetch = global.fetch;
  global.fetch = async () => { calls++; return { ok: true, json: async () => ({ apiKey: 'KEY123' }) }; };
  delete require.cache[require.resolve('./pluggy')];
  process.env.PLUGGY_CLIENT_ID = 'x'; process.env.PLUGGY_CLIENT_SECRET = 'y';
  const { getApiKey } = require('./pluggy');
  const k1 = await getApiKey();
  const k2 = await getApiKey();
  global.fetch = realFetch;
  assert.equal(k1, 'KEY123');
  assert.equal(k2, 'KEY123');
  assert.equal(calls, 1);
});
```

- [ ] **Step 2: Rodar e ver falhar** — `node --test src/services/pluggy.test.js` → FAIL.

- [ ] **Step 3: Implementar**

```js
// src/services/pluggy.js — cliente HTTP da API Pluggy (https://api.pluggy.ai).
// auth cacheia o apiKey em memória (~110min; expira em 2h). Leitura apenas.
const BASE = 'https://api.pluggy.ai';
const TTL_MS = 110 * 60 * 1000;
let _apiKey = null, _apiKeyAt = 0;

async function getApiKey() {
  if (_apiKey && (Date.now() - _apiKeyAt) < TTL_MS) return _apiKey;
  const r = await fetch(`${BASE}/auth`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clientId: process.env.PLUGGY_CLIENT_ID, clientSecret: process.env.PLUGGY_CLIENT_SECRET }),
  });
  if (!r.ok) throw new Error(`pluggy auth ${r.status}`);
  _apiKey = (await r.json()).apiKey; _apiKeyAt = Date.now();
  return _apiKey;
}
async function _get(path) {
  const key = await getApiKey();
  const r = await fetch(`${BASE}${path}`, { headers: { 'X-API-KEY': key } });
  if (!r.ok) throw new Error(`pluggy GET ${path} ${r.status}`);
  return r.json();
}
async function fetchItem(itemId) { return _get(`/items/${itemId}`); }
async function fetchAccounts(itemId) { return (await _get(`/accounts?itemId=${itemId}`)).results || []; }
async function fetchTransactions(accountId, { from } = {}) {
  const out = []; let page = 1;
  for (;;) {
    const j = await _get(`/transactions?accountId=${accountId}&pageSize=500&page=${page}` + (from ? `&from=${from}` : ''));
    const res = j.results || [];
    out.push(...res);
    if (res.length < 500 || page >= (j.totalPages || 1)) break;
    page++;
  }
  return out;
}
module.exports = { getApiKey, fetchItem, fetchAccounts, fetchTransactions };
```

- [ ] **Step 4: Rodar e ver passar** — `node --test src/services/pluggy.test.js` → 1 pass. Depois `node --check src/services/pluggy.js`.

---

### Task 4: `pluggy-sync.js` — orquestra sync + staging + descoberta de contas

**Files:**
- Create: `src/services/pluggy-sync.js`
- Test: `src/services/pluggy-sync.test.js` (só os helpers puros `accountKind` e `daysAgo`)

- [ ] **Step 1: Escrever o teste dos helpers puros**

```js
const { test } = require('node:test');
const assert = require('node:assert');
const { accountKind, daysAgo } = require('./pluggy-sync');

test('accountKind: CREDIT → card; BANK/outros → account', () => {
  assert.equal(accountKind({ type: 'CREDIT' }), 'card');
  assert.equal(accountKind({ type: 'BANK' }), 'account');
  assert.equal(accountKind({ type: 'bank' }), 'account');
});

test('daysAgo: subtrai dias em YMD', () => {
  assert.equal(daysAgo('2026-06-14', 60), '2026-04-15');
  assert.equal(daysAgo('2026-01-01', 1), '2025-12-31');
});
```

- [ ] **Step 2: Rodar e ver falhar** — `node --test src/services/pluggy-sync.test.js` → FAIL.

- [ ] **Step 3: Implementar**

```js
// src/services/pluggy-sync.js — orquestra: itens do colaborador → contas/transações → staging.
// collaborator_id-first (service_role ignora RLS). Idempotente: upsert por pluggy_transaction_id.
const supabase = require('../supabase/client');
const pluggy = require('./pluggy');
const { normalizeTxn } = require('../finance/pluggy-normalize');

function accountKind(acc) { return String(acc && acc.type).toUpperCase() === 'CREDIT' ? 'card' : 'account'; }
function daysAgo(ymd, n) {
  const d = new Date(`${ymd}T00:00:00Z`); d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

// Descobre contas Pluggy do item e registra as novas em pf_pluggy_account_map (confirmed=false).
async function upsertAccountMap(collaboratorId, item, accounts) {
  for (const acc of accounts) {
    const { data: exist } = await supabase.from('pf_pluggy_account_map')
      .select('id').eq('pluggy_account_id', acc.id).maybeSingle();
    if (exist) continue;
    await supabase.from('pf_pluggy_account_map').insert({
      collaborator_id: collaboratorId,
      pluggy_account_id: acc.id,
      pluggy_item_id: item.pluggy_item_id,
      kind: accountKind(acc),
      display_name: (acc.name || item.connector_name || '').trim(),
      confirmed: false,
    });
  }
}

async function syncPluggy(collaboratorId, { todayYmd } = {}) {
  const today = todayYmd || new Date().toISOString().slice(0, 10);
  const { data: items } = await supabase.from('pf_pluggy_items')
    .select('*').eq('collaborator_id', collaboratorId).eq('is_active', true);
  let upserted = 0, accountsSeen = 0;
  for (const item of (items || [])) {
    const accounts = await pluggy.fetchAccounts(item.pluggy_item_id);
    accountsSeen += accounts.length;
    await upsertAccountMap(collaboratorId, item, accounts);
    const from = item.last_synced_at ? String(item.last_synced_at).slice(0, 10) : daysAgo(today, 60);
    for (const acc of accounts) {
      const kind = accountKind(acc);
      const txns = await pluggy.fetchTransactions(acc.id, { from });
      const rows = txns.map((t) => {
        const n = normalizeTxn(t, kind, today);
        return {
          collaborator_id: collaboratorId,
          pluggy_transaction_id: n.pluggyTransactionId,
          pluggy_account_id: n.pluggyAccountId,
          posted_date: n.postedDate,
          amount: n.amount,
          direction: n.direction,
          description: n.description,
          pluggy_category: n.category,
          raw: n.raw,
          status: n.isFuture ? 'future' : 'pending',
        };
      }).filter((r) => r.pluggy_transaction_id && r.posted_date);
      if (rows.length) {
        const { error } = await supabase.from('pf_pluggy_transactions')
          .upsert(rows, { onConflict: 'pluggy_transaction_id', ignoreDuplicates: true });
        if (!error) upserted += rows.length;
      }
    }
    await supabase.from('pf_pluggy_items')
      .update({ status: 'UPDATED', last_synced_at: new Date().toISOString() }).eq('id', item.id);
  }
  return { items: (items || []).length, accountsSeen, upserted };
}

module.exports = { syncPluggy, upsertAccountMap, accountKind, daysAgo };
```

- [ ] **Step 4: Rodar e ver passar** — `node --test src/services/pluggy-sync.test.js` → 2 pass. Depois `node --check src/services/pluggy-sync.js`.

---

### Task 5: Suíte completa + sintaxe

- [ ] **Step 1: Rodar toda a suíte finance + services Pluggy**

Run: `node --test src/finance/pluggy-normalize.test.js src/services/pluggy.test.js src/services/pluggy-sync.test.js`
Expected: 9 pass, 0 fail.

- [ ] **Step 2: Checar sintaxe dos 3 módulos**

Run: `node --check src/services/pluggy.js && node --check src/services/pluggy-sync.js && node --check src/finance/pluggy-normalize.js`
Expected: sem erro.

---

### Task 6: Deploy + seed dos itens do Alf + smoke E2E real

**Files:** nenhum novo — config + deploy + verificação.

- [ ] **Step 1: Credenciais no `.env` da VPS** (não commitar, não tocar `_remote/`)

```bash
ssh tom "cd /opt/LA-Organizer && grep -q PLUGGY_CLIENT_ID .env || printf 'PLUGGY_CLIENT_ID=7e544456-d812-4d0c-be73-8cf9675db6c1\nPLUGGY_CLIENT_SECRET=85df1630-217d-47dd-adbf-4809e5e66c02\n' >> .env"
```

- [ ] **Step 2: Descobrir o `collaborator_id` do Alf** (MCP execute_sql)

```sql
SELECT id, full_name FROM collaborators WHERE full_name ILIKE '%lucian%' OR full_name ILIKE '%alf%';
```
Anotar o `id` (= `<ALF_CID>`).

- [ ] **Step 3: Seed dos 5 itens do Alf em `pf_pluggy_items`** (MCP execute_sql, trocar `<ALF_CID>`)

```sql
INSERT INTO pf_pluggy_items (collaborator_id, pluggy_item_id, connector_name) VALUES
 ('<ALF_CID>','f48c6adb-24dc-450b-9eed-8f94ee95d28e','Santander'),
 ('<ALF_CID>','d673d702-737c-46e9-aba8-73587b583e25','Mercado Pago'),
 ('<ALF_CID>','0bc6a06f-2182-4afa-8b4d-e33943a9000b','C6 Bank'),
 ('<ALF_CID>','eb16fd2f-de41-43e6-bc5d-48908dab7ef0','Itau'),
 ('<ALF_CID>','cfebab8e-cedd-4213-b814-526595923fa8','Nubank')
ON CONFLICT (pluggy_item_id) DO NOTHING;
```

- [ ] **Step 4: Deploy dos 3 módulos**

```bash
scp src/finance/pluggy-normalize.js tom:/opt/LA-Organizer/src/finance/pluggy-normalize.js
scp src/services/pluggy.js tom:/opt/LA-Organizer/src/services/pluggy.js
scp src/services/pluggy-sync.js tom:/opt/LA-Organizer/src/services/pluggy-sync.js
ssh tom "pm2 restart tom"
```

- [ ] **Step 5: Smoke E2E real** — escrever `D:\la-organizer\pluggy-d1-smoke.js` (fora de `_remote`, não commitado), scp pra VPS, rodar com `--env-file=.env`, remover:

```js
// pluggy-d1-smoke.js — roda o sync real do Alf e mostra o staging.
(async () => {
  process.chdir('/opt/LA-Organizer');
  const { syncPluggy } = require('./src/services/pluggy-sync');
  const supabase = require('./src/supabase/client');
  const { data: alf } = await supabase.from('collaborators').select('id, full_name')
    .or('full_name.ilike.%lucian%,full_name.ilike.%alf%').limit(1).maybeSingle();
  console.log('Alf:', alf && alf.full_name, alf && alf.id);
  const res = await syncPluggy(alf.id);
  console.log('sync result:', res);
  const { count } = await supabase.from('pf_pluggy_transactions')
    .select('*', { count: 'exact', head: true }).eq('collaborator_id', alf.id);
  console.log('staging total:', count);
  const { data: sample } = await supabase.from('pf_pluggy_transactions')
    .select('posted_date, amount, direction, status, description')
    .eq('collaborator_id', alf.id).order('posted_date', { ascending: false }).limit(8);
  for (const r of (sample || [])) console.log('  ', r.posted_date, r.direction, r.amount, `[${r.status}]`, r.description);
  process.exit(0);
})().catch((e) => { console.error('SMOKE ERR', e); process.exit(1); });
```

```bash
scp /d/la-organizer/pluggy-d1-smoke.js tom:/opt/LA-Organizer/tmp-pluggy-smoke.js
ssh tom "cd /opt/LA-Organizer && node --env-file=.env tmp-pluggy-smoke.js; rm -f tmp-pluggy-smoke.js"
rm -f /d/la-organizer/pluggy-d1-smoke.js
```
Expected: `res.upserted` > 0, `staging total` > 0, amostra com `direction`/`status` corretos (cartão DEBIT → `out`, parcela jul → `future`).

- [ ] **Step 6: Reimport idempotente** — rodar o smoke 2× (repetir Step 5). 2ª rodada: `upserted` ainda conta as linhas, mas `staging total` **não cresce** (dedup por `pluggy_transaction_id` funcionando).

- [ ] **Step 7: Registrar known issue** `FIN-PLUGGY-D1-FUNDACAO` em `tom_known_issues` (status corrigido, área dispatcher) e atualizar a memória radar (D1 ✅).

---

## Self-Review

**Spec coverage:**
- Serviço `pluggy.js` (auth+cache, fetchItem/Accounts/Transactions) → Task 3 ✅
- 3 migrations com RLS + índices → Task 1 ✅
- Normalização de sinal conta×cartão + parcela futura → Task 2 ✅
- syncPluggy upsert dedup → Task 4 ✅
- Descoberta/registro de contas (account_map) → Task 4 (`upsertAccountMap`) ✅
- Smoke com extrato real → Task 6 ✅
- Credenciais no `.env` da VPS → Task 6 Step 1 ✅
- Fora de D1 (vínculo confirmado conta↔app, matching, relatório) → D2/D3, fora deste plano ✅

**Placeholder scan:** sem TBD/TODO; todo código é completo. `<ALF_CID>` é um valor a descobrir na Task 6 Step 2 (não é placeholder de código).

**Type consistency:** `normalizeTxn(raw, accountKind, todayYmd)` retorna `{pluggyTransactionId, pluggyAccountId, postedDate, amount, direction, description, category, isFuture, accountKind, raw}` — consumido igual no `pluggy-sync.js`. `accountKind`/`daysAgo` exportados em Task 4 e testados em Task 4 Step 1. Colunas do staging batem com a migration da Task 1 (`pluggy_transaction_id`, `posted_date`, `direction`, `status`).

**Reuso confirmado:** `current_collab_id()` (RLS, igual `pf_transactions`), `supabase/client` (service_role), padrão de smoke fora de `_remote`.
