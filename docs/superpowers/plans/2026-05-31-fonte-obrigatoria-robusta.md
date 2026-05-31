# Fonte Obrigatória Robusta (engine-owned) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Garantir que toda transação financeira tenha fonte (conta/cartão/Dinheiro) sem depender do multi-turn frágil do LLM — robustez no engine (pending-state determinístico) + conta principal + coaching pro app, com invariante anti-órfã.

**Architecture:** O LLM sempre emite `register_transaction` (nunca pergunta de boca / fabrica). O **engine** resolve a fonte: na-frase → principal silenciosa-mas-nomeada → pergunta+pending-state → coaching pro app (0 contas). A resposta da pergunta é casada e gravada **deterministicamente** pelo engine (bypass do LLM), reusando a infra `pending_intents`. Migration adiciona `is_primary` em `pf_accounts`.

**Tech Stack:** Node.js CommonJS (TOM engine), Supabase Postgres (service_role), node:test, React+TS+Tailwind (PWA), deploy via `scp tom:` + `pm2 restart tom` (engine) e auto-deploy hook (web).

---

## File Structure

**Backend (engine):**
- `src/finance/source-match.js` *(novo)* — lógica pura: casa a resposta do usuário (número/nome/"cartão"/"conta") contra os candidatos da pergunta. Sem I/O.
- `src/finance/source-match.test.js` *(novo)* — testes node:test.
- `src/services/financeiro-service.js` *(modifica)* — `is_primary` em listAccounts/createAccount; `findPrimaryAccount`, `setPrimaryAccount`.
- `src/services/finance-format.js` *(modifica)* — `buildTxnConfirmation` ganha `assumedSource` (nomeia a principal assumida).
- `src/services/finance-format.test.js` *(modifica)* — teste do `assumedSource`.
- `src/engine.js` *(modifica)* — helper `writeCashTransaction` (extrai a escrita+confirmação); roteamento novo no case `register_transaction`; consumidor determinístico de `finance_source` pending antes do LLM.
- `src/services/pending-intents.js` *(modifica)* — `VALID_KINDS` += `finance_source`.
- `src/prompts/system.js` *(modifica)* — marca a conta principal na injeção "Fontes deste usuário".

**Skills:**
- `skills/financeiro-pessoal.md` *(modifica)* — regra imperativa de emissão.
- `skills/coach-usabilidade.md` *(modifica)* — P6 financeiro.

**Migrations (Supabase via apply_migration):**
- `is_primary` em `pf_accounts` + índice único parcial.
- `pending_intents_kind_check` += `finance_source`.

**PWA:**
- `web/src/lib/financeiro.ts` *(modifica)* — `is_primary` no tipo/select; `setPrimaryAccount`.
- `web/src/hooks/useFinanceiro.ts` *(modifica)* — `useSetPrimaryAccount`.
- `web/src/screens/financeiro/CarteirasPage.tsx` *(modifica)* — toggle "principal".

**Data cleanup:**
- DELETE das 9 órfãs do Luciano (com OK explícito do Alf).

---

## Task R0: Pré-flight

**Files:** nenhum (verificação).

- [ ] **Step 1: Confirmar Node e sintaxe atual**

Run:
```bash
node --version
node --check src/engine.js && node --check src/services/financeiro-service.js && echo "syntax OK"
```
Expected: versão Node impressa; "syntax OK".

- [ ] **Step 2: Rodar a suíte financeira atual (baseline verde)**

Run:
```bash
node --test src/finance/source.test.js src/services/finance-format.test.js
```
Expected: todos passam (baseline antes de mexer).

- [ ] **Step 3: Confirmar contagem de órfãs (referência pro R12)**

Via MCP execute_sql (projeto `cesnbnrynvxvgdhfmaua`):
```sql
SELECT count(*) FROM pf_transactions
WHERE collaborator_id='0576f4b6-183d-4cf1-980e-5c8d5da0177f'
  AND account_id IS NULL AND card_id IS NULL;
```
Expected: 9 (anote; valida o DELETE depois).

---

## Task R1: Migration `is_primary` em `pf_accounts`

**Files:** Supabase migration (apply_migration).

- [ ] **Step 1: Aplicar a migration**

Via MCP `apply_migration` (name: `add_is_primary_pf_accounts`):
```sql
ALTER TABLE pf_accounts
  ADD COLUMN IF NOT EXISTS is_primary boolean NOT NULL DEFAULT false;

-- No máximo uma principal ativa por colaborador.
CREATE UNIQUE INDEX IF NOT EXISTS pf_accounts_one_primary
  ON pf_accounts (collaborator_id)
  WHERE is_primary AND is_active;
```

- [ ] **Step 2: Verificar coluna + índice**

Via execute_sql:
```sql
SELECT column_name FROM information_schema.columns
WHERE table_name='pf_accounts' AND column_name='is_primary';
SELECT indexname FROM pg_indexes
WHERE tablename='pf_accounts' AND indexname='pf_accounts_one_primary';
```
Expected: 1 linha cada.

---

## Task R2: Migration — `pending_intents.kind` aceita `finance_source`

**Files:** Supabase migration (apply_migration).

> ⚠️ **NÃO pular esta task.** Verificado no banco (2026-05-31): a CHECK
> `pending_intents_kind_check` EXISTE e lista só os 4 kinds antigos. Sem o ALTER,
> `openIntent(cid,'finance_source',...)` falha no INSERT (viola a constraint).
> A validação app-level (`VALID_KINDS`, R8-Step1) é necessária MAS não suficiente.

