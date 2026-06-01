# Ajuste de saldo fora dos relatórios — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transações de ajuste de saldo ("Saldo inicial" / "Ajuste de saldo") deixam de contar como Receita/Despesa nos relatórios (PWA + rituais do TOM), mas continuam no extrato da carteira e no cálculo do saldo.

**Architecture:** Coluna booleana `is_adjustment` em `pf_transactions` (default false). O ajuste de saldo grava `true`. O trigger de saldo não muda (ajuste continua mexendo no balance). Todos os pontos que somam Receita/Despesa para *relatório* passam a ignorar linhas com `is_adjustment = true`. A linha continua aparecendo no extrato (listagens não filtram).

**Tech Stack:** Postgres (Supabase MCP), React+TS+Vite (PWA), Node CommonJS (TOM engine).

**Invariante preservada:** `balance = soma(transactions ± transfers)` — ajustes continuam contando no saldo; só saem dos agregados de relatório.

---

### Task 1: Migration `is_adjustment` + backfill

**Files:**
- Create: `migrations/20260601_pf_transactions_is_adjustment.sql`
- Apply: via Supabase MCP `apply_migration` (project `cesnbnrynvxvgdhfmaua`)

**Model:** Opus (operação real de banco; verificar com SELECT após aplicar).

- [ ] **Step 1: Escrever a migration**

Arquivo `migrations/20260601_pf_transactions_is_adjustment.sql`:

```sql
-- Marca transações que são acerto de caixa (saldo inicial / ajuste de saldo).
-- Continuam contando no saldo (trigger não muda), mas saem dos relatórios.
ALTER TABLE pf_transactions
  ADD COLUMN IF NOT EXISTS is_adjustment boolean NOT NULL DEFAULT false;

-- Backfill: os ajustes já criados pelo AccountSheet usam estas descrições + categoria 'outros'.
UPDATE pf_transactions
   SET is_adjustment = true
 WHERE is_adjustment = false
   AND category = 'outros'
   AND description IN ('Saldo inicial', 'Ajuste de saldo');
```

- [ ] **Step 2: Aplicar via MCP**

Chamar `mcp__4c04bb52-...__apply_migration` com `project_id: cesnbnrynvxvgdhfmaua`, `name: pf_transactions_is_adjustment`, `query:` (conteúdo acima).
Expected: sucesso, sem erro.

- [ ] **Step 3: Verificar coluna + backfill**

Rodar via `execute_sql`:

```sql
SELECT
  (SELECT count(*) FROM information_schema.columns
     WHERE table_name='pf_transactions' AND column_name='is_adjustment') AS col_existe,
  (SELECT count(*) FROM pf_transactions WHERE is_adjustment) AS marcadas,
  (SELECT count(*) FROM pf_transactions
     WHERE category='outros' AND description IN ('Saldo inicial','Ajuste de saldo')) AS candidatas;
```

Expected: `col_existe = 1`; `marcadas = candidatas` (todas as transações de ajuste existentes ficaram marcadas).

---

### Task 2: PWA — gravar e excluir ajustes dos agregados

**Files:**
- Modify: `web/src/lib/financeiro.ts` (tipo `PfTransaction`, selects, `createTransaction`)
- Modify: `web/src/screens/financeiro/components/AccountSheet.tsx:71-78` (`ajustarSaldo`)
- Modify: `web/src/hooks/useFinanceiro.ts:96-107` (`useSummary`)
- Modify: `web/src/screens/financeiro/TransacoesPage.tsx:66-73` (totais)
- Modify: `web/src/screens/financeiro/FinanceiroPage.tsx:62-79` (linha 6 meses)
- Modify: `web/src/screens/financeiro/CarteiraDetalhePage.tsx:54-58` (`savedThisMonth`)

**Model:** Sonnet.

- [ ] **Step 1: Tipo `PfTransaction` — adicionar campo**

Em `web/src/lib/financeiro.ts`, no `export interface PfTransaction`, adicionar `is_adjustment` (final do bloco, antes do `}`):

```ts
export interface PfTransaction {
  id: string; type: PfTxType; category: PfCategory; amount: number;
  description: string | null; transaction_date: string; account_id: string | null;
  card_id?: string | null; // preenchido = compra no cartão (fora do caixa; vive na fatura)
  purchase_group?: string | null;
  is_adjustment?: boolean; // true = acerto de caixa; conta no saldo, mas fora dos relatórios
}
```

