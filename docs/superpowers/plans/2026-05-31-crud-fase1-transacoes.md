# CRUD Fase 1 — Transações (PWA editar/excluir + TOM corrige/exclui/lê) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dar CRUD completo de transações — no PWA editar/excluir qualquer lançamento; no TOM corrigir/excluir o lançamento recente ("era 2900"/"exclui essa") e listar/consultar ("últimas", "quanto gastei em X") — fazendo a promessa morta do rodapé virar real, sem nunca desbalancear o saldo.

**Architecture:** PWA reusa o `TransactionSheet` em modo edição (novo `updateTransaction` no lib + hook); o trigger `pf_sync_account_balance` reajusta saldo no UPDATE/DELETE (nada manual). O TOM ganha 3 actions determinísticas (`edit_transaction`/`delete_transaction`/`query_transactions`); um resolvedor de alvo puro (`txn-target.js`, espelha `source-match.js`) decide qual transação, com pending-intent pra ambiguidade. Compra de cartão (parcela) é tratada pelo `purchase_group`.

**Tech Stack:** React+TS+Tailwind (PWA, valida `tsc`+`vite build`+preview), Node CommonJS (engine, deploy via scp+pm2), node:test (lógica pura), Supabase Postgres (migration via apply_migration).

---

## File Structure

**PWA:**
- `web/src/lib/financeiro.ts` *(modifica)* — `PfTransaction` ganha `purchase_group`; novo `updateTransaction(cid, id, patch)`.
- `web/src/hooks/useFinanceiro.ts` *(modifica)* — `useUpdateTransaction`.
- `web/src/screens/financeiro/components/TransactionSheet.tsx` *(modifica)* — habilita modo edição (salvar update; parcela de cartão = campos limitados).

**Engine/TOM:**
- `src/finance/txn-target.js` *(novo)* — resolvedor puro de alvo ("essa"/descrição/valor + janela). + `.test.js`.
- `src/services/financeiro-service.js` *(modifica)* — `updateTransaction`, `deleteTransaction`, `deleteTransactionGroup`, `listRecentTransactions`, `queryTransactions`.
- `src/engine.js` *(modifica)* — ponteiro do último txn; actions `edit_transaction`/`delete_transaction`/`query_transactions`; pending-intent de desambiguação.
- `src/services/finance-format.js` *(modifica)* — builder `txnList` (resumo de consulta) + confirmações de edit/delete.
- `skills/financeiro-pessoal.md` *(modifica)* — documenta as 3 actions + frases de correção.

**Migration:** `updated_at` em `pf_transactions`.

---

## Task 1: Migration — `updated_at` em `pf_transactions`

**Files:** Supabase migration (apply_migration).

- [ ] **Step 1: Aplicar**

Via MCP `apply_migration` (name: `add_updated_at_pf_transactions`):
```sql
ALTER TABLE pf_transactions ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
```

- [ ] **Step 2: Verificar**
```sql
SELECT column_name FROM information_schema.columns
WHERE table_name='pf_transactions' AND column_name='updated_at';
```
Expected: 1 linha.

---

## Task 2: `txn-target.js` — resolvedor puro de alvo (TDD)

**Files:**
- Create: `src/finance/txn-target.js`
- Test: `src/finance/txn-target.test.js`

Decide QUAL transação o usuário quer corrigir/excluir, dado o texto e a lista de candidatos recentes (já filtrados por janela ~2h pelo chamador). Puro, sem I/O. Espelha o estilo de `src/finance/source-match.js`.

Contrato: `resolveTxnTarget(rawText, candidates) → { kind: 'one', txn } | { kind: 'many', candidates } | { kind: 'none' }`.
- `candidates`: array `{ id, amount, category, description, transaction_date }`, ordenado do mais recente pro mais antigo.
- "essa"/"essa última"/"a última"/vazio → o mais recente (`candidates[0]`).
- valor ("a de 30"/"era 30 reais"/"R$30") → casa por amount; 1 match → one; vários → many.
- nome (substring de description/category) → 1 match → one; vários → many.
- nada casa → none.

- [ ] **Step 1: Escrever os testes (falhando)**