- [ ] **Step 1: Aplicar a migration**

Via MCP `apply_migration` (name: `pending_intents_add_finance_source`):
```sql
ALTER TABLE pending_intents DROP CONSTRAINT IF EXISTS pending_intents_kind_check;
ALTER TABLE pending_intents ADD CONSTRAINT pending_intents_kind_check
  CHECK (kind = ANY (ARRAY[
    'task_creation','event_creation','approval_pending','confirmation','finance_source'
  ]));
```

- [ ] **Step 2: Verificar**

Via execute_sql:
```sql
SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname='pending_intents_kind_check';
```
Expected: o array inclui `finance_source`.

---

## Task R3: `source-match.js` — lógica pura (TDD)

**Files:**
- Create: `src/finance/source-match.js`
- Test: `src/finance/source-match.test.js`

O matcher cobre **duas formas** de pergunta:
- `list`: candidatos numerados (`accounts` + `cards` + `cash`). Casa por número ("2") ou nome ("nubank"/"dinheiro").
- `binary`: colisão carteira-vs-cartão de mesmo nome. Casa "cartão/crédito" → card; "conta/carteira/débito" → account.

- [ ] **Step 1: Escrever os testes (falhando)**

```js
// src/finance/source-match.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const { matchSourceReply } = require('./source-match');

const listPayload = {
  form: 'list',
  candidates: [
    { kind: 'account', id: 'a1', name: 'Itaú' },
    { kind: 'card',    id: 'c1', name: 'Nubank' },
    { kind: 'cash',    id: null, name: 'Dinheiro' },
  ],
};

test('list: casa por número 1-based', () => {
  assert.deepStrictEqual(matchSourceReply('2', listPayload), { kind: 'card', id: 'c1', name: 'Nubank' });
});
test('list: casa por nome (substring, case-insensitive)', () => {
  assert.deepStrictEqual(matchSourceReply('no nubank', listPayload), { kind: 'card', id: 'c1', name: 'Nubank' });
});
test('list: "dinheiro" casa o candidato cash', () => {
  assert.deepStrictEqual(matchSourceReply('foi em dinheiro', listPayload), { kind: 'cash', id: null, name: 'Dinheiro' });
});
test('list: resposta off-topic não casa', () => {
  assert.strictEqual(matchSourceReply('amanhã te falo', listPayload), null);
});
test('list: número fora do range não casa', () => {
  assert.strictEqual(matchSourceReply('9', listPayload), null);
});

const binaryPayload = {
  form: 'binary',
  account: { kind: 'account', id: 'a9', name: 'Nubank' },
  card:    { kind: 'card',    id: 'c9', name: 'Nubank' },
};

test('binary: "cartão" → card', () => {
  assert.deepStrictEqual(matchSourceReply('foi no cartão', binaryPayload), { kind: 'card', id: 'c9', name: 'Nubank' });
});
test('binary: "crédito" → card', () => {
  assert.deepStrictEqual(matchSourceReply('crédito', binaryPayload), { kind: 'card', id: 'c9', name: 'Nubank' });
});
test('binary: "conta"/"carteira"/"débito" → account', () => {
  assert.deepStrictEqual(matchSourceReply('na conta', binaryPayload), { kind: 'account', id: 'a9', name: 'Nubank' });
  assert.deepStrictEqual(matchSourceReply('foi no débito', binaryPayload), { kind: 'account', id: 'a9', name: 'Nubank' });
});
test('binary: ambíguo continua null', () => {
  assert.strictEqual(matchSourceReply('sei lá', binaryPayload), null);
});
test('texto vazio/longo não casa', () => {
  assert.strictEqual(matchSourceReply('', listPayload), null);
  assert.strictEqual(matchSourceReply('x'.repeat(250), listPayload), null);
});
```

- [ ] **Step 2: Rodar — deve falhar**

Run: `node --test src/finance/source-match.test.js`
Expected: FAIL ("Cannot find module './source-match'").

- [ ] **Step 3: Implementar**

```js
// src/finance/source-match.js
// Lógica pura: casa a resposta do usuário à pergunta de fonte. Sem I/O.

const CARD_RE = /\b(cart[ãa]o|cr[ée]dito|fatura|parcel)/i;
const ACCT_RE = /\b(conta|carteira|d[ée]bito|corrente)\b/i;
const CASH_RE = /\b(dinheiro|esp[ée]cie|cash|em\s+m[ãa]o)\b/i;

function matchSourceReply(rawText, payload) {
  const t = String(rawText || '').toLowerCase().trim();
  if (!t || t.length > 200 || !payload) return null;

  if (payload.form === 'binary') {
    if (CARD_RE.test(t)) return payload.card;
    if (ACCT_RE.test(t)) return payload.account;
    return null;
  }

  // form === 'list'
  const cands = Array.isArray(payload.candidates) ? payload.candidates : [];
  if (!cands.length) return null;

  // 1) número 1-based (primeiro número que aparecer)
  const numMatch = t.match(/\b(\d{1,2})\b/);
  if (numMatch) {
    const idx = parseInt(numMatch[1], 10) - 1;
    if (idx >= 0 && idx < cands.length) return cands[idx];
    return null; // número fora do range = resposta explícita errada, não chuta nome
  }

  // 2) "dinheiro" explícito casa o candidato cash
  if (CASH_RE.test(t)) {
    const cash = cands.find((c) => c.kind === 'cash');
    if (cash) return cash;
  }

  // 3) nome (substring) — escolhe o candidato cujo nome aparece no texto
  const byName = cands.find((c) => c.name && t.includes(String(c.name).toLowerCase()));
  return byName || null;
}

module.exports = { matchSourceReply };
```