- [ ] **Step 2: Selects — incluir `is_adjustment`**

Em `web/src/lib/financeiro.ts`, nos 3 selects abaixo, acrescentar `, is_adjustment` à lista de colunas:

`listAccountTransactions`:
```ts
    .select('id, type, category, amount, description, transaction_date, account_id, card_id, purchase_group, is_adjustment')
```

`listTransactions`:
```ts
    .select('id, type, category, amount, description, transaction_date, account_id, card_id, purchase_group, is_adjustment')
```

`listTransactionsRange` (este só pega 4 colunas; adicionar a 5ª):
```ts
    .select('type, amount, transaction_date, card_id, is_adjustment')
```

- [ ] **Step 3: `createTransaction` — aceitar e gravar `is_adjustment`**

Em `web/src/lib/financeiro.ts`, substituir a função `createTransaction` por:

```ts
export async function createTransaction(collaboratorId: string, input: { type: PfTxType; category: PfCategory; amount: number; description?: string | null; transaction_date?: string; account_id?: string | null; is_adjustment?: boolean }) {
  const row = {
    collaborator_id: collaboratorId, type: input.type, category: input.category, amount: input.amount,
    description: input.description ?? null, account_id: input.account_id ?? null,
    is_adjustment: input.is_adjustment ?? false,
    via: 'pwa', ...(input.transaction_date ? { transaction_date: input.transaction_date } : {}),
  };
  const { data, error } = await supabase.from('pf_transactions').insert(row).select().single();
  if (error) throw error;
  return data;
}
```

- [ ] **Step 4: `ajustarSaldo` — marcar a transação**

Em `web/src/screens/financeiro/components/AccountSheet.tsx`, na função `ajustarSaldo`, no objeto passado a `createTx.mutateAsync`, adicionar `is_adjustment: true`:

```ts
    await createTx.mutateAsync({
      type: delta > 0 ? 'income' : 'expense',
      category: 'outros',
      amount: Math.abs(delta),
      description: isCreate ? 'Saldo inicial' : 'Ajuste de saldo',
      transaction_date: new Date().toISOString().slice(0, 10),
      account_id: accountId,
      is_adjustment: true,
    });
```

- [ ] **Step 5: `useSummary` — excluir ajustes de receitas/despesas/porCat**

Em `web/src/hooks/useFinanceiro.ts`, substituir o corpo de `useSummary` (linhas 96-107) por:

```ts
export function useSummary() {
  const tx = useTransactions();
  if (!tx.data) return { ...tx, summary: undefined };
  // Caixa (receitas/despesas/saldo): EXCLUI compras no cartão (vivem na fatura) E ajustes de saldo (acerto de caixa, não é receita/despesa real).
  const cash = tx.data.filter((r) => !r.card_id && !r.is_adjustment);
  const receitas = cash.filter((r) => r.type === 'income').reduce((s, r) => s + Number(r.amount), 0);
  const despesas = cash.filter((r) => r.type === 'expense').reduce((s, r) => s + Number(r.amount), 0);
  // Gastos por categoria: INCLUI cartão (você quer ver onde gasta), mas EXCLUI ajustes.
  const porCat: Record<string, number> = {};
  for (const r of tx.data) if (r.type === 'expense' && !r.is_adjustment) porCat[r.category] = (porCat[r.category] || 0) + Number(r.amount);
  return { ...tx, summary: { receitas, despesas, saldo: receitas - despesas, porCat } };
}
```

- [ ] **Step 6: `TransacoesPage` — totais excluem ajustes (lista mantém)**

Em `web/src/screens/financeiro/TransacoesPage.tsx`, substituir os dois `useMemo` `totalIn`/`totalOut` (linhas 66-73) por:

```ts
  const totalIn = useMemo(
    () => (txQ.data ?? []).filter((t) => t.type === 'income' && !t.is_adjustment).reduce((s, t) => s + Number(t.amount), 0),
    [txQ.data],
  );
  const totalOut = useMemo(
    () => (txQ.data ?? []).filter((t) => t.type === 'expense' && !t.is_adjustment).reduce((s, t) => s + Number(t.amount), 0),
    [txQ.data],
  );
```