```js
// src/finance/txn-target.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const { resolveTxnTarget } = require('./txn-target');

const cands = [
  { id: 't1', amount: 30, category: 'transporte', description: 'Uber', transaction_date: '2026-05-31' },
  { id: 't2', amount: 80, category: 'alimentacao', description: 'Mercado', transaction_date: '2026-05-31' },
  { id: 't3', amount: 30, category: 'lazer', description: 'Cinema', transaction_date: '2026-05-31' },
];

test('"essa"/vazio → o mais recente', () => {
  assert.deepStrictEqual(resolveTxnTarget('exclui essa', cands), { kind: 'one', txn: cands[0] });
  assert.deepStrictEqual(resolveTxnTarget('', cands), { kind: 'one', txn: cands[0] });
  assert.deepStrictEqual(resolveTxnTarget('apaga a última', cands), { kind: 'one', txn: cands[0] });
});
test('nome único → one', () => {
  assert.deepStrictEqual(resolveTxnTarget('a do mercado', cands), { kind: 'one', txn: cands[1] });
});
test('nome ambíguo / valor repetido → many', () => {
  const r = resolveTxnTarget('a de 30', cands);
  assert.strictEqual(r.kind, 'many');
  assert.strictEqual(r.candidates.length, 2); // t1 e t3 são 30
});
test('valor único → one', () => {
  assert.deepStrictEqual(resolveTxnTarget('era 80', cands), { kind: 'one', txn: cands[1] });
});
test('sem candidatos → none', () => {
  assert.deepStrictEqual(resolveTxnTarget('exclui essa', []), { kind: 'none' });
});
test('texto não relacionado mas com candidatos → ainda assume o recente só com pronome', () => {
  // "muda a categoria pra lazer" sem ref → alvo = recente (o usuário fala do último)
  assert.deepStrictEqual(resolveTxnTarget('muda a categoria pra lazer', cands), { kind: 'one', txn: cands[0] });
});
```

- [ ] **Step 2: Rodar — falha**

Run: `node --test src/finance/txn-target.test.js`
Expected: FAIL (módulo não existe).

- [ ] **Step 3: Implementar**

```js
// src/finance/txn-target.js
// Lógica pura: resolve QUAL transação recente o usuário quer editar/excluir. Sem I/O.
// candidates: [{id, amount, category, description, transaction_date}], recente→antigo.

const PRONOUN_RE = /\b(essa|esse|essa[s]?|a [úu]ltima|o [úu]ltimo|a de cima|essa a[íi])\b/i;

function resolveTxnTarget(rawText, candidates) {
  const cands = Array.isArray(candidates) ? candidates : [];
  if (!cands.length) return { kind: 'none' };
  const t = String(rawText || '').toLowerCase().trim();

  // 1) valor explícito ("a de 30", "era 80", "R$ 30")
  const numMatch = t.match(/\b(?:r\$\s*)?(\d{1,7})(?:[.,]\d{1,2})?\b/);
  if (numMatch) {
    const val = parseInt(numMatch[1], 10);
    const byVal = cands.filter((c) => Math.round(Number(c.amount)) === val);
    if (byVal.length === 1) return { kind: 'one', txn: byVal[0] };
    if (byVal.length > 1) return { kind: 'many', candidates: byVal };
  }

  // 2) nome (substring de descrição ou categoria)
  const byName = cands.filter((c) =>
    (c.description && t.includes(String(c.description).toLowerCase())) ||
    (c.category && t.includes(String(c.category).toLowerCase())));
  if (byName.length === 1) return { kind: 'one', txn: byName[0] };
  if (byName.length > 1) return { kind: 'many', candidates: byName };

  // 3) pronome ("essa"/"a última") OU nenhuma referência → assume o mais recente
  return { kind: 'one', txn: cands[0] };
}

module.exports = { resolveTxnTarget };
```

- [ ] **Step 4: Rodar — passa**

Run: `node --test src/finance/txn-target.test.js`
Expected: PASS (6 testes).

- [ ] **Step 5: Commit**

```bash
git add src/finance/txn-target.js src/finance/txn-target.test.js
git commit -m "feat(finance): resolvedor puro de alvo de transação (edit/delete recente)"
```

---

## Task 3: `financeiro-service.js` — update/delete/query de transação

