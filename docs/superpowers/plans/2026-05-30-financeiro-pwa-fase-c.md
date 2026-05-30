# Finanças Pessoais — Fase C (PWA) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) ou superpowers:executing-plans pra implementar task-a-task. Steps usam checkbox (`- [ ]`).
> ⚠️ **Modelo:** executar com Opus, não Haiku (decisão do Alf — frontend exige). Invocar `frontend-design` no início da execução pra que cada tela siga o DS.

**Goal:** Entregar a camada PWA do módulo Finanças (5 telas em `/financeiro`) com CRUD bilateral e **realtime ativo na tela aberta** — quando o TOM grava ("gastei 45 no iFood"), o dashboard atualiza em ~1s sem refresh.

**Architecture:** Cliente Supabase do PWA (`web/src/lib/supabase.ts`) usa JWT do colaborador autenticado (RLS owner-only protege). Mutations passam `collaborator_id` **explícito** vindo de `useAuth().collaborator.id` — padrão do projeto (`useEventCategories.ts:75`). Lógica pura mora em `web/src/lib/finance-utils.ts` (port literal do `_remote/src/finance/projection.js`, com teste de paridade). CRUD em `web/src/lib/financeiro.ts`; hooks em `web/src/hooks/useFinanceiro.ts` (TanStack Query v5 + mutations) e `web/src/hooks/useRealtimeFinance.ts` (subscribe/unsubscribe nas 5 tabelas `pf_*`). Recharts lazy nas telas.

**Tech Stack:** React 18 + TypeScript + Vite, TanStack Query v5 (já instalado), Supabase JS (JWT), Tailwind tokens (`tom` verde, **nunca `brand`**), `node:test`/Vitest (puros), `recharts` (a instalar). DS obrigatório: `AdaptiveSheet`, `CustomSelect`, `DateInput`, `Fab`, `Field`, `StatCard`.

---

## Convenções (LEIA antes de executar)

- **Não commitar entre tasks.** Stop hook commita+pusha `_remote/` no fim do turno. Migrations via MCP `apply_migration` (`cesnbnrynvxvgdhfmaua`).
- **Modelo:** Opus em todas as tasks. **Skill `frontend-design`** invocada antes da Task 6 e mantida ativa pras 7-10 (telas).
- **Voz visual:** tokens `tom` (verde, identidade do app). Receita = `text-success`; despesa = `text-danger`. Memória do projeto: NUNCA usar `brand` em UI funcional (rosa = marca LA Music).
- **`collaborator_id` SEMPRE explícito do auth context** (`useAuth().collaborator.id`) no insert — RLS `WITH CHECK` valida. Sem isso, NOT NULL viola.
- **Mobile/desktop:** componentes responsivos únicos (sem `XMobile/XDesktop` por tela). O `AppLayout` global já escolhe shell. Testar **375px** e **1440px** em cada PR.
- **Recharts lazy:** importar dentro do componente de gráfico (não no topo das telas) pra não inchar o bundle.
- **DS first:** se não existe componente no DS, criar primeiro seguindo tokens, depois usar.
- **Test runner:** Vitest instalado mas pouco usado. Vou usar Vitest **só pros puros** (finance-utils, paridade); telas validadas por `npx tsc --noEmit` + `npx vite build` + smoke visual no Simple Browser (localhost:4173, workflow padrão do projeto).
- **Spec:** `_remote/docs/superpowers/specs/2026-05-30-financeiro-pwa-fase-c-design.md` (decisões E1-E8).

## Anchors verificados (não chutar)

| Item | Onde |
|---|---|
| Cliente Supabase | `web/src/lib/supabase.ts:1-13` — `createClient(url, anonKey, { auth: { persistSession: true, autoRefreshToken: true } })` — JWT vai em `Authorization: Bearer` automático. |
| Auth context | `web/src/contexts/AuthContext.tsx:218-222` — `useAuth() ⇒ { session, collaborator, role, loading, ... }`. `collaborator.id` é a fonte do `collaborator_id`. |
| Padrão INSERT com `collaborator_id` explícito | `web/src/hooks/useEventCategories.ts:59-86` — molde literal. |
| Padrão realtime (channel + on + subscribe + cleanup) | `web/src/hooks/useRealtimeSync.ts:1-80` — molde literal. |
| TanStack Query | `web/package.json` — `@tanstack/react-query: ^5.59.0`; `QueryClientProvider` em `web/src/main.tsx`. |
| `AdaptiveSheet` | `web/src/components/AdaptiveSheet.tsx` — `{ open, onClose, title, children, size? }`. |
| `Fab` | `web/src/components/Fab.tsx` — `{ onClick?, label?, ariaLabel?, actions? }` (single ou menu). |
| `StatCard` | `web/src/components/StatCard.tsx` — `{ label, value, hint?, tone?: 'tom'|'success'|'danger'|... }`. **Existe — usa `tone="tom"`/`"success"`/`"danger"`.** |
| `CustomSelect` `DateInput` `Field` | `web/src/components/` — já existem. |
| Sidebar (item novo) | `web/src/components/Sidebar.tsx:60-110` — array `sections[0].items` (principal). |
| Mais entrada | `web/src/screens/Mais.tsx:22-28` — array `personalItems` (formato `{ to, label, hint }`). |
| Lib pura origem | `_remote/src/finance/projection.js` — `futureValue`, `monthsToGoalSimple`, `monthsToGoalWithInterest`, `formatMonths`. |
| Recharts | **NÃO instalado** — Task 2 instala. |