(A lista `txQ.data.map(...)` mais abaixo NÃO muda — o ajuste continua aparecendo na listagem.)

- [ ] **Step 7: `FinanceiroPage` — linha de 6 meses exclui ajustes**

Em `web/src/screens/financeiro/FinanceiroPage.tsx`, na função `aggregateByMonth`, a assinatura passa a aceitar `is_adjustment` e a chamada filtra. Trocar a assinatura de `aggregateByMonth` (linha 31) por:

```ts
function aggregateByMonth(txs: { type: 'income'|'expense'; amount: number; transaction_date: string; is_adjustment?: boolean }[]) {
```

E na linha 65 (dentro de `monthlySeries`), trocar o filtro por:

```ts
    const buckets = aggregateByMonth(txRangeQ.data.filter((t) => !t.card_id && !t.is_adjustment));
```

- [ ] **Step 8: `CarteiraDetalhePage` — "guardado no mês" exclui ajustes**

Em `web/src/screens/financeiro/CarteiraDetalhePage.tsx`, substituir o `reduce` de `savedThisMonth` (linhas 55-58) por:

```ts
  const savedThisMonth = (txQ.data ?? []).reduce((sum, t) => {
    if (t.transaction_date.slice(0, 7) !== ym) return sum;
    if (t.is_adjustment) return sum; // acerto de caixa não conta como "guardado no mês"
    return sum + (t.type === 'income' ? Number(t.amount) : -Number(t.amount));
  }, 0);
```

(O extrato `txs.map(...)` NÃO muda — o ajuste continua clicável no extrato.)

- [ ] **Step 9: Validar build**

Run: `cd /d/la-organizer/_remote/web && npx tsc --noEmit && npx vite build`
Expected: `tsc` sem erros; build conclui (gera `dist/`).

---

### Task 3: TOM engine — rituais/resumo excluem ajustes

**Files:**
- Modify: `src/services/financeiro-service.js` (`querySummary`, `monthlyReport`, `monthCategoryTotal`)
- Deploy: SCP + `pm2 restart tom`

**Model:** Sonnet.

- [ ] **Step 1: `querySummary` — filtrar ajustes no DB**

Em `src/services/financeiro-service.js`, na função `querySummary`, na query, acrescentar `.neq('is_adjustment', true)` (a coluna é NOT NULL DEFAULT false, então `neq true` inclui todas as não-ajuste):

```js
async function querySummary(collaboratorId) {
  const { start, end } = monthBounds();
  const { data, error } = await supabase.from('pf_transactions')
    .select('type, category, amount')
    .eq('collaborator_id', collaboratorId).gte('transaction_date', start).lt('transaction_date', end)
    .neq('is_adjustment', true);
  if (error) throw error;
  const rows = data || [];
  const receitas = rows.filter((r) => r.type === 'income').reduce((s, r) => s + Number(r.amount), 0);
  const despesas = rows.filter((r) => r.type === 'expense').reduce((s, r) => s + Number(r.amount), 0);
  const porCategoria = {};
  for (const r of rows) if (r.type === 'expense') porCategoria[r.category] = (porCategoria[r.category] || 0) + Number(r.amount);
  const top = Object.entries(porCategoria).sort((a, b) => b[1] - a[1]).slice(0, 3);
  return { receitas, despesas, saldo: receitas - despesas, top };
}
```

- [ ] **Step 2: `monthlyReport` — filtrar ajustes no DB**

Em `src/services/financeiro-service.js`, na função `monthlyReport`, acrescentar `.neq('is_adjustment', true)` na query:

```js
async function monthlyReport(collaboratorId, ref = new Date()) {
  const { start, end } = monthBounds(ref);
  const { data, error } = await supabase.from('pf_transactions')
    .select('type, category, amount')
    .eq('collaborator_id', collaboratorId).gte('transaction_date', start).lt('transaction_date', end)
    .neq('is_adjustment', true);
  if (error) throw error;
  const rows = data || [];
  const receitas = rows.filter((r) => r.type === 'income').reduce((s, r) => s + Number(r.amount), 0);
  const despesas = rows.filter((r) => r.type === 'expense').reduce((s, r) => s + Number(r.amount), 0);
  const porCat = {};
  for (const r of rows) if (r.type === 'expense') porCat[r.category] = (porCat[r.category] || 0) + Number(r.amount);
  const top = Object.entries(porCat).sort((a, b) => b[1] - a[1]).slice(0, 3);
  return { receitas, despesas, saldo: receitas - despesas, top, temAtividade: rows.length > 0 };
}
```