**Files:** Modify `src/services/financeiro-service.js` (perto de `insertTransaction` ~88; exports ~437)

- [ ] **Step 1: Adicionar as funções**

Inserir após `insertTransaction`:
```js
// Atualiza campos de uma transação. O trigger pf_sync_account_balance reajusta o saldo
// (reverte OLD, aplica NEW) — inclusive se account_id mudar. NÃO mexe em parcela in-place.
async function updateTransaction(collaboratorId, id, patch) {
  const allowed = {};
  for (const k of ['type', 'category', 'amount', 'description', 'transaction_date', 'account_id']) {
    if (patch[k] !== undefined) allowed[k] = patch[k];
  }
  allowed.updated_at = new Date().toISOString();
  const { data, error } = await supabase.from('pf_transactions')
    .update(allowed).eq('id', id).eq('collaborator_id', collaboratorId)
    .select().single();
  if (error) throw error;
  return data;
}

// Deleta uma transação (trigger reverte saldo). Retorna a linha deletada.
async function deleteTransaction(collaboratorId, id) {
  const { data, error } = await supabase.from('pf_transactions')
    .delete().eq('id', id).eq('collaborator_id', collaboratorId)
    .select().single();
  if (error) throw error;
  return data;
}

// Deleta todas as parcelas de uma compra de cartão (mesmo purchase_group).
async function deleteTransactionGroup(collaboratorId, purchaseGroup) {
  const { data, error } = await supabase.from('pf_transactions')
    .delete().eq('collaborator_id', collaboratorId).eq('purchase_group', purchaseGroup)
    .select('id');
  if (error) throw error;
  return (data || []).length;
}

// Transações recentes (janela em horas) pra resolver "essa"/"a do mercado". Mais recente primeiro.
async function listRecentTransactions(collaboratorId, { hours = 2, limit = 10 } = {}) {
  const cutoff = new Date(Date.now() - hours * 3600 * 1000).toISOString();
  const { data, error } = await supabase.from('pf_transactions')
    .select('id, type, category, amount, description, transaction_date, account_id, card_id, purchase_group, installments_total, created_at')
    .eq('collaborator_id', collaboratorId)
    .gte('created_at', cutoff)
    .order('created_at', { ascending: false }).limit(limit);
  if (error) throw error;
  return data || [];
}

// Consulta de leitura ("últimas", "quanto gastei em X"). Filtra por categoria/tipo opcional.
async function queryTransactions(collaboratorId, { category, type, limit = 8 } = {}) {
  let q = supabase.from('pf_transactions')
    .select('id, type, category, amount, description, transaction_date')
    .eq('collaborator_id', collaboratorId)
    .order('transaction_date', { ascending: false }).limit(limit);
  if (category) q = q.eq('category', category);
  if (type) q = q.eq('type', type);
  const { data, error } = await q;
  if (error) throw error;
  return data || [];
}
```

- [ ] **Step 2: Exportar**

No `module.exports`, adicionar:
```js
  updateTransaction, deleteTransaction, deleteTransactionGroup,
  listRecentTransactions, queryTransactions,
```

- [ ] **Step 3: Syntax check**

Run: `node --check src/services/financeiro-service.js`
Expected: sem erro.

- [ ] **Step 4: Commit**

```bash
git add src/services/financeiro-service.js
git commit -m "feat(finance-service): update/delete/group-delete/recent/query de transações"
```

---

## Task 4: Engine — ponteiro do último lançamento

**Files:** Modify `src/engine.js` (helpers `writeCashTransaction` ~5931 e `recordCardPurchase` ~5917)

Pra "essa"/"a última" funcionar mesmo sem o usuário citar nada, guardamos o id do último lançamento. Usamos `listRecentTransactions` (janela 2h) como fonte — então NÃO precisa de coluna nova; o "recente" já é derivável. Esta task só garante que cada escrita retorna/loga o id pra debug (o alvo real vem de `listRecentTransactions`).

- [ ] **Step 1: Garantir que `insertTransaction` no `writeCashTransaction` capture o id**