- [ ] **Step 4: Rodar — deve passar**

Run: `node --test src/finance/source-match.test.js`
Expected: PASS (todos).

- [ ] **Step 5: Commit**

```bash
git add src/finance/source-match.js src/finance/source-match.test.js
git commit -m "feat(finance): matcher puro de resposta de fonte (list + binary)"
```

---

## Task R4: `financeiro-service.js` — suporte a `is_primary`

**Files:**
- Modify: `src/services/financeiro-service.js` (listAccounts ~24-30, createAccount ~17-23, exports ~416)

- [ ] **Step 1: `listAccounts` retorna `is_primary`**

Trocar o `.select(...)` de listAccounts:
```js
async function listAccounts(collaboratorId) {
  const { data, error } = await supabase.from('pf_accounts')
    .select('id, name, type, balance, icon, is_primary')
    .eq('collaborator_id', collaboratorId).eq('is_active', true).order('name');
  if (error) throw error;
  return data || [];
}
```

- [ ] **Step 2: `createAccount` aceita `is_primary`**

```js
async function createAccount(collaboratorId, { name, type = 'checking', icon, goal_monthly, is_primary = false }) {
  const { data, error } = await supabase.from('pf_accounts')
    .insert({ collaborator_id: collaboratorId, name, type, icon, goal_monthly, is_primary })
    .select().single();
  if (error) throw error;
  return data;
}
```

- [ ] **Step 3: Adicionar `findPrimaryAccount` e `setPrimaryAccount`**

Inserir logo após `ensureDinheiro` (linha ~46):
```js
// Conta principal (default silencioso pra transações sem fonte explícita).
async function findPrimaryAccount(collaboratorId) {
  const accounts = await listAccounts(collaboratorId);
  const primary = accounts.find((a) => a.is_primary);
  if (primary) return primary;
  // Sem principal explícita: se há exatamente 1 carteira, ela é a principal de fato.
  return accounts.length === 1 ? accounts[0] : null;
}

// Define `id` como única principal do colaborador (zera as outras antes).
async function setPrimaryAccount(collaboratorId, id) {
  await supabase.from('pf_accounts')
    .update({ is_primary: false })
    .eq('collaborator_id', collaboratorId).eq('is_primary', true);
  const { data, error } = await supabase.from('pf_accounts')
    .update({ is_primary: true })
    .eq('collaborator_id', collaboratorId).eq('id', id)
    .select().single();
  if (error) throw error;
  return data;
}
```

- [ ] **Step 4: Exportar os novos**

No `module.exports`, na linha de carteiras, adicionar `findPrimaryAccount, setPrimaryAccount`:
```js
  createAccount, listAccounts, findAccountByName, ensureDinheiro, resolveSource,
  findPrimaryAccount, setPrimaryAccount,
```

- [ ] **Step 5: Syntax check**

Run: `node --check src/services/financeiro-service.js`
Expected: sem erro.

- [ ] **Step 6: Commit**

```bash
git add src/services/financeiro-service.js
git commit -m "feat(finance): is_primary em listAccounts/createAccount + find/setPrimaryAccount"
```

---

## Task R5: `finance-format.js` — `assumedSource` em `buildTxnConfirmation`

**Files:**
- Modify: `src/services/finance-format.js` (buildTxnConfirmation)
- Modify: `src/services/finance-format.test.js`

Quando o engine grava na conta principal sem a pessoa ter dito a fonte, a confirmação tem que **nomear** a principal assumida (spec §1.2 / 1b do advisor).

- [ ] **Step 1: Teste (falhando)**

Adicionar em `finance-format.test.js`:
```js
test('assumedSource: nomeia a principal assumida antes do footer', () => {
  const card = buildTxnConfirmation({
    type:'expense', description:'Uber', amount:30, categoryLabel:'Transporte',
    account:{name:'Itaú', icon:'🧡'}, newBalance:-30, budgetBlock:null,
    assumedSource:'Itaú', footer:'_💡 dica_',
  });
  assert.match(card, /conta principal \(Itaú\)/i);
  assert.ok(card.indexOf('conta principal') < card.indexOf('_💡 dica_'), 'nota vem antes do footer');
});
test('sem assumedSource: nada de "conta principal"', () => {
  const card = buildTxnConfirmation({
    type:'expense', description:'Uber', amount:30, categoryLabel:'Transporte',
    account:{name:'Itaú', icon:'🧡'}, newBalance:-30, budgetBlock:null, footer:'_x_',
  });
  assert.doesNotMatch(card, /conta principal/i);
});
```

- [ ] **Step 2: Rodar — falha**

Run: `node --test src/services/finance-format.test.js`
Expected: FAIL (assumedSource não renderiza).

- [ ] **Step 3: Implementar**

Em `buildTxnConfirmation`, aceitar `assumedSource` e inseri-lo na cauda, imediatamente antes do `footer`. Localize a montagem do array de linhas/seções; adicione, na seção final (antes do footer):
```js
function buildTxnConfirmation({ type, description, amount, categoryLabel, account, newBalance, budgetBlock, assumedSource, footer }) {
  // ... (montagem existente do header + atributos + saldo) ...
  const tail = [];
  if (budgetBlock) tail.push(budgetBlock);
  if (assumedSource) tail.push(`_lancei na sua conta principal (${assumedSource})_`);
  if (footer) tail.push(footer);
  // ... junta seções com SEP como já faz hoje ...
}
```
> Adapte à estrutura real da função (ela já compõe header → SEP → atributos → SEP → saldo → footer). O `assumedSource` entra na MESMA seção de cauda do footer/budget, antes do footer.

