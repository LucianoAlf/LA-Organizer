# Lançamento Unificado no PWA — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Trazer pro PWA o registro de todos os tipos de lançamento (à vista carteira/cartão, parcelado no cartão, conta recorrente, conta única com vencimento) num único `LancamentoSheet`, + editar/excluir conta fixa, fechando o buraco da Task 9 do plano do cartão (nunca executada).

**Architecture:** Migration leve em `pf_bills` (recurrence + due_date) pra suportar conta Única. PWA ganha `createCardPurchase` (espelha o backend), `LancamentoSheet` adaptativo, e edição de bills. Backend/TOM: ajuste mínimo no `register_bill`/`billsDueWithin` pra distinguir única×recorrente. Reusa CRUD da Fase 1 e o backend de cartão já pronto.

**Tech Stack:** Node CommonJS (engine), Supabase Postgres (MCP `apply_migration`/`execute_sql`), React+TS+Tailwind (PWA), node:test (backend puro), Vitest (PWA puro).

**Convenções do projeto (CLAUDE.md):**
- **NÃO commitar entre tasks.** O Stop hook commita+pusha `_remote/` no fim do turno (Vercel deploya `web/` em ~2min). A última linha de cada task é **validação**, não `git commit`.
- **Engine (`src/`, `skills/`) precisa de SCP imediato** pra valer no TOM: `scp /d/la-organizer/_remote/<path> tom:/opt/LA-Organizer/<path> && ssh tom "pm2 restart tom"`.
- **Segurança (service_role ignora RLS):** toda query nova filtra `.eq('collaborator_id', cid)`; cid vem de `collab.id`/sessão, nunca de params.
- Validação PWA: `cd /d/la-organizer/_remote/web && npx tsc --noEmit && npx vite build`. Preview em localhost:4173.
- DS obrigatório: `BottomSheet`/`AdaptiveSheet`, `CustomSelect`, `DateInput`, `Button`, `Field`, `Fab`. Token `tom` (verde). Testar 375 + 1440.

---

## Task 1: Migration — `pf_bills` ganha `recurrence` + `due_date`

**Files:**
- Create: `migrations/20260531_pf_bills_recurrence.sql`
- Apply: via MCP `apply_migration` (name `pf_bills_recurrence`)

- [ ] **Step 1: Escrever a migration**

`migrations/20260531_pf_bills_recurrence.sql`:
```sql
-- Conta Única (vencimento em data cheia) vs Recorrente (todo mês no due_day).
ALTER TABLE pf_bills
  ADD COLUMN IF NOT EXISTS recurrence text NOT NULL DEFAULT 'monthly',
  ADD COLUMN IF NOT EXISTS due_date date;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'pf_bills_recurrence_chk'
  ) THEN
    ALTER TABLE pf_bills
      ADD CONSTRAINT pf_bills_recurrence_chk CHECK (recurrence IN ('monthly','once'));
  END IF;
END $$;
```

- [ ] **Step 2: Aplicar via MCP**

Usar `apply_migration` (project `cesnbnrynvxvgdhfmaua`, name `pf_bills_recurrence`) com o SQL acima.

- [ ] **Step 3: Verificar colunas**

`execute_sql`:
```sql
SELECT column_name, data_type, column_default FROM information_schema.columns
WHERE table_name='pf_bills' AND column_name IN ('recurrence','due_date');
```
Esperado: `recurrence text 'monthly'::text` e `due_date date`.

---

## Task 2: Backend — `createBill` aceita recurrence/due_date; filtro de vencimento puro

**Files:**
- Modify: `src/services/financeiro-service.js:210-216` (createBill), `:273-300` (billsDueWithin)
- Create: `src/finance/bill-due.js` (lógica pura testável)
- Test: `src/finance/__tests__/bill-due.test.js`

- [ ] **Step 1: Escrever o teste da lógica pura (falha primeiro)**