Em `writeCashTransaction`, a linha que insere hoje é:
```js
  await financeService.insertTransaction(cid, { type, category, amount, description, transaction_date: date, account_id: account.id });
```
Trocar por (captura + log, sem mudar comportamento):
```js
  const _txn = await financeService.insertTransaction(cid, { type, category, amount, description, transaction_date: date, account_id: account.id });
  console.log(`[Finance] txn ${_txn && _txn.id ? _txn.id.slice(0,8) : '?'} registrada cid=${String(cid).slice(0,8)}`);
```

- [ ] **Step 2: Syntax check**

Run: `node --check src/engine.js`
Expected: sem erro.

> Decisão de design (registrada): NÃO criamos coluna "last_txn". O alvo é resolvido por `listRecentTransactions` (janela 2h) + `resolveTxnTarget`. Mais simples e robusto (sobrevive a restart/fallback).

- [ ] **Step 3: Commit**

```bash
git add src/engine.js
git commit -m "chore(engine): loga id da transação registrada (debug do alvo recente)"
```

---

## Task 5: Engine — actions `edit_transaction` / `delete_transaction` / `query_transactions`

**Files:** Modify `src/engine.js` (`FINANCE_ACTIONS` ~5887; `handleFinanceAction` switch)

- [ ] **Step 1: Registrar as actions**

No array `FINANCE_ACTIONS`, adicionar os 3 nomes:
```js
  'edit_transaction', 'delete_transaction', 'query_transactions',
```

- [ ] **Step 2: Adicionar os handlers no switch**

Dentro de `handleFinanceAction`, adicionar 3 cases (perto dos outros). Usam `resolveTxnTarget` + `listRecentTransactions`, com pending-intent pra `many`:
```js
    case 'delete_transaction': {
      const { resolveTxnTarget } = require('../finance/txn-target');
      const pendingIntents = require('./services/pending-intents');
      const recent = await financeService.listRecentTransactions(cid, { hours: 2, limit: 10 });
      if (!recent.length) return 'Não achei lançamento recente pra apagar — pra coisas mais antigas, edita lá no app 🙂';
      const r = resolveTxnTarget(String(params.which || params.ref || ''), recent);
      if (r.kind === 'none') return 'Não achei qual lançamento. Diz o valor ou o nome (ex: "a do mercado").';
      if (r.kind === 'many') {
        await pendingIntents.openIntent(cid, 'finance_source', {
          form: 'txn_pick', op: 'delete',
          candidates: r.candidates.map((c) => ({ kind: 'txn', id: c.id, name: c.description || c.category, purchase_group: c.purchase_group })),
        }, 'Qual lançamento?');
        return financeFmt.txnList('Qual deles?', r.candidates);
      }
      const txn = r.txn;
      let n = 1;
      if (txn.card_id && txn.purchase_group) n = await financeService.deleteTransactionGroup(cid, txn.purchase_group);
      else await financeService.deleteTransaction(cid, txn.id);
      return `🗑️ Apaguei *${txn.description || txn.category}* (${financeFmt.money(Number(txn.amount))})${n > 1 ? ` — ${n} parcelas` : ''}. Saldo reajustado.`;
    }
    case 'edit_transaction': {
      const { resolveTxnTarget } = require('../finance/txn-target');
      const recent = await financeService.listRecentTransactions(cid, { hours: 2, limit: 10 });
      if (!recent.length) return 'Não achei lançamento recente pra corrigir — pra coisas mais antigas, edita no app 🙂';
      const r = resolveTxnTarget(String(params.which || params.ref || ''), recent);
      if (r.kind !== 'one') return 'Qual lançamento? Diz o valor ou o nome (ex: "a do mercado").';
      const txn = r.txn;
      if (txn.card_id && txn.purchase_group && Number(txn.installments_total || 1) > 1 && params.amount !== undefined) {
        return 'Essa é uma compra parcelada no cartão — pra mudar o valor, melhor apagar ("exclui essa") e relançar. Posso ajustar só categoria/descrição.';
      }
      const patch = {};
      if (params.amount !== undefined) patch.amount = Number(params.amount);
      if (params.category) patch.category = params.category;
      if (params.description !== undefined) patch.description = params.description;
      if (params.account_name) {
        const src = await financeService.resolveSource(cid, params.account_name);
        if (src.kind === 'account') patch.account_id = src.account.id;
      }
      if (!Object.keys(patch).length) return 'O que você quer corrigir? (valor, categoria, descrição ou conta)';
      const updated = await financeService.updateTransaction(cid, txn.id, patch);
      const meta = financeFmt.CAT_META[updated.category] || { label: updated.category };
      return `✏️ Corrigido: *${updated.description || meta.label}* — ${financeFmt.money(Number(updated.amount))} · ${meta.label}. Saldo reajustado.`;
    }
    case 'query_transactions': {
      const cat = params.category || null;
      const rows = await financeService.queryTransactions(cid, { category: cat, type: params.type || null, limit: params.limit || 8 });
      if (!rows.length) return cat ? `Não achei gastos em ${cat} nesse período.` : 'Não achei lançamentos.';
      return financeFmt.txnList(cat ? `Seus últimos de ${cat}:` : 'Seus últimos lançamentos:', rows);
    }
```