## File Structure (Fase C)

**Criar (15):**
- `web/src/lib/finance-utils.ts` — port TS de `projection.js` (puro). Testes em `finance-utils.test.ts`.
- `web/src/lib/financeiro.ts` — CRUD direto Supabase (funções puras async); cada função recebe `collaboratorId` explícito.
- `web/src/hooks/useFinanceiro.ts` — TanStack Query: `useAccounts`, `useTransactions`, `useBills`, `useGoals`, `useBudgets`, `useSummary` + mutations.
- `web/src/hooks/useRealtimeFinance.ts` — `useRealtimeFinance(tables: PfTable[])` → channel + on + cleanup.
- `web/src/screens/financeiro/FinanceiroPage.tsx` — dashboard.
- `web/src/screens/financeiro/TransacoesPage.tsx` — histórico.
- `web/src/screens/financeiro/ContasFixasPage.tsx` — contas (status derivado).
- `web/src/screens/financeiro/MetasPage.tsx` — metas + simulador.
- `web/src/screens/financeiro/CarteirasPage.tsx` — carteiras 1ª classe.
- `web/src/screens/financeiro/components/TransactionSheet.tsx`
- `web/src/screens/financeiro/components/BillSheet.tsx`
- `web/src/screens/financeiro/components/GoalSheet.tsx`
- `web/src/screens/financeiro/components/AccountSheet.tsx`
- `web/src/screens/financeiro/components/BudgetBar.tsx`
- `web/src/screens/financeiro/components/CompoundInterestSimulator.tsx`

**Modificar:**
- `web/src/App.tsx` — 5 rotas `/financeiro/*` dentro do `AppLayout` protegido.
- `web/src/screens/Mais.tsx` — adicionar `personalItems` com `{ to: '/financeiro', label: 'Finanças', hint: 'Suas finanças pessoais' }`.
- `web/src/components/Sidebar.tsx` — adicionar `{ to: '/financeiro', label: 'Finanças', Icon: Wallet }` em `sections.principal.items`.
- `web/package.json` — adicionar `recharts`.

---

## Task 1: Replication realtime + smoke bilateral ⚠️ **must-verify-early**

**Files:** nenhum (config no banco + verificação).

> Se as tabelas `pf_*` não estão na publication `supabase_realtime`, o `postgres_changes` não dispara nada e a bilateralidade falha em silêncio. **Esta task vem ANTES de qualquer código de tela.**

- [ ] **Step 1: Verificar publication atual**

`mcp__supabase__execute_sql`:
```sql
SELECT tablename FROM pg_publication_tables
WHERE pubname='supabase_realtime' AND tablename LIKE 'pf_%' ORDER BY tablename;
```
Expected: 0–5 linhas. Se já tiver as 5, pula Step 2.

- [ ] **Step 2: Adicionar as 5 tabelas à publication**

```sql
ALTER PUBLICATION supabase_realtime ADD TABLE pf_accounts;
ALTER PUBLICATION supabase_realtime ADD TABLE pf_transactions;
ALTER PUBLICATION supabase_realtime ADD TABLE pf_bills;
ALTER PUBLICATION supabase_realtime ADD TABLE pf_goals;
ALTER PUBLICATION supabase_realtime ADD TABLE pf_budgets;
```
Re-rodar a query do Step 1 — expected: 5 linhas.

- [ ] **Step 3: Smoke realtime (sem código de tela ainda)**

Cole no console do navegador, no PWA aberto autenticado em `localhost:4173`:
```js
const { createClient } = await import('@supabase/supabase-js');
const sb = (await import('/src/lib/supabase.ts')).supabase;
const channel = sb.channel('pf-smoke')
  .on('postgres_changes', { event: '*', schema: 'public', table: 'pf_transactions' }, p => console.log('[RT]', p.eventType, p.new))
  .subscribe(s => console.log('status:', s));
```
Expected: `status: SUBSCRIBED`.

Em outra janela, MCP execute_sql:
```sql
INSERT INTO pf_transactions (collaborator_id, type, category, amount, description)
VALUES ('0576f4b6-183d-4cf1-980e-5c8d5da0177f','expense','outros',1,'smoke-rt');
DELETE FROM pf_transactions WHERE description='smoke-rt';
```
Expected: 2 logs no console (`[RT] INSERT ...`, `[RT] DELETE ...`). Se nada chegar → publication não bateu ou RLS bloqueou; PARAR e investigar.

---

## Task 2: Instalar recharts + esqueleto navegável (rotas + entradas)

**Files:**
- Modify: `web/package.json`, `web/src/App.tsx`, `web/src/screens/Mais.tsx`, `web/src/components/Sidebar.tsx`
- Create: `web/src/screens/financeiro/FinanceiroPage.tsx` (placeholder), idem `TransacoesPage`, `ContasFixasPage`, `MetasPage`, `CarteirasPage` (todos com `<div>em breve</div>`).

> Esqueleto navegável valida que as rotas funcionam, o card no Mais aparece, e o item da Sidebar entra no desktop — antes de qualquer lógica.