`src/finance/__tests__/bill-due.test.js`:
```js
const test = require('node:test');
const assert = require('node:assert');
const { isBillDue } = require('../bill-due');

const ctx = { dom: 10, todayStr: '2026-06-10', horizonStr: '2026-06-15', monthStart: '2026-06-01' };

test('monthly: a vencer dentro da janela', () => {
  assert.equal(isBillDue({ recurrence: 'monthly', due_day: 12, last_paid_at: null }, ctx), true);
});
test('monthly: atrasada (due_day < hoje) e não paga', () => {
  assert.equal(isBillDue({ recurrence: 'monthly', due_day: 5, last_paid_at: null }, ctx), true);
});
test('monthly: paga este mês não aparece', () => {
  assert.equal(isBillDue({ recurrence: 'monthly', due_day: 5, last_paid_at: '2026-06-03' }, ctx), false);
});
test('once: due_date dentro do horizonte aparece', () => {
  assert.equal(isBillDue({ recurrence: 'once', due_date: '2026-06-14', last_paid_at: null }, ctx), true);
});
test('once: due_date atrasada (antes de hoje) aparece', () => {
  assert.equal(isBillDue({ recurrence: 'once', due_date: '2026-06-02', last_paid_at: null }, ctx), true);
});
test('once: já paga não aparece', () => {
  assert.equal(isBillDue({ recurrence: 'once', due_date: '2026-06-14', last_paid_at: '2026-06-05' }, ctx), false);
});
test('once: muito no futuro não aparece', () => {
  assert.equal(isBillDue({ recurrence: 'once', due_date: '2026-07-20', last_paid_at: null }, ctx), false);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test src/finance/__tests__/bill-due.test.js`
Esperado: FAIL (`Cannot find module '../bill-due'`).

- [ ] **Step 3: Implementar a lógica pura**

`src/finance/bill-due.js`:
```js
'use strict';
// Pura: decide se uma conta deve aparecer no lembrete de vencimento.
// ctx = { dom (dia do mês hoje), todayStr, horizonStr (hoje+days), monthStart (1º dia do mês) }
function isBillDue(bill, ctx) {
  if (bill.recurrence === 'once') {
    if (bill.last_paid_at) return false;
    return !!bill.due_date && bill.due_date <= ctx.horizonStr; // inclui atrasadas e a vencer
  }
  // monthly (default)
  if (bill.last_paid_at && bill.last_paid_at >= ctx.monthStart) return false;
  const aVencer = bill.due_day >= ctx.dom && bill.due_day <= ctx.dom + (ctxDays(ctx));
  const atrasada = bill.due_day < ctx.dom;
  return aVencer || atrasada;
}
function ctxDays(ctx) {
  // janela em dias = diferença entre horizonStr e todayStr
  const a = new Date(ctx.todayStr + 'T00:00:00Z'), b = new Date(ctx.horizonStr + 'T00:00:00Z');
  return Math.round((b - a) / 86400000);
}
module.exports = { isBillDue };
```

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test src/finance/__tests__/bill-due.test.js`
Esperado: PASS (7/7).

- [ ] **Step 5: Estender `createBill` (financeiro-service.js:210)**

Substituir a função por:
```js
async function createBill(collaboratorId, { name, amount, due_day, category, type = 'expense', remind_days_before = 2, recurrence = 'monthly', due_date = null }) {
  const row = { collaborator_id: collaboratorId, name, amount, category, type, remind_days_before, recurrence };
  if (recurrence === 'once') {
    if (!due_date) throw new Error('conta única exige due_date');
    row.due_date = due_date;
    row.due_day = Number(due_date.slice(8, 10)); // dia da data cheia (satisfaz NOT NULL)
  } else {
    row.due_day = due_day;
  }
  const { data, error } = await supabase.from('pf_bills').insert(row).select().single();
  if (error) throw error;
  return data;
}
```

- [ ] **Step 6: Reescrever `billsDueWithin` pra usar a lógica pura (financeiro-service.js:273)**

```js
async function billsDueWithin(collaboratorId, days = 5) {
  const { isBillDue } = require('../finance/bill-due');
  const now = new Date();
  const dom = now.getUTCDate();
  const todayStr = now.toISOString().slice(0, 10);
  const horizonStr = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + days)).toISOString().slice(0, 10);
  const { start } = monthBounds();
  const { data, error } = await supabase.from('pf_bills')
    .select('name, amount, due_day, due_date, recurrence, type, last_paid_at, category')
    .eq('collaborator_id', collaboratorId).eq('is_active', true);
  if (error) throw error;
  const ctx = { dom, todayStr, horizonStr, monthStart: start };
  return (data || []).filter((b) => isBillDue(b, ctx));
}
```

- [ ] **Step 7: `node --check` + rodar suite**

Run: `node --check src/services/financeiro-service.js && node --test src/finance/__tests__/bill-due.test.js`
Esperado: sem erro de sintaxe; 7/7 PASS.

---

## Task 3: Backend/Engine — `register_bill` distingue única×recorrente; `pay_bill` desativa única; skill

**Files:**
- Modify: `src/engine.js:6099` (register_bill handler)
- Modify: `src/services/financeiro-service.js` (payBill — localizar handler de `pay_bill`)
- Modify: `skills/financeiro-pessoal.md:47`

- [ ] **Step 1: Atualizar handler `register_bill` (engine.js:6099)**

```js
case 'register_bill': {
  const recurrence = params.recurrence === 'once' ? 'once' : 'monthly';
  const b = await financeService.createBill(cid, {
    name: params.name, amount: params.amount,
    due_day: params.due_day,
    due_date: params.due_date || null,
    recurrence,
    category: params.category || mapCategory(params.name || ''),
    type: params.type || 'expense', remind_days_before: params.remind_days_before,
  });
  const quando = recurrence === 'once' ? `vence ${b.due_date}` : `todo dia ${b.due_day}`;
  return `✅ Conta cadastrada: ${b.name} (R$${b.amount}, ${quando}).`;
}
```

- [ ] **Step 2: Localizar e ajustar `pay_bill` pra desativar conta única ao quitar**

Run (localizar): `grep -n "last_paid_at" src/services/financeiro-service.js`
Na função que marca a conta como paga (seta `last_paid_at`), após o update, adicionar: se a bill for `recurrence='once'`, setar também `is_active=false` no mesmo update. Mostrar o padrão concreto após inspeção — o update deve virar:
```js
const patch = { last_paid_at: today, status: 'paid' };
if (bill.recurrence === 'once') patch.is_active = false;
await supabase.from('pf_bills').update(patch).eq('id', bill.id).eq('collaborator_id', collaboratorId);
```
(Se o select da bill não traz `recurrence`, adicionar `recurrence` ao `.select(...)`.)

- [ ] **Step 3: Documentar na skill (financeiro-pessoal.md:47)**

Substituir a linha do `register_bill` por:
```
- `register_bill` — params: name, amount, category, type, remind_days_before, **recurrence** ('monthly'|'once'), e:
    - recorrente (todo mês): `recurrence: 'monthly'`, `due_day` (1-31). Ex.: "conta de luz todo dia 10".
    - única (vence uma vez): `recurrence: 'once'`, `due_date` (YYYY-MM-DD). Ex.: "boleto do IPVA 800 vence 15/06".