- [ ] **Step 3: Estender o consumidor `finance_source` pra `txn_pick`**

No bloco consumidor determinístico (perto de `matchSourceReply`), após o tratamento de fonte, adicionar: se a intent aberta tem `form === 'txn_pick'`, casar a resposta (número/nome) contra `candidates` e executar a `op` (`delete`). Inserir dentro do `if (finOpen)`, antes do match de fonte:
```js
      if (finOpen.payload && finOpen.payload.form === 'txn_pick') {
        const { matchSourceReply } = require('./finance/source-match');
        const pick = matchSourceReply(String(text || ''), { form: 'list', candidates: finOpen.payload.candidates });
        if (pick) {
          let reply;
          if (finOpen.payload.op === 'delete') {
            if (pick.purchase_group) { const n = await financeService.deleteTransactionGroup(collab.id, pick.purchase_group); reply = `🗑️ Apaguei *${pick.name}* — ${n} parcelas. Saldo reajustado.`; }
            else { await financeService.deleteTransaction(collab.id, pick.id); reply = `🗑️ Apaguei *${pick.name}*. Saldo reajustado.`; }
          }
          if (reply) {
            try { await pendingIntents.resolveIntent(finOpen.id, 'confirmed', 'txn_pick'); await whatsapp.sendMessage(phone, reply); await logConversation(collab.id, 'outbound', reply); } catch (e) { console.warn('[TxnPick] post err:', e.message); }
            console.log(`[Engine] processMessage DONE phone=${_phoneTail} in=${Date.now()-_t0}ms (txn_pick_resolved)`);
            return;
          }
        }
      }
```

- [ ] **Step 4: Syntax check**

Run: `node --check src/engine.js`
Expected: sem erro.

- [ ] **Step 5: Commit**

```bash
git add src/engine.js
git commit -m "feat(engine): edit/delete/query_transactions + desambiguação txn_pick"
```

---

## Task 6: `finance-format.js` — builder `txnList` + footer real

**Files:** Modify `src/services/finance-format.js` (+ test)

- [ ] **Step 1: Teste do `txnList` (falhando)**

Adicionar em `src/services/finance-format.test.js`:
```js
const { txnList } = require('./finance-format');
test('txnList: título + linhas numeradas com valor e descrição', () => {
  const s = txnList('Seus últimos:', [
    { amount: 30, category: 'transporte', description: 'Uber', transaction_date: '2026-05-31' },
    { amount: 80, category: 'alimentacao', description: null, transaction_date: '2026-05-30' },
  ]);
  assert.match(s, /Seus últimos:/);
  assert.match(s, /1[️⃣.\)]?\s/);
  assert.match(s, /Uber/);
  assert.match(s, /R\$ 30,00/);
  assert.match(s, /Alimentação|alimentacao/);
});
```

- [ ] **Step 2: Rodar — falha**

Run: `node --test src/services/finance-format.test.js`
Expected: FAIL (`txnList` não existe).

- [ ] **Step 3: Implementar `txnList` + exportar**