- [ ] **Step 1: Instalar recharts**

```bash
cd web && npm install recharts
```
Expected: package.json ganha `"recharts": "^2.x"`.

- [ ] **Step 2: Criar 5 placeholders**

Para cada arquivo (`FinanceiroPage.tsx`, `TransacoesPage.tsx`, `ContasFixasPage.tsx`, `MetasPage.tsx`, `CarteirasPage.tsx`):
```tsx
import { PageShell } from '../../design/PageShell';
export function FinanceiroPage() {
  return (
    <PageShell title="Finanças">
      <div className="p-md text-fg-muted">Em breve.</div>
    </PageShell>
  );
}
```
Confirmar o nome do shell em uso por outras telas (Mais.tsx) e usar o mesmo.

- [ ] **Step 3: Adicionar as 5 rotas em `App.tsx`**

Localizar o bloco com `<Route path="mais" element={<Mais />} />` e acrescentar (logo após):
```tsx
<Route path="financeiro" element={<FinanceiroPage />} />
<Route path="financeiro/transacoes" element={<TransacoesPage />} />
<Route path="financeiro/contas" element={<ContasFixasPage />} />
<Route path="financeiro/metas" element={<MetasPage />} />
<Route path="financeiro/carteiras" element={<CarteirasPage />} />
```
Adicionar os 5 imports no topo (não-lazy nesta task — vira lazy na Task 6+).

- [ ] **Step 4: Card no Mais**

`web/src/screens/Mais.tsx`, no array `personalItems`, adicionar **como primeiro item**:
```tsx
{ to: '/financeiro', label: 'Finanças', hint: 'Suas finanças pessoais (TOM + PWA)' },
```

- [ ] **Step 5: Item na Sidebar (desktop)**

`web/src/components/Sidebar.tsx`, importar `Wallet` de `lucide-react`, e em `sections[0].items` (`principal`) adicionar logo após Hábitos:
```tsx
{ to: '/financeiro', label: 'Finanças', Icon: Wallet },
```

- [ ] **Step 6: Validar**

```bash
cd web && npx tsc --noEmit && npx vite build
```
Expected: sem erros. Abrir `localhost:4173`, navegar em mobile (375px) e desktop (1440px) — Finanças aparece no Mais e na Sidebar; clicar leva pra `/financeiro` (placeholder). Tirar screenshot dos 2 viewports.

---

## Task 3: `lib/finance-utils.ts` — port TS com **teste de paridade**

**Files:**
- Create: `web/src/lib/finance-utils.ts`, `web/src/lib/finance-utils.test.ts`

> Port LITERAL de `_remote/src/finance/projection.js` (mesmas fórmulas, mesma semântica). Teste de paridade garante que simulador do PWA bate com o que o TOM disse no zap.

- [ ] **Step 1: Escrever o teste de paridade (falha)**

`web/src/lib/finance-utils.test.ts`:
```ts
import { test, expect } from 'vitest';
import { futureValue, monthsToGoalSimple, monthsToGoalWithInterest, formatMonths } from './finance-utils';

test('paridade: 300/mes 10 anos a 10,5%/ano ~62k (mesma faixa do projection.js)', () => {
  const i = Math.pow(1.105, 1 / 12) - 1;
  const fv = futureValue(300, i, 120);
  expect(fv).toBeGreaterThan(60000);
  expect(fv).toBeLessThan(66000);
});
test('futureValue taxa zero = soma simples', () => {
  expect(futureValue(300, 0, 12)).toBe(3600);
});
test('monthsToGoalSimple 20000 / 500/mes = 40 meses', () => {
  expect(monthsToGoalSimple(20000, 0, 500)).toBe(40);
});
test('monthsToGoalWithInterest < simples', () => {
  expect(monthsToGoalWithInterest(20000, 0, 500, 0.0083)).toBeLessThan(monthsToGoalSimple(20000, 0, 500));
});
test('formatMonths 40 = "3 anos e 4 meses"', () => {
  expect(formatMonths(40)).toBe('3 anos e 4 meses');
});
test('formatMonths 12 = "1 ano"', () => {
  expect(formatMonths(12)).toBe('1 ano');
});
```

- [ ] **Step 2: Rodar (falha)**

```bash
cd web && npx vitest run src/lib/finance-utils.test.ts
```
Expected: FAIL — módulo não existe.

- [ ] **Step 3: Implementar `finance-utils.ts` (port literal)**