- `pay_bill` — params: bill_name. Conta única some após paga (não reabre).
```

- [ ] **Step 4: Validar sintaxe + deploy engine**

Run: `node --check src/engine.js && node --check src/services/financeiro-service.js`
Deploy: `scp /d/la-organizer/_remote/src/engine.js tom:/opt/LA-Organizer/src/engine.js && scp /d/la-organizer/_remote/src/services/financeiro-service.js tom:/opt/LA-Organizer/src/services/financeiro-service.js && scp /d/la-organizer/_remote/src/finance/bill-due.js tom:/opt/LA-Organizer/src/finance/bill-due.js && scp /d/la-organizer/_remote/skills/financeiro-pessoal.md tom:/opt/LA-Organizer/skills/financeiro-pessoal.md && ssh tom "pm2 restart tom"`
Esperado: deploy OK, sem erro de sintaxe.

---

## Task 4: PWA — `addMonthsToCompetencia` + `splitInstallments` (puros, Vitest)

**Files:**
- Modify: `web/src/lib/cartoes.ts` (já tem `competenciaFor`/`currentCompetencia`/`mesDaCompetencia`)
- Test: `web/src/lib/__tests__/cartoes.test.ts`

- [ ] **Step 1: Escrever testes (falham primeiro)**

`web/src/lib/__tests__/cartoes.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { addMonthsToCompetencia, splitInstallments } from '../cartoes';

describe('addMonthsToCompetencia', () => {
  it('soma meses virando o ano', () => {
    expect(addMonthsToCompetencia('2026-11-01', 3)).toBe('2027-02-01');
  });
  it('zero meses é identidade', () => {
    expect(addMonthsToCompetencia('2026-05-01', 0)).toBe('2026-05-01');
  });
});