- [ ] **Step 4: Rodar — passa (sem regressão)**

Run: `node --test src/services/finance-format.test.js src/finance/source.test.js src/finance/source-match.test.js`
Expected: PASS (todos).

- [ ] **Step 5: Commit**

```bash
git add src/services/finance-format.js src/services/finance-format.test.js
git commit -m "feat(finance): buildTxnConfirmation nomeia a conta principal assumida"
```

---

## Task R6: Engine — extrair `writeCashTransaction` (helper reusável)

**Files:**
- Modify: `src/engine.js` (case `register_transaction` ~5956-5984; novo helper perto de `recordCardPurchase` ~5916)

Hoje a escrita de transação de caixa + bloco de orçamento + confirmação está inline no case. O consumidor determinístico do turno-2 (R8) precisa da mesma escrita. Extrair pra um helper único (DRY).

- [ ] **Step 1: Criar o helper `writeCashTransaction`**

Inserir logo após `recordCardPurchase` (linha ~5927):
```js
// Escreve transação de caixa + bloco de orçamento + confirmação. Fonte garantida (account).
// assumedSource: nome da principal quando foi default silencioso (nomeia na confirmação).
async function writeCashTransaction(cid, { type, category, amount, description, date, account, assumedSource }) {
  const financeFmt = require('./services/finance-format');
  const prev = type === 'expense' ? await financeService.monthCategoryTotal(cid, category) : 0;
  await financeService.insertTransaction(cid, { type, category, amount, description, transaction_date: date, account_id: account.id });

  let budgetBlock = null;
  if (type === 'expense') {
    const limit = await financeService.getBudget(cid, category);
    if (limit) {
      const novo = prev + Number(amount);
      const pct = Math.round((novo / limit) * 100);
      const m = financeFmt.CAT_META[category] || { label: category };
      budgetBlock = `📊 ${m.label}: ${financeFmt.money(novo)} / ${financeFmt.money(limit)} (${pct}%)`;
      const cruzou = crossedThreshold(prev, novo, limit);
      if (cruzou) budgetBlock += `\n${buildBudgetAlert(category, novo, limit, cruzou)}`;
    }
  }

  const meta = financeFmt.CAT_META[category] || { emoji: '📦', label: category };
  const newBalance = Number(account.balance) + (type === 'income' ? Number(amount) : -Number(amount));
  const footer = financeFmt.buildTxnFooter({ categoryMissing: category === 'outros', accountLinked: true, tipSeed: new Date().getUTCDate(), type });
  return financeFmt.buildTxnConfirmation({
    type, description, amount: Number(amount),
    categoryLabel: meta.label,
    account: { name: account.name, icon: account.icon },
    newBalance, budgetBlock, assumedSource, footer,
  });
}
```

- [ ] **Step 2: Substituir o corpo inline do case pelo helper**

No case `register_transaction`, trocar o bloco "src.kind === 'account'" (linhas ~5956-5984) por:
```js
      // src.kind === 'account' → transação de caixa, fonte garantida
      return await writeCashTransaction(cid, {
        type, category, amount: p.amount, description: p.description, date: p.date, account: src.account,
      });
```

- [ ] **Step 3: Syntax check + suíte**

Run: `node --check src/engine.js`
Expected: sem erro. (Comportamento idêntico ao anterior — refactor puro.)

- [ ] **Step 4: Commit**

```bash
git add src/engine.js
git commit -m "refactor(engine): extrai writeCashTransaction (reuso turno-1 e turno-2)"
```

---

## Task R7: Engine — roteamento novo no `register_transaction` (primary + pending + coach)

**Files:**
- Modify: `src/engine.js` (case `register_transaction` ~5936-5954)

Substituir o ramo `none` por: principal silenciosa → pergunta+pending → coach. E `ambiguous` abre pending binário.

- [ ] **Step 1: Reescrever o roteamento**