`web/src/lib/finance-utils.ts`:
```ts
// Port LITERAL de _remote/src/finance/projection.js (Fase A).
// REGRA: muda fórmula aqui? muda no .js do engine também — senão o número diverge.
// Taxas mensais (i decimal, ex: 0.0083 = 0.83%/mês).

export function futureValue(monthly: number, monthlyRate: number, months: number): number {
  if (monthlyRate === 0) return monthly * months;
  return monthly * ((Math.pow(1 + monthlyRate, months) - 1) / monthlyRate);
}

export function monthsToGoalSimple(target: number, current: number, monthly: number): number {
  const faltam = target - current;
  if (faltam <= 0) return 0;
  if (!monthly || monthly <= 0) return Infinity;
  return Math.ceil(faltam / monthly);
}

export function monthsToGoalWithInterest(target: number, current: number, monthly: number, monthlyRate: number): number {
  if (target - current <= 0) return 0;
  if ((!monthly || monthly <= 0) && (!current || monthlyRate === 0)) return Infinity;
  for (let n = 1; n <= 1200; n++) {
    const acc = current * Math.pow(1 + monthlyRate, n) + futureValue(monthly, monthlyRate, n);
    if (acc >= target) return n;
  }
  return Infinity;
}

export function formatMonths(n: number): string {
  if (!isFinite(n)) return 'tempo indefinido';
  const anos = Math.floor(n / 12);
  const meses = n % 12;
  const partes: string[] = [];
  if (anos > 0) partes.push(anos === 1 ? '1 ano' : `${anos} anos`);
  if (meses > 0) partes.push(meses === 1 ? '1 mês' : `${meses} meses`);
  if (partes.length === 0) return 'menos de 1 mês';
  return partes.join(' e ');
}

// v1 (spec §9): taxa rotulada como "estimativa ~10,5%/ano". Constante única usada por
// projeção/simulador na Fase C. Quando a v1.1 puser Selic viva numa tabela de config,
// trocar aqui (e o rótulo passa a ser dinâmico).
export const ANNUAL_RATE_ESTIMATE_PCT = 10.5;
export const MONTHLY_RATE_ESTIMATE = Math.pow(1 + ANNUAL_RATE_ESTIMATE_PCT / 100, 1 / 12) - 1;
```

- [ ] **Step 4: Rodar (passa)**

```bash
cd web && npx vitest run src/lib/finance-utils.test.ts
```
Expected: PASS (6 testes).

---

## Task 4: `lib/financeiro.ts` — CRUD direto Supabase (puro, com `collaborator_id` explícito)

**Files:**
- Create: `web/src/lib/financeiro.ts`

> Espelha o `_remote/src/services/financeiro-service.js` (Fase A), mas pelo lado PWA (JWT/RLS). Cada função recebe `collaboratorId` explícito vindo de `useAuth()` (o caller passa). Sem realtime aqui — fica nos hooks.

- [ ] **Step 1: Escrever o arquivo**