Adicionar antes do `module.exports`:
```js
// Lista curta de transações (consulta / desambiguação). rows: {amount, category, description, transaction_date}.
const NUM_EMOJI = ['1️⃣','2️⃣','3️⃣','4️⃣','5️⃣','6️⃣','7️⃣','8️⃣','9️⃣','🔟'];
function txnList(title, rows) {
  const lines = (rows || []).slice(0, 10).map((r, i) => {
    const meta = CAT_META[r.category] || { emoji: '📦', label: r.category };
    const desc = r.description || meta.label;
    const sign = r.type === 'income' ? '+' : '−';
    return `${NUM_EMOJI[i] || (i + 1) + '.'} ${meta.emoji} ${desc} — *${sign}${money(Number(r.amount))}* _(${r.transaction_date})_`;
  });
  return `${title}\n${SEP}\n${lines.join('\n')}`;
}
```
E no `module.exports`, adicionar `txnList`.

- [ ] **Step 4: Footer do `txnRegistered` agora é real (sem mudança de texto)**

O texto `💡 _Quer ajustar? "era 2.900" · "exclui essa"_` (linha ~28) **permanece** — agora `edit_transaction`/`delete_transaction` o sustentam. Nenhuma edição necessária aqui; só confirmar que continua. (Sem alteração de código nesta sub-step — verificação.)

- [ ] **Step 5: Rodar — passa**

Run: `node --test src/services/finance-format.test.js src/finance/txn-target.test.js`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/services/finance-format.js src/services/finance-format.test.js
git commit -m "feat(finance-format): builder txnList (consulta + desambiguação)"
```

---

## Task 7: Skill `financeiro-pessoal.md` — documentar correção/exclusão/consulta

**Files:** Modify `skills/financeiro-pessoal.md` (lista de ações)

- [ ] **Step 1: Adicionar as 3 ações + frases**

Após o bullet de `register_transaction`, inserir:
```markdown
- `delete_transaction` — params: which(opcional: "essa"/descrição/valor). Apaga o lançamento RECENTE (últimas ~2h). Ex: "exclui essa", "apaga a do mercado", "apaga a de 30". Parcela de cartão → apaga o grupo todo. Mais antigo → oriente a editar no app. NÃO calcule saldo; o engine reverte.
- `edit_transaction` — params: which(opcional), amount?, category?, description?, account_name?. Corrige o lançamento RECENTE. Ex: "era 2900", "muda a categoria pra lazer", "era no Itaú", "na verdade foi mercado". Compra parcelada no cartão: pra mudar valor, oriente apagar e relançar (só categoria/descrição editáveis).
- `query_transactions` — params: category?, type?, limit?. Lista lançamentos. Ex: "minhas últimas transações", "quanto gastei em alimentação", "meus últimos gastos". O engine monta a lista — você NÃO inventa números.
```

- [ ] **Step 2: Nota de emissão imperativa**

Logo abaixo, acrescentar:
```markdown
⚠️ Correção/exclusão são **markers**, igual o resto: emita `edit_transaction`/`delete_transaction` JÁ quando o usuário pedir — NUNCA narre "apaguei" sem o marker, NUNCA peça confirmação extra (o engine confirma e, se houver ambiguidade, ele pergunta). "exclui essa"/"era X" SEM contexto → o engine resolve pelo lançamento mais recente.
```

- [ ] **Step 3: Commit**

```bash
git add skills/financeiro-pessoal.md
git commit -m "feat(skill): documenta edit/delete/query_transactions + frases de correção"
```

---

## Task 8: PWA — `updateTransaction` no lib + tipo `purchase_group`

**Files:** Modify `web/src/lib/financeiro.ts`

- [ ] **Step 1: `PfTransaction` ganha `purchase_group`**

Na interface `PfTransaction` (linha ~17), adicionar o campo:
```ts
  purchase_group?: string | null;
```
E em `listTransactions` o `.select(...)` (linha ~81) passa a incluir `purchase_group`:
```ts
    .select('id, type, category, amount, description, transaction_date, account_id, card_id, purchase_group')