Trocar do `const src = ...` até o fim do ramo `none` (linhas ~5943-5954) por:
```js
      const pendingIntents = require('./services/pending-intents');
      const src = srcName ? await financeService.resolveSource(cid, srcName) : { kind: 'none' };

      // Colisão carteira×cartão → pendência binária (cartão ou conta?)
      if (src.kind === 'ambiguous') {
        await pendingIntents.openIntent(cid, 'finance_source', {
          form: 'binary',
          txn: { type, category, amount: Number(p.amount), description: p.description, date: p.date },
          account: { kind: 'account', id: src.account.id, name: src.account.name },
          card: { kind: 'card', id: src.card.id, name: src.card.name },
        }, `${src.account.name}: cartão ou conta?`);
        return `🤔 *${src.account.name}* é carteira e cartão. Foi no *cartão* ou na *conta*?`;
      }

      // Cartão + despesa → fatura
      if (src.kind === 'card' && type === 'expense') {
        return await recordCardPurchase(cid, src.card, { amount: p.amount, description: p.description, category, installments: params.installments, date: p.date });
      }

      // Fonte explícita resolvida em carteira → grava
      if (src.kind === 'account') {
        return await writeCashTransaction(cid, {
          type, category, amount: p.amount, description: p.description, date: p.date, account: src.account,
        });
      }

      // Daqui pra baixo: sem fonte resolvível (none, ou cartão numa receita).
      // 1) Conta principal → grava silencioso MAS nomeia a principal.
      const primary = await financeService.findPrimaryAccount(cid);
      if (primary) {
        return await writeCashTransaction(cid, {
          type, category, amount: p.amount, description: p.description, date: p.date,
          account: primary, assumedSource: primary.name,
        });
      }

      // 2) Tem contas (≥2, sem principal) → pergunta + pending-state.
      const accounts = src.accounts || await financeService.listAccounts(cid);
      const cards = src.cards || await financeService.listCards(cid);
      if (accounts.length > 0) {
        const candidates = [
          ...accounts.map((a) => ({ kind: 'account', id: a.id, name: a.name })),
          ...(type === 'expense' ? cards.map((c) => ({ kind: 'card', id: c.id, name: c.name })) : []),
          { kind: 'cash', id: null, name: 'Dinheiro' },
        ];
        const question = financeFmt.buildSourceQuestion({ type, amount: Number(p.amount), accounts, cards });
        await pendingIntents.openIntent(cid, 'finance_source', {
          form: 'list',
          txn: { type, category, amount: Number(p.amount), description: p.description, date: p.date },
          candidates,
        }, question);
        return question;
      }

      // 3) 0 contas cadastradas → NÃO grava → coaching pro app (TOM Coach P6).
      return `Pra eu manter seu saldo certinho, preciso saber de onde saiu/entrou 💡\n\nCadastra suas contas e cartões no app primeiro — *Finanças → Carteiras / Cartões*. Aí é só me mandar "gastei 45" que eu já sei de onde tirar. (Pra gasto em espécie, é só dizer "em dinheiro".)`;
```

> Nota 1: o caso "em dinheiro" com 0 contas NÃO cai aqui — `resolveSource` resolve `cash` → `ensureDinheiro` → `src.kind==='account'` (grava no passo "Fonte explícita"). O coach (passo 3) só dispara sem fonte alguma.
> Nota 2: invariante "1 fonte pendente por pessoa" é **automático** — `openIntent` já supersede qualquer intent aberta do mesmo kind (`finance_source`) do mesmo colaborador antes de inserir a nova (pending-intents.js, supersede same-kind). Não precisa de código extra.

- [ ] **Step 2: Syntax check**

Run: `node --check src/engine.js`
Expected: sem erro.

- [ ] **Step 3: Commit**

```bash
git add src/engine.js
git commit -m "feat(engine): roteamento fonte — principal silenciosa, pending-state, coach 0-contas"
```

---

## Task R8: Engine — consumidor determinístico do `finance_source` pending (turno-2)

**Files:**
- Modify: `src/engine.js` (inserir bloco antes do bloco pending-intents existente, ~6205)
- Modify: `src/services/pending-intents.js` (VALID_KINDS)

Quando há `finance_source` aberto e a resposta casa um candidato, o **engine grava direto** (bypass do LLM) — sem fabricação, sem perda no fallback.

- [ ] **Step 1: `VALID_KINDS` aceita `finance_source`**

Em `src/services/pending-intents.js` linha 15:
```js
const VALID_KINDS = new Set(['task_creation','event_creation','approval_pending','confirmation','finance_source']);
```

- [ ] **Step 2: Inserir o consumidor determinístico**

Em `src/engine.js`, logo após `await logConversation(collab.id, 'inbound', text);` (linha ~6203) e ANTES do bloco "Sprint 30.3 — Pending Intents" (~6205):
```js
  // ---- Fonte obrigatória: resolução determinística do pending finance_source ----
  // Se TOM perguntou "saiu de qual conta?" (intent finance_source aberta) e o user
  // respondeu uma fonte ("2"/"nubank"/"dinheiro"/"cartão"), o ENGINE grava a
  // transação pendente sem passar pelo LLM (não fabrica, não perde no fallback).
  try {
    const { matchSourceReply } = require('./finance/source-match');
    const finOpen = (await pendingIntents.listOpenIntents(collab.id, { limit: 3 }))
      .find((i) => i.kind === 'finance_source' && withinConfirmWindow(i.asked_at, 15));
    if (finOpen) {
      const hit = matchSourceReply(String(text || ''), finOpen.payload);
      if (hit) {
        const txn = finOpen.payload.txn || {};
        let reply;
        let account = null;
        if (hit.kind === 'cash') account = await financeService.ensureDinheiro(collab.id);
        else if (hit.kind === 'account') account = (await financeService.listAccounts(collab.id)).find((a) => a.id === hit.id);

        if (hit.kind === 'card') {
          const card = (await financeService.listCards(collab.id)).find((c) => c.id === hit.id);
          reply = await recordCardPurchase(collab.id, card, {
            amount: txn.amount, description: txn.description, category: txn.category, date: txn.date,
          });
        } else if (account) {
          reply = await writeCashTransaction(collab.id, {
            type: txn.type, category: txn.category, amount: txn.amount,
            description: txn.description, date: txn.date, account,
          });
        }

        if (reply) {
          await pendingIntents.resolveIntent(finOpen.id, 'confirmed', `finance_source matched ${hit.kind}`);
          await whatsapp.sendMessage(phone, reply);
          await logConversation(collab.id, 'outbound', reply);
          console.log(`[Engine] processMessage DONE phone=${_phoneTail} in=${Date.now()-_t0}ms (finance_source_resolved)`);
          return;
        }
      }
      // não casou → deixa a intent aberta (expira sozinha); segue fluxo normal.
    }
  } catch (e) {
    console.warn('[FinanceSource] consumer err:', e.message);
  }
```