`web/src/lib/financeiro.ts`:
```ts
// PWA: CRUD direto contra Supabase via JWT (RLS owner-only protege).
// SEGURANÇA: `collaboratorId` vem SEMPRE do auth context do PWA (caller passa).
// RLS WITH CHECK valida que bate com current_collab_id() — não tem como gravar pra outro.
// REGRA: mudou algo de schema/validação aqui? espelha no _remote/src/services/financeiro-service.js.

import { supabase } from './supabase';

export type PfCategory =
  | 'salario' | 'comissao' | 'extra'
  | 'moradia' | 'alimentacao' | 'transporte'
  | 'saude' | 'educacao' | 'lazer' | 'outros';
export type PfTxType = 'income' | 'expense';
export type PfAccountType = 'checking' | 'savings' | 'wallet' | 'investment';
export type PfBillType = 'expense' | 'income';

export interface PfAccount { id: string; name: string; type: PfAccountType; balance: number; icon: string | null; }
export interface PfTransaction {
  id: string; type: PfTxType; category: PfCategory; amount: number;
  description: string | null; transaction_date: string; account_id: string | null;
}
export interface PfBill {
  id: string; name: string; amount: number; due_day: number; category: PfCategory;
  type: PfBillType; status: 'pending' | 'paid' | 'overdue'; last_paid_at: string | null;
}
export interface PfGoal {
  id: string; name: string; target_amount: number; current_amount: number;
  monthly_contribution: number | null; deadline: string | null; icon: string | null;
}

// Janela do mês corrente em UTC (start incluso, end excluso).
export function monthBounds(date = new Date()) {
  const y = date.getFullYear();
  const m = date.getMonth();
  const start = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);
  const end = new Date(Date.UTC(y, m + 1, 1)).toISOString().slice(0, 10);
  return { start, end, monthYear: start.slice(0, 7) };
}

// ---- Carteiras ----
export async function listAccounts(collaboratorId: string): Promise<PfAccount[]> {
  const { data, error } = await supabase.from('pf_accounts')
    .select('id, name, type, balance, icon')
    .eq('collaborator_id', collaboratorId).eq('is_active', true).order('name');
  if (error) throw error;
  return (data as PfAccount[]) ?? [];
}
export async function createAccount(collaboratorId: string, input: { name: string; type?: PfAccountType; icon?: string | null; goal_monthly?: number | null }) {
  const { data, error } = await supabase.from('pf_accounts')
    .insert({ collaborator_id: collaboratorId, name: input.name, type: input.type ?? 'checking', icon: input.icon ?? null, goal_monthly: input.goal_monthly ?? null })
    .select().single();
  if (error) throw error;
  return data;
}
export async function deactivateAccount(collaboratorId: string, id: string) {
  const { error } = await supabase.from('pf_accounts').update({ is_active: false })
    .eq('id', id).eq('collaborator_id', collaboratorId);
  if (error) throw error;
}

// ---- Transações ----
export async function listTransactions(collaboratorId: string, opts?: { monthYear?: string; category?: PfCategory; type?: PfTxType; limit?: number }) {
  const { start, end } = opts?.monthYear ? monthBoundsFromYYYYMM(opts.monthYear) : monthBounds();
  let q = supabase.from('pf_transactions')
    .select('id, type, category, amount, description, transaction_date, account_id')
    .eq('collaborator_id', collaboratorId)
    .gte('transaction_date', start).lt('transaction_date', end)
    .order('transaction_date', { ascending: false });
  if (opts?.category) q = q.eq('category', opts.category);
  if (opts?.type) q = q.eq('type', opts.type);
  if (opts?.limit) q = q.limit(opts.limit);
  const { data, error } = await q;
  if (error) throw error;
  return (data as PfTransaction[]) ?? [];
}
export async function createTransaction(collaboratorId: string, input: { type: PfTxType; category: PfCategory; amount: number; description?: string | null; transaction_date?: string; account_id?: string | null }) {
  const row = {
    collaborator_id: collaboratorId, type: input.type, category: input.category, amount: input.amount,
    description: input.description ?? null, account_id: input.account_id ?? null,
    via: 'pwa', ...(input.transaction_date ? { transaction_date: input.transaction_date } : {}),
  };
  const { data, error } = await supabase.from('pf_transactions').insert(row).select().single();
  if (error) throw error;
  return data;
}
export async function deleteTransaction(collaboratorId: string, id: string) {
  const { error } = await supabase.from('pf_transactions').delete()
    .eq('id', id).eq('collaborator_id', collaboratorId);
  if (error) throw error;
}

// ---- Orçamento ----
export async function listBudgets(collaboratorId: string, monthYear = monthBounds().monthYear) {
  const { data, error } = await supabase.from('pf_budgets')
    .select('category, monthly_limit')
    .eq('collaborator_id', collaboratorId).eq('month_year', monthYear);
  if (error) throw error;
  return (data ?? []) as { category: PfCategory; monthly_limit: number }[];
}
export async function setBudget(collaboratorId: string, input: { category: PfCategory; monthly_limit: number }) {
  const monthYear = monthBounds().monthYear;
  const { data, error } = await supabase.from('pf_budgets')
    .upsert({ collaborator_id: collaboratorId, category: input.category, monthly_limit: input.monthly_limit, month_year: monthYear },
            { onConflict: 'collaborator_id,category,month_year' })
    .select().single();
  if (error) throw error;
  return data;
}

// ---- Contas fixas (status derivado de last_paid_at — D6) ----
export type BillStatus = 'paga' | 'a-vencer' | 'atrasada';
export function deriveBillStatus(bill: PfBill, today = new Date()): BillStatus {
  const { start } = monthBounds(today);
  if (bill.last_paid_at && bill.last_paid_at >= start) return 'paga';
  const dom = today.getUTCDate();
  return bill.due_day < dom ? 'atrasada' : 'a-vencer';
}
export async function listBills(collaboratorId: string) {
  const { data, error } = await supabase.from('pf_bills')
    .select('id, name, amount, due_day, category, type, status, last_paid_at')
    .eq('collaborator_id', collaboratorId).eq('is_active', true).order('due_day');
  if (error) throw error;
  return (data as PfBill[]) ?? [];
}
export async function createBill(collaboratorId: string, input: { name: string; amount: number; due_day: number; category: PfCategory; type?: PfBillType; remind_days_before?: number }) {
  const { data, error } = await supabase.from('pf_bills')
    .insert({ collaborator_id: collaboratorId, name: input.name, amount: input.amount, due_day: input.due_day,
              category: input.category, type: input.type ?? 'expense', remind_days_before: input.remind_days_before ?? 2 })
    .select().single();
  if (error) throw error;
  return data;
}
export async function payBill(collaboratorId: string, bill: PfBill) {
  const today = new Date().toISOString().slice(0, 10);
  const { error: e1 } = await supabase.from('pf_bills')
    .update({ last_paid_at: today, status: 'paid' })
    .eq('id', bill.id).eq('collaborator_id', collaboratorId);
  if (e1) throw e1;
  await createTransaction(collaboratorId, {
    type: bill.type, category: bill.category, amount: bill.amount, description: bill.name, transaction_date: today,
  });
}

// ---- Metas (D7: contribuição NÃO vira transação) ----
export async function listGoals(collaboratorId: string) {
  const { data, error } = await supabase.from('pf_goals')
    .select('id, name, target_amount, current_amount, monthly_contribution, deadline, icon')
    .eq('collaborator_id', collaboratorId).eq('is_active', true).order('created_at');
  if (error) throw error;
  return (data as PfGoal[]) ?? [];
}
export async function createGoal(collaboratorId: string, input: { name: string; target_amount: number; monthly_contribution?: number | null; deadline?: string | null; icon?: string | null }) {
  const { data, error } = await supabase.from('pf_goals')
    .insert({ collaborator_id: collaboratorId, name: input.name, target_amount: input.target_amount,
              monthly_contribution: input.monthly_contribution ?? null, deadline: input.deadline ?? null, icon: input.icon ?? null })
    .select().single();
  if (error) throw error;
  return data;
}
export async function addToGoal(collaboratorId: string, goal: PfGoal, addAmount: number) {
  const novo = Number(goal.current_amount) + Number(addAmount);
  const { data, error } = await supabase.from('pf_goals')
    .update({ current_amount: novo, updated_at: new Date().toISOString() })
    .eq('id', goal.id).eq('collaborator_id', collaboratorId)
    .select().single();
  if (error) throw error;
  return data;
}

// ---- Helpers ----
function monthBoundsFromYYYYMM(monthYear: string) {
  const [y, m] = monthYear.split('-').map(Number);
  const start = new Date(Date.UTC(y, m - 1, 1)).toISOString().slice(0, 10);
  const end = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);
  return { start, end };
}
```