```

- [ ] **Step 2: `updateTransaction`**

Após `deleteTransaction` (linha ~106), adicionar:
```ts
export async function updateTransaction(collaboratorId: string, id: string, patch: { type?: PfTxType; category?: PfCategory; amount?: number; description?: string | null; transaction_date?: string; account_id?: string | null }) {
  const allowed: Record<string, unknown> = { updated_at: new Date().toISOString() };
  for (const k of ['type', 'category', 'amount', 'description', 'transaction_date', 'account_id'] as const) {
    if (patch[k] !== undefined) allowed[k] = patch[k];
  }
  const { data, error } = await supabase.from('pf_transactions')
    .update(allowed).eq('id', id).eq('collaborator_id', collaboratorId)
    .select().single();
  if (error) throw error;
  return data;
}
```

- [ ] **Step 3: tsc**

Run: `cd web && npx tsc --noEmit`
Expected: 0 erros.

- [ ] **Step 4: Commit**

```bash
git add web/src/lib/financeiro.ts
git commit -m "feat(pwa-lib): updateTransaction + purchase_group em PfTransaction"
```

---

## Task 9: PWA — hook `useUpdateTransaction`

**Files:** Modify `web/src/hooks/useFinanceiro.ts`

- [ ] **Step 1: Adicionar o hook**

Junto das mutations de transação (perto de `useCreateTransaction`/`useDeleteTransaction`):
```ts
export const useUpdateTransaction = () => useFinMutation((cid, args: { id: string; patch: Parameters<typeof fin.updateTransaction>[2] }) => fin.updateTransaction(cid, args.id, args.patch));
```
> `fin` é o namespace já importado de `../lib/financeiro`. `useFinMutation` invalida a KEY `['financeiro']` no sucesso.

- [ ] **Step 2: tsc**

Run: `cd web && npx tsc --noEmit`
Expected: 0 erros.

- [ ] **Step 3: Commit**

```bash
git add web/src/hooks/useFinanceiro.ts
git commit -m "feat(pwa-hook): useUpdateTransaction"
```

---

## Task 10: PWA — `TransactionSheet` em modo edição

**Files:** Modify `web/src/screens/financeiro/components/TransactionSheet.tsx`

Hoje o sheet em modo edição (`initial` presente) só mostra "Apagar" — sem salvar. Habilitar update.

- [ ] **Step 1: Importar o hook + detectar parcela de cartão**

Trocar o import (linha 7):
```ts
import { useAccounts, useCreateTransaction, useDeleteTransaction, useUpdateTransaction } from '../../../hooks/useFinanceiro';
```
Dentro do componente, após `deleteMut` (linha ~39):
```ts
  const updateMut = useUpdateTransaction();
  const isCardTxn = !!initial?.card_id; // compra de cartão: valor/parcelas não editáveis aqui
```

- [ ] **Step 2: Função `save` (update)**

Adicionar após `submit` (~linha 88):
```ts
  async function save() {
    if (!initial) return;
    setError(null);
    const amount = Number(amountText.replace(',', '.'));
    if (!isFinite(amount) || amount <= 0) { setError('Informe um valor maior que zero.'); return; }
    try {
      await updateMut.mutateAsync({
        id: initial.id,
        patch: {
          type, category, amount: isCardTxn ? undefined : amount,
          description: description.trim() || null,
          transaction_date: date,
          account_id: isCardTxn ? undefined : (accountId || null),
        },
      });
      onClose();
    } catch (e) { setError((e as Error).message); }
  }
```

- [ ] **Step 3: `submitting` inclui update + aviso de cartão**

Trocar a linha de `submitting` (~106):
```ts
  const submitting = createMut.isPending || deleteMut.isPending || updateMut.isPending;
```
Logo após o `<Field label="Valor">…</Field>` (depois da linha ~147), quando for cartão em modo edição, mostrar aviso e desabilitar o input de valor. Envolver o input de valor com `disabled={isCardTxn}` e adicionar abaixo:
```tsx
        {isCardTxn && (
          <p className="text-body-sm text-fg-muted">Compra de cartão: pra mudar valor/parcelas, apague e relance. Aqui dá pra ajustar categoria, descrição e data.</p>
        )}