> `withinConfirmWindow` já existe no engine (usado no bloco pending-intents). `category` no payload já vem resolvido do turno-1 (ramo none calculou `category`).

- [ ] **Step 3: Syntax check**

Run: `node --check src/engine.js && node --check src/services/pending-intents.js`
Expected: sem erro.

- [ ] **Step 4: Commit**

```bash
git add src/engine.js src/services/pending-intents.js
git commit -m "feat(engine): consumidor determinístico de finance_source (grava sem LLM)"
```

---

## Task R9: Skill `financeiro-pessoal.md` — emissão imperativa

**Files:**
- Modify: `skills/financeiro-pessoal.md` (bullet do `register_transaction` ~38)

Fecha o ponto mole do turno-1 (spec §1a): o LLM SEMPRE emite o marker, mesmo sem fonte.

- [ ] **Step 1: Reescrever a regra de fonte**

Substituir o bullet `register_transaction` (linha 38) por:
```markdown
- `register_transaction` — params: type (income|expense), category, amount, description, date(opcional), account_name(**fonte — de onde saiu / em que conta caiu**). Passe o nome dito ("Nubank", "Itaú", "dinheiro"); o engine resolve se é carteira ou cartão.
  - 🚨 **SEMPRE emita o marker, mesmo SEM a fonte.** Se a pessoa não disse de onde saiu (ou disse só um método: "pix", "débito", "transferência", "boleto"), emita `register_transaction` **sem** `account_name`. **NUNCA pergunte de boca "saiu de qual conta?" e NUNCA escreva uma confirmação** ("✅ registrado…") — quem pergunta a fonte e quem confirma é o ENGINE. Você só emite o marker; o engine decide gravar (na conta principal), perguntar (lista de contas) ou orientar (cadastrar no app).
  - Métodos ("pix"/"débito"/"transferência") **não são conta** → emita sem `account_name`. A natureza do gasto vira `category` ("outros" se não houver) — a fonte NUNCA vira categoria.
```

- [ ] **Step 2: Conferir que a regra antiga de "perguntar de boca" saiu**

Run:
```bash
grep -n "NÃO emita o marker\|pergunte (\"saiu" skills/financeiro-pessoal.md
```
Expected: sem matches (a instrução antiga "NÃO emita o marker" foi removida).

- [ ] **Step 3: Commit**

```bash
git add skills/financeiro-pessoal.md
git commit -m "feat(skill): emissão imperativa — sempre emitir marker, engine pergunta a fonte"
```

---

## Task R10: TOM Coach — P6 financeiro

**Files:**
- Modify: `skills/coach-usabilidade.md` (após P5, antes do "## Resumo" ~93)

- [ ] **Step 1: Adicionar o padrão P6**

Inserir antes de `## Resumo`:
```markdown
### P6 — Tenta lançar finanças sem ter conta cadastrada
- **Reconhecer:** a pessoa fala de gasto/receita ("gastei 50", "recebi 2000") mas
  ainda **não tem nenhuma conta/cartão cadastrado** no app — então o TOM não tem
  onde ancorar o lançamento (o engine sinaliza que não há fonte).
- **Fala-modelo:** "Pra eu manter seu saldo certinho, cadastra suas contas e cartões
  no app primeiro — *Finanças → Carteiras / Cartões*. É lá a fonte de verdade. Aí é
  só me mandar 'gastei 45' que eu já sei de onde tirar. (Gasto em espécie? Só dizer
  'em dinheiro'.)"
- **Por quê:** o app é a fonte de verdade da estrutura financeira. Sem conta, o saldo
  fica furado — melhor conduzir ao cadastro certo do que registrar solto.
- **Quando NÃO acionar:** se a pessoa já tem conta cadastrada (aí o engine resolve ou
  pergunta a fonte sozinho); se ela disse "em dinheiro" (o engine cria a carteira
  Dinheiro automaticamente); se já orientou isso recentemente.
```

- [ ] **Step 2: Commit**

```bash
git add skills/coach-usabilidade.md
git commit -m "feat(coach): P6 — orientar cadastro no app quando não há conta"
```

---

## Task R11: `system.js` — marcar a conta principal na injeção

**Files:**
- Modify: `src/prompts/system.js` (bloco FINANCE_RE ~807-818)

- [ ] **Step 1: Anotar qual fonte é a principal**

No bloco que monta `linhas` (Fontes deste usuário), marcar a principal com ⭐ pra o LLM não perguntar à toa. Localize a montagem de `linhas` a partir de `financeService.listAccounts` (linha ~811) e ajuste o map das carteiras:
```js
      const linhas = [
        ...accounts.map((a) => `• ${a.icon || '🏦'} ${a.name}${a.is_primary ? ' ⭐ (principal)' : ''} (carteira)`),
        ...cards.map((c) => `• 💳 ${c.name} (cartão)`),
      ];
```
> Adapte ao formato atual das linhas (preserve o que já existe; só acrescente o sufixo ⭐ na principal). Mantém a regra "NUNCA cite saldo".

- [ ] **Step 2: Syntax check**

Run: `node --check src/prompts/system.js`
Expected: sem erro.

- [ ] **Step 3: Commit**

```bash
git add src/prompts/system.js
git commit -m "feat(prompt): marca a conta principal (⭐) na injeção de fontes"
```

---