- [ ] **Step 2: Validar**

```bash
cd web && npx tsc --noEmit
```
Expected: sem erros.

---

## Task 5: Hooks — `useFinanceiro.ts` + `useRealtimeFinance.ts`

**Files:**
- Create: `web/src/hooks/useFinanceiro.ts`, `web/src/hooks/useRealtimeFinance.ts`

- [ ] **Step 1: `useRealtimeFinance.ts`** (molde literal do `useRealtimeSync.ts:43-79`)

```ts
// Subscribe nas tabelas pf_* da tela ativa. Cleanup ao desmontar.
// Invalida apenas queries do escopo financeiro pra não rebuscar o resto do app.
import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';

export type PfTable = 'pf_transactions' | 'pf_bills' | 'pf_goals' | 'pf_accounts' | 'pf_budgets';

export function useRealtimeFinance(tables: PfTable[], collaboratorId: string | undefined) {
  const qc = useQueryClient();
  useEffect(() => {
    if (!collaboratorId || tables.length === 0) return;
    const channel = supabase.channel(`pf-${collaboratorId}-${tables.join(',')}`);
    for (const table of tables) {
      channel.on(
        'postgres_changes' as never,
        { event: '*', schema: 'public', table, filter: `collaborator_id=eq.${collaboratorId}` },
        () => qc.invalidateQueries({ queryKey: ['financeiro'] }),
      );
    }
    channel.subscribe((status) => { if (import.meta.env.DEV) console.debug('[rt-pf]', status); });
    return () => { supabase.removeChannel(channel); };
  }, [collaboratorId, tables.join(','), qc]);
}
```

- [ ] **Step 2: `useFinanceiro.ts`** (TanStack Query v5 + mutations)

```ts
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../contexts/AuthContext';
import * as fin from '../lib/financeiro';
import type { PfBill, PfCategory, PfGoal, PfTxType } from '../lib/financeiro';

const KEY = ['financeiro'];

export function useFinanceiroAuth() {
  const { collaborator } = useAuth();
  if (!collaborator) throw new Error('Finanças exige usuário autenticado');
  return collaborator.id;
}

export function useAccounts() {
  const cid = useFinanceiroAuth();
  return useQuery({ queryKey: [...KEY, 'accounts', cid], queryFn: () => fin.listAccounts(cid) });
}
export function useTransactions(opts?: { monthYear?: string; category?: PfCategory; type?: PfTxType; limit?: number }) {
  const cid = useFinanceiroAuth();
  return useQuery({ queryKey: [...KEY, 'tx', cid, opts], queryFn: () => fin.listTransactions(cid, opts) });
}
export function useBills() {
  const cid = useFinanceiroAuth();
  return useQuery({ queryKey: [...KEY, 'bills', cid], queryFn: () => fin.listBills(cid) });
}
export function useGoals() {
  const cid = useFinanceiroAuth();
  return useQuery({ queryKey: [...KEY, 'goals', cid], queryFn: () => fin.listGoals(cid) });
}
export function useBudgets() {
  const cid = useFinanceiroAuth();
  return useQuery({ queryKey: [...KEY, 'budgets', cid], queryFn: () => fin.listBudgets(cid) });
}

// Resumo derivado das transações do mês (puro client-side).
export function useSummary() {
  const tx = useTransactions();
  if (!tx.data) return { ...tx, summary: undefined };
  const receitas = tx.data.filter((r) => r.type === 'income').reduce((s, r) => s + Number(r.amount), 0);
  const despesas = tx.data.filter((r) => r.type === 'expense').reduce((s, r) => s + Number(r.amount), 0);
  const porCat: Record<string, number> = {};
  for (const r of tx.data) if (r.type === 'expense') porCat[r.category] = (porCat[r.category] || 0) + Number(r.amount);
  return { ...tx, summary: { receitas, despesas, saldo: receitas - despesas, porCat } };
}

// Mutations — invalidam queryKey ['financeiro'] inteira (igual realtime).
function useFinMutation<T, V>(fn: (cid: string, v: V) => Promise<T>) {
  const cid = useFinanceiroAuth();
  const qc = useQueryClient();
  return useMutation({ mutationFn: (v: V) => fn(cid, v), onSuccess: () => qc.invalidateQueries({ queryKey: KEY }) });
}

export const useCreateTransaction = () => useFinMutation(fin.createTransaction);
export const useDeleteTransaction = () => useFinMutation((cid, id: string) => fin.deleteTransaction(cid, id));
export const useCreateBill        = () => useFinMutation(fin.createBill);
export const usePayBill           = () => useFinMutation((cid, bill: PfBill) => fin.payBill(cid, bill));
export const useCreateGoal        = () => useFinMutation(fin.createGoal);
export const useAddToGoal         = () => useFinMutation((cid, args: { goal: PfGoal; amount: number }) => fin.addToGoal(cid, args.goal, args.amount));
export const useSetBudget         = () => useFinMutation(fin.setBudget);
export const useCreateAccount     = () => useFinMutation(fin.createAccount);
export const useDeactivateAccount = () => useFinMutation((cid, id: string) => fin.deactivateAccount(cid, id));
```