- [ ] **Step 3: `monthCategoryTotal` — alerta de orçamento ignora ajustes**

Em `src/services/financeiro-service.js`, na função `monthCategoryTotal`, acrescentar `.neq('is_adjustment', true)`:

```js
async function monthCategoryTotal(collaboratorId, category, { excludeId } = {}) {
  const { start, end } = monthBounds();
  const { data, error } = await supabase.from('pf_transactions')
    .select('amount, id')
    .eq('collaborator_id', collaboratorId).eq('type', 'expense').eq('category', category)
    .gte('transaction_date', start).lt('transaction_date', end)
    .neq('is_adjustment', true);
  if (error) throw error;
  return (data || []).filter((r) => r.id !== excludeId).reduce((s, r) => s + Number(r.amount), 0);
}
```

- [ ] **Step 4: Checar sintaxe**

Run: `node --check /d/la-organizer/_remote/src/services/financeiro-service.js`
Expected: sem saída (OK).

- [ ] **Step 5: Deploy backend**

```bash
scp /d/la-organizer/_remote/src/services/financeiro-service.js tom:/opt/LA-Organizer/src/services/financeiro-service.js
ssh tom "pm2 restart tom"
```
Expected: scp OK; pm2 mostra `tom` online.

---

### Task 4: Reconciliação + verificação holística

**Model:** controller (inline).

- [ ] **Step 1: Reconciliação no banco** — confirmar que o saldo das contas continua batendo com a soma das transações + transfers (ajustes incluídos), e que os relatórios agora excluem ajustes. Via `execute_sql`:

```sql
-- Saldo registrado vs soma de transações (income +, expense −) por conta do Luciano.
WITH t AS (
  SELECT account_id,
         sum(CASE WHEN type='income' THEN amount ELSE -amount END) AS soma_tx
    FROM pf_transactions
   WHERE collaborator_id = '0576f4b6-183d-4cf1-980e-5c8d5da0177f'
     AND account_id IS NOT NULL
   GROUP BY account_id
)
SELECT a.name, a.balance, COALESCE(t.soma_tx,0) AS soma_tx,
       a.balance - COALESCE(t.soma_tx,0) AS diff_sem_transfers
  FROM pf_accounts a LEFT JOIN t ON t.account_id = a.id
 WHERE a.collaborator_id = '0576f4b6-183d-4cf1-980e-5c8d5da0177f';
```

Expected: `diff_sem_transfers` explicável apenas por transferências (`pf_transfers`) — ajustes continuam somando no saldo (não devem criar divergência nova).

- [ ] **Step 2: Confirmar exclusão nos relatórios** — comparar resumo do mês com e sem ajuste:

```sql
SELECT
  sum(CASE WHEN type='income'  AND NOT is_adjustment THEN amount ELSE 0 END) AS receitas_relatorio,
  sum(CASE WHEN type='income'  THEN amount ELSE 0 END)                       AS receitas_com_ajuste,
  sum(CASE WHEN type='expense' AND NOT is_adjustment THEN amount ELSE 0 END) AS despesas_relatorio
  FROM pf_transactions
 WHERE collaborator_id = '0576f4b6-183d-4cf1-980e-5c8d5da0177f'
   AND transaction_date >= date_trunc('month', now())::date;
```

Expected: `receitas_relatorio < receitas_com_ajuste` se houver "Saldo inicial" no mês corrente (prova que o ajuste saiu do relatório).

---

## Notas de execução
- Web sobe pelo auto-deploy (Stop hook → git push → Vercel ~2min). NÃO pedir push manual.
- Backend (`src/`) precisa do SCP + `pm2 restart` da Task 3 (não espera o turno).
- Categorias são DB-driven (`pf_categories`) e NÃO mudam — abordagem por flag não cria categoria nova.