## Task R12: PWA — toggle "conta principal" em Carteiras

**Files:**
- Modify: `web/src/lib/financeiro.ts` (PfAccount ~16, listAccounts ~48, novo setPrimaryAccount)
- Modify: `web/src/hooks/useFinanceiro.ts` (novo `useSetPrimaryAccount`)
- Modify: `web/src/screens/financeiro/CarteirasPage.tsx` (botão estrela por carteira)

- [ ] **Step 1: `lib/financeiro.ts` — tipo + select + setter**

`PfAccount` (linha ~16) ganha `is_primary`:
```ts
export interface PfAccount { id: string; name: string; type: PfAccountType; balance: number; icon: string | null; is_primary: boolean; }
```
`listAccounts` (linha ~48) — incluir `is_primary` no `.select(...)` (acrescente `, is_primary` à lista de colunas).
Adicionar a função (após `deactivateAccount`):
```ts
export async function setPrimaryAccount(collaboratorId: string, id: string) {
  await supabase.from('pf_accounts')
    .update({ is_primary: false })
    .eq('collaborator_id', collaboratorId).eq('is_primary', true);
  const { error } = await supabase.from('pf_accounts')
    .update({ is_primary: true })
    .eq('collaborator_id', collaboratorId).eq('id', id);
  if (error) throw error;
}
```

- [ ] **Step 2: Hook `useSetPrimaryAccount`**

Em `web/src/hooks/useFinanceiro.ts`, o padrão real é `useFinMutation` (helper que injeta `cid` via `useFinanceiroAuth()` e invalida a KEY `['financeiro']` inteira no sucesso). Adicionar junto das outras mutations de conta (após `useDeactivateAccount`, linha ~103):
```ts
export const useSetPrimaryAccount = () => useFinMutation((cid, id: string) => fin.setPrimaryAccount(cid, id));
```
> `fin` é o namespace já importado de `../lib/financeiro` (mesmo usado em `fin.createAccount`). Invalidar a KEY inteira garante que a lista de carteiras re-renderiza com a nova principal.

- [ ] **Step 3: `CarteirasPage.tsx` — botão estrela**

Em cada item de carteira, adicionar um botão que chama o hook. Estado visual: ⭐ preenchida = principal; ☆ = define como principal.
```tsx
// no topo:
import { useSetPrimaryAccount } from '../../hooks/useFinanceiro';
// dentro do componente:
const setPrimary = useSetPrimaryAccount();
// no render de cada carteira (acct), ao lado do nome:
<button
  type="button"
  onClick={() => setPrimary.mutate(acct.id)}
  disabled={setPrimary.isPending || acct.is_primary}
  aria-label={acct.is_primary ? 'Conta principal' : 'Definir como principal'}
  title={acct.is_primary ? 'Conta principal' : 'Definir como principal'}
  className="text-lg shrink-0 focus-ring rounded-full px-1"
>
  {acct.is_primary ? '⭐' : '☆'}
</button>
```
> Adapte ao JSX real do item (nome da variável do map, layout). A estrela fica ao lado do nome/ícone.

- [ ] **Step 4: TypeScript check + build**

Run:
```bash
cd web && npx tsc --noEmit && npx vite build
```
Expected: sem erros de tipo; build OK.

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/financeiro.ts web/src/hooks/useFinanceiro.ts web/src/screens/financeiro/CarteirasPage.tsx
git commit -m "feat(pwa): toggle conta principal (is_primary) em Carteiras"
```

---

## Task R13: Verificar completude do cadastro PWA (cartões + contas fixas)

**Files:** nenhum (auditoria; se houver gap, vira sub-tarefa).

- [ ] **Step 1: Conferir form de Cartão**

Abrir o sheet de cartão no PWA (Finanças → Cartões). Confirmar que o form cria com **limite, dia de fechamento, dia de vencimento, bandeira**.
- Se faltar algum campo → anotar gap e abrir sub-tarefa (fora deste plano se for grande).

- [ ] **Step 2: Conferir Contas Fixas**

Abrir Finanças → Contas fixas. Confirmar criar/editar bill (nome, valor, dia, categoria).

- [ ] **Step 3: Registrar veredito**

Anotar no PR/commit: "cadastro PWA completo o suficiente pro rollout" OU lista de gaps. (Pré-requisito do broadcast do Alf.)

---

## Task R14: Deploy engine + skills

**Files:** deploy (scp + pm2). Web já vai pelo auto-deploy hook.

- [ ] **Step 1: SCP dos arquivos do engine + skills**

```bash
scp D:/la-organizer/_remote/src/finance/source-match.js tom:/opt/LA-Organizer/src/finance/source-match.js
scp D:/la-organizer/_remote/src/services/financeiro-service.js tom:/opt/LA-Organizer/src/services/financeiro-service.js
scp D:/la-organizer/_remote/src/services/finance-format.js tom:/opt/LA-Organizer/src/services/finance-format.js
scp D:/la-organizer/_remote/src/services/pending-intents.js tom:/opt/LA-Organizer/src/services/pending-intents.js
scp D:/la-organizer/_remote/src/engine.js tom:/opt/LA-Organizer/src/engine.js
scp D:/la-organizer/_remote/src/prompts/system.js tom:/opt/LA-Organizer/src/prompts/system.js
scp D:/la-organizer/_remote/skills/financeiro-pessoal.md tom:/opt/LA-Organizer/skills/financeiro-pessoal.md
scp D:/la-organizer/_remote/skills/coach-usabilidade.md tom:/opt/LA-Organizer/skills/coach-usabilidade.md
```

- [ ] **Step 2: Restart + confirmar online**

```bash
ssh tom "pm2 restart tom && sleep 2 && pm2 logs tom --lines 5 --nostream"
```
Expected: processo online, sem stacktrace no boot.

---

## Task R15: Smoke E2E (bateria WhatsApp) + verificação de saldo

**Files:** nenhum (teste manual + queries). Alf manda as mensagens; checar logs/DB.

Pré-condição: criar via PWA 2 carteiras (ex: Itaú, Bradesco) SEM marcar principal, e 1 cartão Nubank — pra exercitar todos os ramos. Depois marcar Itaú como principal pra os testes de default.

- [ ] **Step 1: Rodar a bateria (11 casos da spec)**

1. "gastei 45 no nubank com lazer" → cartão → fatura (não mexe no saldo de caixa)
2. (Itaú principal) "paguei uber 30 no pix" → grava no Itaú **e nomeia** ("_lancei na sua conta principal (Itaú)_")
3. (sem principal: desmarcar) "paguei uber 30 no pix" → pergunta lista → responder "2" → engine grava (log `finance_source_resolved`)
4. "gastei 20 em dinheiro" (com/sem contas) → cria/usa Dinheiro, debita
5. "recebi 2000 de extra" sem fonte (sem principal) → "💰 caiu em qual conta?" (cartão fora da lista)
6. criar carteira "Nubank" (colisão com o cartão) → "gastei 10 no nubank" → "cartão ou conta?" → responder "cartão" → grava na fatura
7. (apagar todas as contas) "gastei 50" → não grava → TOM Coach P6 manda cadastrar no app
8. conferir nos logs que nenhuma resposta de fonte virou texto fabricado do LLM

- [ ] **Step 2: Verificar ACTIONABLE_NO_MARKER (regressão)**

```sql
SELECT count(*) FROM marker_logs
WHERE collaborator_id='0576f4b6-183d-4cf1-980e-5c8d5da0177f'
  AND marker_type='ACTIONABLE_NO_MARKER'
  AND created_at > now() - interval '1 hour';