- [ ] **Step 3: Validar**

```bash
cd web && npx tsc --noEmit
```
Expected: sem erros.

---

## Task 6: `FinanceiroPage.tsx` (Dashboard)

**Files:** Modify `FinanceiroPage.tsx` (sobrescreve placeholder), Create `components/BudgetBar.tsx`.

> **A partir desta task, invocar `frontend-design`** e mantê-la ativa pras Tasks 7-10. Cada tela segue: tokens `tom`, `StatCard`, `AdaptiveSheet`, `Fab`. Visual revisado em mobile (375) e desktop (1440).

- [ ] **Step 1: `BudgetBar.tsx`** — barra colorida por threshold (verde <70, amarela <80, vermelha >=80).
  - Props: `{ category: string; spent: number; limit: number; icon?: string }`.
  - Render: nome+emoji, valor `spent/limit`, %, barra Tailwind com largura `${pct}%` e classe de cor por faixa. Sem dependência externa.

- [ ] **Step 2: `FinanceiroPage.tsx`** — composição:
  - `useSummary()`, `useAccounts()`, `useBudgets()`, `useTransactions({ limit: 5 })`.
  - `useRealtimeFinance(['pf_transactions','pf_bills','pf_accounts','pf_budgets','pf_goals'], cid)`.
  - 3 `<StatCard>`: Receitas (`tone="success"`), Despesas (`tone="danger"`), Saldo (`tone="tom"`).
  - Linha de chips com saldos por carteira.
  - Lista de `<BudgetBar>` por categoria com orçamento.
  - Pizza Recharts (`import { PieChart, Pie, Cell, Tooltip } from 'recharts'`) com `porCat`.
  - Linha Recharts dos 6 últimos meses (saldo mensal) — agregar do `listTransactions` (puro client-side, hook helper).
  - Lista das últimas 5 transações.
  - Tabs no topo pra navegar entre `/financeiro/*` (mobile) ou breadcrumb (desktop).
  - `<Fab>` com menu de ações: "Transação", "Conta", "Meta", "Carteira" — abre os respectivos sheets via state local (Task 7+).

- [ ] **Step 3: Validar visual** — `npx tsc --noEmit && npx vite build`, abrir `localhost:4173/financeiro` em 375 e 1440, screenshots. Conferir: sem `brand`, números do hook (não hardcode), gráficos renderizam.

- [ ] **Step 4: Smoke realtime do dashboard** — abrir `/financeiro` no PWA, MCP `execute_sql` insere uma transação no banco; conferir card "Despesas" e pizza atualizam em ~1s sem refresh.

---

## Task 7: `TransacoesPage.tsx` + `TransactionSheet.tsx`

**Files:** Modify `TransacoesPage.tsx`; Create `components/TransactionSheet.tsx`.

- [ ] **Step 1: `TransactionSheet.tsx`** — `AdaptiveSheet` com `<Field>` + `CustomSelect`(tipo, categoria, carteira) + `<DateInput>` + input nativo de valor (Tailwind padrão do CLAUDE.md). Botão "Salvar" chama `useCreateTransaction()`. Em modo edição, prefil + delete via `useDeleteTransaction`.

- [ ] **Step 2: `TransacoesPage.tsx`** — `useTransactions({ monthYear, category, type })` controlado por filtros (chips/CustomSelect). Lista responsiva com emoji por categoria, valor verde/vermelho, data. Tap abre sheet. `useRealtimeFinance(['pf_transactions'], cid)`. Fab "+" abre sheet em modo criação.

- [ ] **Step 3:** `tsc --noEmit && vite build`, screenshot 375/1440. Smoke: criar pelo PWA → aparece. TOM grava no zap → aparece em ~1s.

---

## Task 8: `ContasFixasPage.tsx` + `BillSheet.tsx`

**Files:** Modify `ContasFixasPage.tsx`; Create `components/BillSheet.tsx`.

- [ ] **Step 1: `BillSheet.tsx`** — `Field`+`CustomSelect`(categoria, tipo)+`Field`(due_day numérico 1-31)+valor → `useCreateBill()`.

- [ ] **Step 2: `ContasFixasPage.tsx`** — `useBills()`. Agrupar por `type` (a pagar / a receber). Para cada item: nome, valor, "dia X", **status derivado por `deriveBillStatus(bill)`** com badge (verde paga / amarelo a-vencer / vermelho atrasada). Botão "Marcar paga" chama `usePayBill()`. `useRealtimeFinance(['pf_bills','pf_transactions'], cid)` (pq pagar uma conta cria transação). Fab "+".

- [ ] **Step 3:** Validar + smoke (TOM: `cadastra conta Netflix 40 dia 2` → aparece na tela ativa).

---

## Task 9: `MetasPage.tsx` + `GoalSheet.tsx` + `CompoundInterestSimulator.tsx`

**Files:** Modify `MetasPage.tsx`; Create `components/GoalSheet.tsx`, `components/CompoundInterestSimulator.tsx`.