describe('splitInstallments', () => {
  it('divide exato', () => {
    expect(splitInstallments(100, 4)).toEqual([25, 25, 25, 25]);
  });
  it('joga o resto (centavos) na última parcela', () => {
    // 100/3 = 33.33 + 33.33 + 33.34
    expect(splitInstallments(100, 3)).toEqual([33.33, 33.33, 33.34]);
  });
  it('1 parcela = valor cheio', () => {
    expect(splitInstallments(120, 1)).toEqual([120]);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd /d/la-organizer/_remote/web && npx vitest run src/lib/__tests__/cartoes.test.ts`
Esperado: FAIL (exports não existem).

- [ ] **Step 3: Implementar em cartoes.ts (adicionar após `competenciaFor`)**

```ts
export function addMonthsToCompetencia(compStr: string, n: number): string {
  const d = new Date(compStr + 'T00:00:00Z');
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1)).toISOString().slice(0, 10);
}

// Divide `amount` em `n` parcelas; o resto de centavos vai na última. Espelha o backend.
export function splitInstallments(amount: number, n: number): number[] {
  const total = Math.max(1, Math.floor(n));
  const cents = Math.round(Number(amount) * 100);
  const per = Math.floor(cents / total);
  return Array.from({ length: total }, (_, i) =>
    ((i === total - 1 ? per + (cents - per * total) : per) / 100)
  );
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `cd /d/la-organizer/_remote/web && npx vitest run src/lib/__tests__/cartoes.test.ts`
Esperado: PASS.

---

## Task 5: PWA — `createCardPurchase` em cartoes.ts

**Files:**
- Modify: `web/src/lib/cartoes.ts`

- [ ] **Step 1: Implementar `createCardPurchase` (espelha `insertCardPurchase` do backend)**

```ts
export async function createCardPurchase(
  collaboratorId: string,
  input: { cardId: string; closingDay: number; amount: number; category: string;
           description?: string | null; installments?: number; firstDate?: string }
) {
  const base = input.firstDate ? new Date(input.firstDate + 'T00:00:00Z') : new Date();
  const dateStr = base.toISOString().slice(0, 10);
  const baseComp = competenciaFor(base, input.closingDay);
  const n = Math.max(1, Math.floor(input.installments ?? 1));
  const values = splitInstallments(input.amount, n);
  const rows = values.map((amt, i) => ({
    collaborator_id: collaboratorId, card_id: input.cardId, type: 'expense' as const,
    category: input.category, description: input.description ?? null,
    transaction_date: dateStr, via: 'pwa',
    ...(n > 1 ? { installment_no: i + 1, installments_total: n } : {}),
    competencia: addMonthsToCompetencia(baseComp, i),
    amount: amt,
  }));
  const { data, error } = await supabase.from('pf_transactions').insert(rows).select();
  if (error) throw error;
  if (n > 1) {
    const groupId = (data!.find((d: { installment_no?: number }) => d.installment_no === 1)?.id) || data![0].id;
    const upd = await supabase.from('pf_transactions').update({ purchase_group: groupId })
      .in('id', data!.map((d: { id: string }) => d.id)).eq('collaborator_id', collaboratorId);
    if (upd.error) throw upd.error;
  }
  return data;
}
```

- [ ] **Step 2: `tsc --noEmit`**

Run: `cd /d/la-organizer/_remote/web && npx tsc --noEmit`
Esperado: sem erros.

---

## Task 6: PWA — `financeiro.ts`: bill once + updateBill + deactivateBill + deleteTransactionGroup

**Files:**
- Modify: `web/src/lib/financeiro.ts` (PfBill:21, createBill:160)

- [ ] **Step 1: Estender o tipo `PfBill` (linha 21)**

```ts
export interface PfBill {
  id: string; name: string; amount: number; due_day: number; category: PfCategory;
  type: PfBillType; status: 'pending' | 'paid' | 'overdue'; last_paid_at: string | null;
  recurrence: 'monthly' | 'once'; due_date: string | null;
}
```

- [ ] **Step 2: Estender `createBill` (linha 160)**

```ts
export async function createBill(collaboratorId: string, input: { name: string; amount: number; due_day?: number; category: PfCategory; type?: PfBillType; remind_days_before?: number; recurrence?: 'monthly' | 'once'; due_date?: string | null }) {
  const recurrence = input.recurrence === 'once' ? 'once' : 'monthly';
  const row: Record<string, unknown> = {
    collaborator_id: collaboratorId, name: input.name, amount: input.amount,
    category: input.category, type: input.type ?? 'expense',
    remind_days_before: input.remind_days_before ?? 2, recurrence,
  };
  if (recurrence === 'once') {
    if (!input.due_date) throw new Error('Conta única exige data de vencimento.');
    row.due_date = input.due_date;
    row.due_day = Number(input.due_date.slice(8, 10));
  } else {
    row.due_day = input.due_day;
  }
  const { data, error } = await supabase.from('pf_bills').insert(row).select().single();
  if (error) throw error;
  return data;
}
```

- [ ] **Step 3: Adicionar `updateBill`, `deactivateBill`, `deleteTransactionGroup`**

```ts
export async function updateBill(collaboratorId: string, id: string, patch: { name?: string; amount?: number; due_day?: number; category?: PfCategory; type?: PfBillType; remind_days_before?: number; recurrence?: 'monthly' | 'once'; due_date?: string | null }) {
  const allowed: Record<string, unknown> = {};
  for (const k of ['name', 'amount', 'due_day', 'category', 'type', 'remind_days_before', 'recurrence', 'due_date'] as const) {
    if (patch[k] !== undefined) allowed[k] = patch[k];
  }
  const { data, error } = await supabase.from('pf_bills')
    .update(allowed).eq('id', id).eq('collaborator_id', collaboratorId).select().single();
  if (error) throw error;
  return data;
}

export async function deactivateBill(collaboratorId: string, id: string) {
  const { error } = await supabase.from('pf_bills')
    .update({ is_active: false }).eq('id', id).eq('collaborator_id', collaboratorId);
  if (error) throw error;
}

// Apaga TODAS as parcelas de um grupo (compra parcelada).
export async function deleteTransactionGroup(collaboratorId: string, purchaseGroup: string) {
  const { error } = await supabase.from('pf_transactions')
    .delete().eq('purchase_group', purchaseGroup).eq('collaborator_id', collaboratorId);
  if (error) throw error;
}
```

- [ ] **Step 4: `tsc --noEmit`**

Run: `cd /d/la-organizer/_remote/web && npx tsc --noEmit`
Esperado: sem erros.

---

## Task 7: PWA — hooks novos em `useFinanceiro.ts`

**Files:**
- Modify: `web/src/hooks/useFinanceiro.ts`

- [ ] **Step 1: Adicionar os hooks (seguindo o padrão `useFinMutation`)**

```ts
export const useCreateCardPurchase = () => useFinMutation(
  (cid, args: Parameters<typeof cartoes.createCardPurchase>[1]) => cartoes.createCardPurchase(cid, args)
);
export const useUpdateBill = () => useFinMutation(
  (cid, args: { id: string; patch: Parameters<typeof fin.updateBill>[2] }) => fin.updateBill(cid, args.id, args.patch)
);
export const useDeactivateBill = () => useFinMutation(
  (cid, id: string) => fin.deactivateBill(cid, id)
);
export const useDeleteTransactionGroup = () => useFinMutation(
  (cid, purchaseGroup: string) => fin.deleteTransactionGroup(cid, purchaseGroup)
);
```
(Confirmar que `cartoes` e `fin` já são importados no topo do arquivo; se não, adicionar `import * as cartoes from '../lib/cartoes';`.)

- [ ] **Step 2: `tsc --noEmit`**

Run: `cd /d/la-organizer/_remote/web && npx tsc --noEmit`
Esperado: sem erros.

---

## Task 8: PWA — `LancamentoSheet.tsx` (núcleo) — esqueleto + tipo "À vista"

**Files:**
- Create: `web/src/screens/financeiro/components/LancamentoSheet.tsx`
- Referência de padrão: `TransactionSheet.tsx` (toggle, CustomSelect, DateInput, submit) e `BillSheet.tsx`

- [ ] **Step 1: Criar o sheet com toggle Despesa/Receita, segmented Tipo e campos comuns; submeter só "À vista"**

Estrutura (seguir EXATAMENTE os componentes/classes do `TransactionSheet.tsx`):
- Props: `{ open: boolean; onClose: () => void }`.
- Estado: `type: 'expense'|'income'`, `tipo: 'avista'|'parcelar'|'recorrente'|'agendar'`, `amount`, `category`, `medio` (id do meio: prefixo `acc:` carteira ou `card:` cartão), `description`, `date`, `installments`, `dueDate`, `dueDay`.
- Hooks de dados: `useAccounts()`, `useCards()` (se não existir, usar `cartoes.listCards` via query existente — checar em useFinanceiro), `useCreateTransaction`, `useCreateCardPurchase`, `useCreateBill`.
- **Toggle Despesa/Receita**: idêntico ao `TransactionSheet`. Quando `income`, forçar `tipo='avista'` e esconder o segmented (receita não parcela/agenda).
- **Segmented Tipo** (só quando `expense`): À vista · Parcelar · Recorrente · Agendar (classes do mockup, token `tom`).
- **Meio de pagamento**: `CustomSelect` unificado — opções = carteiras (`acc:<id>` "🏦 Nome") + cartões (`card:<id>` "💳 Nome"). Em `parcelar`, filtrar só cartões. Em `recorrente`/`agendar`, o meio é opcional (a conta é "a pagar"; o pagamento sai depois).
- **Categoria**: `CustomSelect` data-driven (mesmo de `TransactionSheet`).
- **Submit "À vista"**:
  ```ts
  const isCard = medio.startsWith('card:');
  if (tipo === 'avista') {
    if (isCard) {
      const card = cards.find(c => c.id === medio.slice(5))!;
      await createCardPurchase.mutateAsync({ cardId: card.id, closingDay: card.closing_day, amount, category, description, installments: 1, firstDate: date });
    } else {
      const accId = medio.startsWith('acc:') ? medio.slice(4) : null;
      await createTransaction.mutateAsync({ type, category, amount, description, transaction_date: date, account_id: accId });
    }
    onClose();
  }
  ```

- [ ] **Step 2: `tsc --noEmit` + build**

Run: `cd /d/la-organizer/_remote/web && npx tsc --noEmit && npx vite build`
Esperado: sem erros.

---

## Task 9: PWA — `LancamentoSheet`: tipos Parcelar / Recorrente / Agendar + preview

**Files:**
- Modify: `web/src/screens/financeiro/components/LancamentoSheet.tsx`

- [ ] **Step 1: Campos condicionais + submit por tipo**

- **Parcelar**: campo `installments` (CustomSelect 2–24 ou input number) + `DateInput` 1ª parcela; meio travado em cartão. Preview: `≈ R$ {(amount/installments).toFixed(2)}/mês · {installments}× · vai pra fatura` (usar `splitInstallments(amount, installments)[0]` p/ exibir a parcela). Submit:
  ```ts
  if (tipo === 'parcelar') {
    const card = cards.find(c => c.id === medio.slice(5))!;
    await createCardPurchase.mutateAsync({ cardId: card.id, closingDay: card.closing_day, amount, category, description, installments, firstDate: date });
    onClose();
  }
  ```
- **Recorrente**: `CustomSelect` dia 1–31 (`dueDay`). Submit:
  ```ts
  if (tipo === 'recorrente') {
    await createBill.mutateAsync({ name: description || category, amount, category, type, due_day: dueDay, recurrence: 'monthly' });
    onClose();
  }
  ```
- **Agendar (Única)**: `DateInput` `dueDate`. Submit:
  ```ts
  if (tipo === 'agendar') {
    await createBill.mutateAsync({ name: description || category, amount, category, type, recurrence: 'once', due_date: dueDate });
    onClose();
  }
  ```
- Validações mínimas: bloquear submit se `amount<=0`; parcelar exige cartão selecionado; agendar exige `dueDate`.

- [ ] **Step 2: `tsc --noEmit` + build**

Run: `cd /d/la-organizer/_remote/web && npx tsc --noEmit && npx vite build`
Esperado: sem erros.

---

## Task 10: PWA — fiar o `+` no `LancamentoSheet` (FinanceiroPage + TransacoesPage)

**Files:**
- Modify: `web/src/screens/financeiro/FinanceiroPage.tsx:225-229` (Fab)
- Modify: `web/src/screens/financeiro/TransacoesPage.tsx` (Fab/novo)

- [ ] **Step 1: FinanceiroPage — Fab abre LancamentoSheet**

Adicionar estado `const [novoLanc, setNovoLanc] = useState(false);`, trocar `onClick` do `<Fab>` (linha 228) para `() => setNovoLanc(true)`, e montar `<LancamentoSheet open={novoLanc} onClose={() => setNovoLanc(false)} />` antes do fechamento do componente. Remover o `navigate('/financeiro/transacoes?new=1')`. (Importar `useState` e `LancamentoSheet`.)

- [ ] **Step 2: TransacoesPage — `+` abre LancamentoSheet (create); TransactionSheet fica só edição**

Localizar onde `TransactionSheet` abre em modo create (provavelmente via query `?new=1` ou um Fab). Trocar o create pra abrir `LancamentoSheet`. `TransactionSheet` continua sendo aberto ao clicar numa transação (edição). 
Run (localizar): `grep -n "new=1\|TransactionSheet\|Fab" web/src/screens/financeiro/TransacoesPage.tsx`

- [ ] **Step 3: `tsc --noEmit` + build + preview**

Run: `cd /d/la-organizer/_remote/web && npx tsc --noEmit && npx vite build`
Preview: abrir localhost:4173, tocar no `+`, confirmar que o `LancamentoSheet` abre com os 4 tipos.

---

## Task 11: PWA — `FinanceiroPage` expõe Cartões

**Files:**
- Modify: `web/src/screens/financeiro/FinanceiroPage.tsx`
- Referência: `FinanceQuickLinks.tsx` (atalhos existentes)

- [ ] **Step 1: Adicionar atalho/seção "Cartões"**

Verificar como `FinanceQuickLinks` monta os atalhos (Carteiras, Contas Fixas, Metas). Adicionar um item **Cartões** que navega pra rota da `CartoesPage` (localizar a rota: `grep -rn "CartoesPage" web/src`). Se `FinanceQuickLinks` já tiver o padrão, só somar o item; senão, adicionar um card de atalho na `FinanceiroPage` ao lado dos demais.

- [ ] **Step 2: `tsc --noEmit` + build + preview**

Run: `cd /d/la-organizer/_remote/web && npx tsc --noEmit && npx vite build`
Preview: confirmar atalho "Cartões" visível e navegando pra lista de cartões.

---

## Task 12: PWA — `BillSheet` ganha edição + exclusão; `ContasFixasPage` fia

**Files:**
- Modify: `web/src/screens/financeiro/components/BillSheet.tsx`
- Modify: `web/src/screens/financeiro/ContasFixasPage.tsx`

- [ ] **Step 1: BillSheet — prop `initial` + save + delete**

- Props: `{ open: boolean; onClose: () => void; initial?: PfBill }`. `isEdit = !!initial`.
- Pré-preencher campos a partir de `initial` (incl. `recurrence`/`due_date`/`due_day`). Title: `isEdit ? 'Editar conta' : 'Nova conta fixa'`.
- Hooks: somar `useUpdateBill()` e `useDeactivateBill()`.
- `save()`: `await updateMut.mutateAsync({ id: initial!.id, patch: { name, amount, due_day, category, type } })` → `onClose()`.
- `remove()`: `await deactivateMut.mutateAsync(initial!.id)` → `onClose()`.
- Footer: em `isEdit`, botão **Excluir** (`Button variant="danger"`) à esquerda + Cancelar + Salvar (padrão do `TransactionSheet`).

- [ ] **Step 2: ContasFixasPage — click na row edita; passar `initial`**

- Estado: `const [editing, setEditing] = useState<PfBill | null>(null);`
- `BillRow` ganha `onClick={() => setEditing(bill)}` (linha da conta vira clicável).
- Montar segundo sheet: `<BillSheet open={!!editing} initial={editing ?? undefined} onClose={() => setEditing(null)} />` (manter o de criação `creating` separado).

- [ ] **Step 3: `tsc --noEmit` + build + preview**

Run: `cd /d/la-organizer/_remote/web && npx tsc --noEmit && npx vite build`
Preview: criar conta recorrente, abrir editando, mudar valor (salva), excluir (some da lista).

---

## Task 13: PWA — realtime de `pf_transfers`

**Files:**
- Modify: `web/src/hooks/useRealtimeFinance.ts` (ou onde as tabelas são assinadas nas páginas)

- [ ] **Step 1: Incluir `pf_transfers` nas assinaturas**

Localizar as chamadas `useRealtimeFinance([...tabelas], cid)` (FinanceiroPage, CarteirasPage etc.) e somar `'pf_transfers'` onde fizer sentido (CarteirasPage e FinanceiroPage). 
Run (localizar): `grep -rn "useRealtimeFinance(" web/src`

- [ ] **Step 2: `tsc --noEmit` + build**

Run: `cd /d/la-organizer/_remote/web && npx tsc --noEmit && npx vite build`
Esperado: sem erros.

---

## Task 14: Verificação E2E + reconciliação + deploy final

**Files:** nenhum novo (deploy + smoke).

- [ ] **Step 1: Suite completa**

Run backend: `node --test src/finance/__tests__/bill-due.test.js`
Run PWA: `cd /d/la-organizer/_remote/web && npx vitest run && npx tsc --noEmit && npx vite build`
Esperado: tudo verde.

- [ ] **Step 2: Smoke PWA (preview localhost:4173)**

Criar, pelo `+`, um de cada tipo (limpar SW cache antes): À vista no cartão Nubank, Parcelado 3× no cartão, Recorrente dia 10, Agendar vence 15/06. Conferir que aparecem (parcela na fatura do cartão; recorrente/única em Contas Fixas).

- [ ] **Step 3: Reconciliação no banco**

`execute_sql` (cid Luciano `0576f4b6-183d-4cf1-980e-5c8d5da0177f`):
```sql
-- parcelas do grupo coerentes
SELECT purchase_group, count(*), array_agg(competencia ORDER BY installment_no), sum(amount)
FROM pf_transactions WHERE collaborator_id='0576f4b6-183d-4cf1-980e-5c8d5da0177f'
  AND purchase_group IS NOT NULL GROUP BY purchase_group ORDER BY 1 DESC LIMIT 5;
-- bills única vs recorrente
SELECT name, recurrence, due_day, due_date, is_active FROM pf_bills
WHERE collaborator_id='0576f4b6-183d-4cf1-980e-5c8d5da0177f' ORDER BY created_at DESC LIMIT 5;
-- saldo das contas bate (armazenado = calculado)
SELECT a.name, a.balance, COALESCE(SUM(CASE WHEN t.type='income' THEN t.amount ELSE -t.amount END),0) calc
FROM pf_accounts a LEFT JOIN pf_transactions t ON t.account_id=a.id AND t.card_id IS NULL
WHERE a.collaborator_id='0576f4b6-183d-4cf1-980e-5c8d5da0177f' AND a.is_active GROUP BY a.id, a.name, a.balance;
```
Esperado: parcelas com competências sequenciais e soma = valor; bill única com due_date+is_active; saldos batendo.

- [ ] **Step 4: Smoke WhatsApp (engine já deployado na Task 3)**

Enviar: "comprei TV 3200 em 10x no nubank" (parcela), "conta de luz 150 todo dia 10" (recorrente), "boleto do IPVA 800 vence 15/06" (única). Conferir respostas e que nada vira órfã.

- [ ] **Step 5: Encerrar o turno (auto-deploy commita web/ → Vercel)**

Engine já foi por SCP na Task 3. O Stop hook commita+pusha `_remote/` (inclui `web/` + migration + specs/plans). Nada manual.

---

## Notas de execução
- **Ordem:** Tasks 1→3 (DB+backend+engine, deploy imediato), 4→7 (dados PWA), 8→9 (sheet), 10→13 (wiring/UI), 14 (verificação). 8 e 9 são as mais pesadas (modelo Opus recomendado); o resto Sonnet.
- **Reuso (DRY):** `createCardPurchase` espelha `insertCardPurchase`; `LancamentoSheet` reusa classes/componentes do `TransactionSheet`; edição de transação continua no `TransactionSheet` da Fase 1 (não reimplementar).
- **Segurança:** toda função nova de `lib/` filtra `.eq('collaborator_id', cid)` — conferir em createCardPurchase, updateBill, deactivateBill, deleteTransactionGroup.