```
(No `<input>` do valor, acrescentar `disabled={isCardTxn}` e `className` ganha `disabled:opacity-50`.)

- [ ] **Step 4: Botão "Salvar" no modo edição**

No rodapé (bloco `isEdit`), hoje só há "Apagar". Adicionar o "Salvar" ao lado do Cancelar quando `isEdit`:
```tsx
          <div className="flex items-center gap-2">
            <Button variant="ghost" onClick={onClose} disabled={submitting}>Cancelar</Button>
            {!isEdit && (
              <Button variant="primary" onClick={submit} disabled={submitting || !amountText.trim()}>
                {submitting ? 'Salvando…' : 'Registrar'}
              </Button>
            )}
            {isEdit && (
              <Button variant="primary" onClick={save} disabled={submitting || !amountText.trim()}>
                {submitting ? 'Salvando…' : 'Salvar'}
              </Button>
            )}
          </div>
```

- [ ] **Step 5: Atualizar o comentário do prop**

Linha 32: trocar `// se presente, modo edição (apenas delete; sem update ainda — v1.1)` por `// se presente, modo edição (editar campos + apagar)`.

- [ ] **Step 6: tsc + build**

Run: `cd web && npx tsc --noEmit && npx vite build`
Expected: 0 erros; build OK.

- [ ] **Step 7: Commit**

```bash
git add web/src/screens/financeiro/components/TransactionSheet.tsx
git commit -m "feat(pwa): TransactionSheet modo edição (salvar update; cartão = campos limitados)"
```

---

## Task 11: Deploy + smoke E2E

**Files:** deploy (scp + pm2); web via auto-deploy hook.

- [ ] **Step 1: SCP engine + skill + restart**

```bash
for f in src/finance/txn-target.js src/services/financeiro-service.js src/services/finance-format.js src/engine.js skills/financeiro-pessoal.md; do scp /d/la-organizer/_remote/$f tom:/opt/LA-Organizer/$f; done
ssh tom "cd /opt/LA-Organizer && node --check src/engine.js && pm2 restart tom && sleep 2 && pm2 logs tom --lines 5 --nostream"
```
Expected: TOM online sem stacktrace.

- [ ] **Step 2: Suíte local verde**

Run: `node --test src/finance/txn-target.test.js src/finance/source-match.test.js src/services/finance-format.test.js`
Expected: todos passam.

- [ ] **Step 3: Smoke WhatsApp (TOM)**

1. `gastei 30 no uber pelo itau` → registra. Depois `era 25` → **edit_transaction** corrige valor (Saldo Itau reajusta).
2. `gastei 50 no mercado em dinheiro` → registra. `muda a categoria pra lazer` → corrige categoria.
3. `exclui essa` → apaga a última (saldo reverte).
4. Dois lançamentos de R$30 → `apaga a de 30` → **pergunta qual** (txn_pick) → responde `1` → apaga só essa.
5. `comprei tv 1200 em 10x no nubank` → fatura. `exclui essa` → apaga as **10 parcelas** (grupo).
6. `minhas últimas transações` → **query_transactions** lista. `quanto gastei em alimentação` → lista filtrada.
7. `era 2900` logo após uma compra de cartão parcelada → responde que é parcelada (orienta apagar+relançar).

- [ ] **Step 4: Smoke PWA**

No preview (localhost:4173, limpar SW): abrir uma transação na lista → editar valor/categoria/descrição → **Salvar** → confere que o valor muda na lista e o saldo da carteira reajusta. Abrir uma compra de cartão → confere que valor fica travado com o aviso, mas categoria/descrição salvam. Apagar uma transação → some + saldo reverte.

- [ ] **Step 5: Verificar saldo no banco (sem órfã/descasamento)**

Via execute_sql, conferir que após editar/apagar o `balance` da carteira bate com a soma das transações ativas. Spot-check no Itau.

---

## Notas de execução
- **Sem coluna "last_txn":** o alvo recente vem de `listRecentTransactions` (janela 2h) — sobrevive a restart/fallback. (Task 4 só loga o id.)
- **Parcela de cartão:** delete = grupo inteiro (`deleteTransactionGroup`); edição de valor de parcelada não é suportada (orienta apagar+relançar) — tanto no TOM quanto no PWA.
- **Reuso do `pending_intents`:** `txn_pick` usa o mesmo kind `finance_source` (já no CHECK) com `form: 'txn_pick'` — não precisa de migration de kind.
- **Trigger faz o saldo:** nenhuma reversão manual de saldo no código; `updateTransaction`/`deleteTransaction` confiam no `pf_sync_account_balance`.