- [ ] **Step 1: `CompoundInterestSimulator.tsx`** — inputs valor mensal + prazo (anos). Calcula com `futureValue(monthly, MONTHLY_RATE_ESTIMATE, years*12)` + comparativo sem juros. **Rótulo da taxa exato:** `"estimativa ~10,5%/ano"` (spec §9). Mostra os 2 totais e a diferença.

- [ ] **Step 2: `GoalSheet.tsx`** — Field(nome, target_amount, monthly_contribution, deadline opcional) → `useCreateGoal()`.

- [ ] **Step 3: `MetasPage.tsx`** — `useGoals()`. Cards: ícone+nome, barra de progresso (%, current/target), 2 linhas de projeção: `monthsToGoalSimple` e `monthsToGoalWithInterest(target, current, monthly, MONTHLY_RATE_ESTIMATE)` formatadas com `formatMonths`. Botão "Adicionar contribuição" abre input rápido → `useAddToGoal({ goal, amount })`. Logo abaixo dos cards, o `CompoundInterestSimulator`. **NÃO criar transação** ao adicionar contribuição (D7) — o hook só atualiza `current_amount`. Realtime `['pf_goals']`. Fab "+".

- [ ] **Step 4:** Validar + smoke (criar meta → "guardei 500" no zap atualiza progresso da tela ativa).

---

## Task 10: `CarteirasPage.tsx` + `AccountSheet.tsx`

**Files:** Modify `CarteirasPage.tsx`; Create `components/AccountSheet.tsx`.

- [ ] **Step 1: `AccountSheet.tsx`** — Field(nome, tipo via CustomSelect: checking/savings/wallet/investment, icon emoji opcional) → `useCreateAccount()`.

- [ ] **Step 2: `CarteirasPage.tsx`** — `useAccounts()`. Lista de cards: ícone, nome, tipo (badge), **saldo** (trigger do banco). Botão "Desativar" → `useDeactivateAccount()` com confirmação. Realtime `['pf_accounts','pf_transactions']`. Fab "+".

- [ ] **Step 3:** Validar + smoke (criar carteira → registrar transação ligada → saldo atualiza na carteira em ~1s).

---

## Task 11: Cross-user (RLS), build verde, smoke E2E bilateral final

**Files:** nenhum.

- [ ] **Step 1: Cross-user no PWA**

Logado como Luciano (`COLLAB_A`), no console do `localhost:4173`:
```js
const sb = (await import('/src/lib/supabase.ts')).supabase;
const r = await sb.from('pf_transactions').select('id, collaborator_id').neq('collaborator_id', '0576f4b6-183d-4cf1-980e-5c8d5da0177f').limit(5);
console.log('cross-user leak?', r);
```
Expected: `data: []` (RLS retorna vazio mesmo sem filtro explícito). Se vier qualquer linha — STOP, RLS quebrou.

- [ ] **Step 2: Build verde**

```bash
cd web && npx tsc --noEmit && npx vite build
```
Expected: sem erros; bundle não estoura. Conferir que `recharts` ficou em chunk separado (vite logs).

- [ ] **Step 3: Smoke E2E bilateral**

Abra `/financeiro` no PWA. No WhatsApp:
1. `gastei 45 no iFood` → dashboard mostra a transação e despesas atualizam em ~1s, sem refresh.
2. `cadastra conta Netflix 40 dia 2` → vai pra `/financeiro/contas`, aparece com status (atrasada se hoje > dia 2 ou a-vencer).
3. `quero comprar um carro de 15 mil em 2 anos guardando 500 por mês` → vai pra `/financeiro/metas`, meta aparece.
4. `guardei 500 pro carro` → barra de progresso atualiza, **nenhuma** transação criada (D7).

- [ ] **Step 4: Limpar dados de smoke**

`mcp__supabase__execute_sql` (com OK explícito do Alf):
```sql
DELETE FROM pf_transactions WHERE collaborator_id='0576f4b6-183d-4cf1-980e-5c8d5da0177f';
DELETE FROM pf_bills        WHERE collaborator_id='0576f4b6-183d-4cf1-980e-5c8d5da0177f';
DELETE FROM pf_goals        WHERE collaborator_id='0576f4b6-183d-4cf1-980e-5c8d5da0177f';
DELETE FROM pf_accounts     WHERE collaborator_id='0576f4b6-183d-4cf1-980e-5c8d5da0177f';
DELETE FROM pf_budgets      WHERE collaborator_id='0576f4b6-183d-4cf1-980e-5c8d5da0177f';
```

---

## Pontos a confirmar na execução (não bloqueiam plano)

- **`PageShell` ou similar** usado por `Mais.tsx` — Task 2 Step 2 confirma o nome real do shell na execução.
- **`Wallet` em `lucide-react`:** confirmar nome exato do ícone na execução (alternativas: `Coins`, `CircleDollarSign`).
- **`Sidebar.tsx` localização do array** — adicionar o item dentro de `sections.find(s => s.key==='principal')`, posição: depois de Hábitos.
- **Lazy import das 5 telas em `App.tsx`** — Task 6+ ajusta pra `React.lazy` quando o bundle ficar grande.

## Out of scope (registrado)

- Customização do bottom nav.
- Selic viva no PWA (v1.1 — `app_config` lida do `selic.js` do engine).
- Importação de extrato, OCR, integração bancária.