```
Expected: 0 (o LLM emitiu marker em todos os casos financeiros da bateria). Se >0, revisar a skill R9.

- [ ] **Step 3: Verificar invariante anti-órfã**

```sql
SELECT count(*) FROM pf_transactions
WHERE collaborator_id='0576f4b6-183d-4cf1-980e-5c8d5da0177f'
  AND created_at > now() - interval '1 hour'
  AND account_id IS NULL AND card_id IS NULL;
```
Expected: 0 (nenhuma transação nova ficou órfã).

- [ ] **Step 4: Conferir saldo no PWA**

Abrir Finanças no PWA, confirmar que os saldos batem com os lançamentos da bateria (sem furo).

---

## Task R16: Limpar as 9 órfãs de teste (requer OK explícito do Alf)

**Files:** DELETE em produção (execute_sql). ⚠️ **CLAUDE.md: deletar dado em produção exige OK explícito.**

- [ ] **Step 1: Mostrar o que será deletado**

```sql
SELECT id, type, category, amount, description, created_at
FROM pf_transactions
WHERE collaborator_id='0576f4b6-183d-4cf1-980e-5c8d5da0177f'
  AND account_id IS NULL AND card_id IS NULL
ORDER BY created_at;
```
Expected: 9 linhas (R$7000 receita + R$445 despesa).

- [ ] **Step 2: PEDIR OK EXPLÍCITO ao Alf** (não prosseguir sem "pode deletar").

- [ ] **Step 3: Deletar (só após OK)**

```sql
DELETE FROM pf_transactions
WHERE collaborator_id='0576f4b6-183d-4cf1-980e-5c8d5da0177f'
  AND account_id IS NULL AND card_id IS NULL;
```

- [ ] **Step 4: Confirmar zerado**

```sql
SELECT count(*) FROM pf_transactions
WHERE collaborator_id='0576f4b6-183d-4cf1-980e-5c8d5da0177f'
  AND account_id IS NULL AND card_id IS NULL;
```
Expected: 0.

---

## Notas de execução
- **ACTIONABLE_NO_MARKER como safety-net forte** (spec §1a): por ora fica como **métrica de regressão** (R15 Step 2). Confirmado (2026-05-31) que o engine persiste via `logMarker(... 'ACTIONABLE_NO_MARKER' ...)` em `marker_logs` (linha ~8184) — logo a métrica é consultável por SQL, não só console. Promover a ação automática (engine força a pergunta de fonte quando detecta utterance financeira sem marker) só se a bateria mostrar reincidência — evita complexidade especulativa (YAGNI).
- **Símbolos do engine reusados** (verificados no código atual): `srcName` (def. ~5940, NÃO `acctName`), `CAT_META`, `crossedThreshold`, `buildBudgetAlert`, `recordCardPurchase`, `withinConfirmWindow`, `mapCategory`, `normalizeParams` — todos já existem; os helpers novos (`writeCashTransaction`) são declarações `async function` em nível de módulo (hoisted), acessíveis tanto no case quanto no consumidor turno-2.
- **TTL da pendência:** 15 min (`withinConfirmWindow(asked_at, 15)` no R8). Fora disso a intent fica aberta e expira pelo cron de `expireOldIntents`.
- **Ordem de deploy:** migrations (R1, R2) ANTES do SCP do engine (R14), senão `is_primary`/`finance_source` quebram em runtime.
