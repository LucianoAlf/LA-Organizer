# Pagar Conta Fixa Flexível — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir pagar uma conta fixa com valor real do mês (sem alterar o previsto) e via carteira OU cartão de crédito, tanto no PWA quanto pelo TOM (WhatsApp).

**Architecture:** Um primitivo `markBillPaid` (só marca a conta) separa "marcar paga" de "inserir lançamento". O lançamento é roteado por método (cartão→fatura, carteira→caixa, nenhum→caixa sem fonte) reaproveitando `recordCardPurchase`/`writeCashTransaction` (TOM) e `createCardPurchase`/`createTransaction` (PWA). O campo `pf_bills.amount` (previsto) nunca muda.

**Tech Stack:** Node CommonJS (engine + service), React+TS+Tailwind+Vitest (PWA), Supabase.

**Deploy:** `src/`+`skills/` via `scp tom:` + `pm2 restart tom`; `web/` via Stop-hook (Vercel).

**Validação local:** `cd _remote/web && npx tsc --noEmit && npx vite build`; `npx vitest run <arquivo>`; `node --check src/<arquivo>.js`.

---

## File Structure

- `src/services/financeiro-service.js` — add `markBillPaid`; extend `payBill(bill, opts)`; export `markBillPaid`.
- `src/engine.js` — rewrite `case 'pay_bill'` (amount+método+variação); add bill-marking no resolvedor `finance_source`.
- `skills/financeiro-pessoal.md` — documentar `pay_bill` com `amount` + meio de pagamento.
- `web/src/lib/payMethod.ts` — **NEW** helper puro `parsePayMethod(value)` + Vitest.
- `web/src/lib/payMethod.test.ts` — **NEW** testes.
- `web/src/lib/financeiro.ts` — extend `payBill(bill, opts)`.
- `web/src/hooks/useFinanceiro.ts` — `usePayBill` com nova assinatura `{ bill, amount?, account_id?, card?, date? }`.
- `web/src/screens/financeiro/components/PagarContaSheet.tsx` — **NEW** sheet de pagamento.
- `web/src/screens/financeiro/ContasFixasPage.tsx` — abrir o sheet em vez de `confirm()`.

---

## Task 1: Backend service — `markBillPaid` + `payBill(bill, opts)`

**Files:**
- Modify: `src/services/financeiro-service.js:275-287` (substitui `payBill`) + adiciona `markBillPaid`
- Modify: `src/services/financeiro-service.js:686` (export `markBillPaid`)

- [ ] **Step 1: Substituir a função `payBill` (linhas 275-287) por `markBillPaid` + `payBill` estendida**

Substituir exatamente este bloco:

```js
async function payBill(collaboratorId, bill) {
  const today = new Date().toISOString().slice(0, 10);
  const patch = { last_paid_at: today, status: 'paid' };
  if (bill.recurrence === 'once') patch.is_active = false;
  const { error: e1 } = await supabase.from('pf_bills')
    .update(patch)
    .eq('id', bill.id).eq('collaborator_id', collaboratorId);
  if (e1) throw e1;
  await insertTransaction(collaboratorId, {
    type: bill.type, category: bill.category, amount: bill.amount, description: bill.name, transaction_date: today,
  });
  return { ...bill, last_paid_at: today };
}
```

Por:

```js
// Só marca a conta como paga (não insere lançamento). Usado quando o lançamento é
// gravado à parte (ex.: pay_bill no engine via recordCardPurchase/writeCashTransaction).
async function markBillPaid(collaboratorId, bill, date) {
  const day = date || new Date().toISOString().slice(0, 10);
  const patch = { last_paid_at: day, status: 'paid' };
  if (bill.recurrence === 'once') patch.is_active = false;
  const { error } = await supabase.from('pf_bills')
    .update(patch)
    .eq('id', bill.id).eq('collaborator_id', collaboratorId);
  if (error) throw error;
  return { ...bill, last_paid_at: day };
}

// Paga a conta: marca paga + insere o lançamento no valor REAL (default = previsto),
// roteando por método. NUNCA altera bill.amount (previsto). opts:
//   { amount?, account_id?, card_id?, date? }
async function payBill(collaboratorId, bill, opts = {}) {
  const date = opts.date || new Date().toISOString().slice(0, 10);
  const amount = (opts.amount != null && Number(opts.amount) > 0) ? Number(opts.amount) : Number(bill.amount);
  if (opts.card_id && bill.type !== 'income') {
    const card = (await listCards(collaboratorId)).find((c) => c.id === opts.card_id);
    if (card) {
      await insertCardPurchase(collaboratorId, card, {
        category: bill.category, amount, description: bill.name, transaction_date: date, installments: 1,
      });
    } else {
      await insertTransaction(collaboratorId, { type: bill.type, category: bill.category, amount, description: bill.name, transaction_date: date });
    }
  } else if (opts.account_id) {
    await insertTransaction(collaboratorId, { type: bill.type, category: bill.category, amount, description: bill.name, transaction_date: date, account_id: opts.account_id });
  } else {
    await insertTransaction(collaboratorId, { type: bill.type, category: bill.category, amount, description: bill.name, transaction_date: date });
  }
  const marked = await markBillPaid(collaboratorId, bill, date);
  return { ...marked, paid_amount: amount };
}
```

> Nota: `listCards` e `insertCardPurchase` já existem neste arquivo (usados por `recordCardPurchase`). Confirme que `listCards` está definido antes do uso em runtime (são `async function` hoisted — ok).

- [ ] **Step 2: Adicionar `markBillPaid` ao `module.exports`**

Em `src/services/financeiro-service.js:686`, o export atual inclui `createBill, findBills, payBill,`. Adicionar `markBillPaid`:

```js
  createBill, findBills, payBill, markBillPaid,
```

- [ ] **Step 3: Verificar sintaxe**

Run: `node --check src/services/financeiro-service.js`
Expected: sem saída (exit 0).

---

## Task 2: Engine — reescrever `case 'pay_bill'` + marcar conta no resolvedor `finance_source`

**Files:**
- Modify: `src/engine.js:6773-6780` (case `pay_bill`)
- Modify: `src/engine.js:7256-7261` (resolvedor `finance_source`: marcar conta após gravar)

- [ ] **Step 1: Substituir o `case 'pay_bill'` (linhas 6773-6780) inteiro**

Substituir exatamente:

```js
    case 'pay_bill': {
      const cands = await financeService.findBills(cid, params.bill_name || params.name || '');
      if (cands.length === 0) return 'Não achei conta com esse nome.';
      if (cands.length > 1) return 'Achei mais de uma: ' + cands.map((c, i) => `${i + 1}) ${c.name}`).join(', ') + '. Qual delas?';
      const paid = await financeService.payBill(cid, cands[0]);
      outcome.persisted = true; // Fatia C
      return `✅ ${paid.name} marcada como paga (R$${paid.amount}).`;
    }
```

Por:

```js
    case 'pay_bill': {
      const cands = await financeService.findBills(cid, params.bill_name || params.name || '');
      if (cands.length === 0) return 'Não achei conta com esse nome.';
      if (cands.length > 1) return 'Achei mais de uma: ' + cands.map((c, i) => `${i + 1}) ${c.name}`).join(', ') + '. Qual delas?';
      const bill = cands[0];
      const date = p.date || undefined;
      const amount = (p.amount != null && Number(p.amount) > 0) ? Number(p.amount) : Number(bill.amount);
      const srcName = params.account_name || params.account || params.carteira || params.conta || params.card || p.account_name;
      const srcMethod = params.method || params.metodo || params.via || p.method || '';
      const src = srcName ? await financeService.resolveSource(cid, srcName, { type: bill.type, method: srcMethod }) : { kind: 'none' };

      // Colisão carteira×cartão (ex.: "Nubank" é os dois) → pendência binária carregando a conta.
      if (src.kind === 'ambiguous') {
        await pendingIntents.openIntent(cid, 'finance_source', {
          form: 'binary',
          txn: { type: bill.type, category: bill.category, amount, description: bill.name, date },
          bill: { id: bill.id, name: bill.name, recurrence: bill.recurrence, type: bill.type },
          account: { kind: 'account', id: src.account.id, name: src.account.name },
          card: { kind: 'card', id: src.card.id, name: src.card.name },
        }, `${src.account.name}: cartão ou conta?`);
        return `🤔 *${src.account.name}* é carteira e cartão. Foi no *cartão* ou na *conta*?\n_(dica: diz "no crédito" ou "no débito/pix" que eu já anoto direto 😉)_`;
      }

      let reply;
      if (src.kind === 'card' && bill.type !== 'income') {
        reply = await recordCardPurchase(cid, src.card, { amount, description: bill.name, category: bill.category, installments: 1, date }, outcome);
        reply = `✅ *${bill.name}* paga.\n\n` + reply;
      } else if (src.kind === 'account') {
        reply = await writeCashTransaction(cid, { type: bill.type, category: bill.category, amount, description: bill.name, date, account: src.account }, outcome);
        reply = `✅ *${bill.name}* paga.\n\n` + reply;
      } else {
        // none: caixa sem carteira (comportamento atual), no valor REAL.
        await financeService.insertTransaction(cid, { type: bill.type, category: bill.category, amount, description: bill.name, transaction_date: date });
        outcome.persisted = true;
        reply = `✅ *${bill.name}* paga (${financeFmt.money(amount)}).`;
      }
      await financeService.markBillPaid(cid, bill, date);
      if (Math.round(amount * 100) !== Math.round(Number(bill.amount) * 100)) {
        reply += `\n_(previu ${financeFmt.money(Number(bill.amount))} · pagou ${financeFmt.money(amount)})_`;
      }
      return reply;
    }
```

> Reuso: `recordCardPurchase`, `writeCashTransaction`, `financeFmt`, `pendingIntents` já estão no escopo de `handleFinanceAction`. `p` = `normalizeParams(params)` (já no topo da função, linha 6628).

- [ ] **Step 2: No resolvedor `finance_source`, marcar a conta paga quando o payload tem `bill`**

Em `src/engine.js`, dentro do `try` que grava (linhas 7256-7261), logo **após** a atribuição de `reply` (depois da linha 7261 `: await writeCashTransaction(...)`), e **antes** do `catch (writeErr)` (linha 7262), inserir:

Localize:

```js
            reply = useCard
              ? await recordCardPurchase(collab.id, card, { amount: txn.amount, description: txn.description, category: txn.category, installments: txn.installments, date: txn.date })
              : await writeCashTransaction(collab.id, { type: txn.type, category: txn.category, amount: txn.amount, description: txn.description, date: txn.date, account });
```

Adicionar **logo abaixo** (ainda dentro do `try`):

```js
            // pay_bill via pendência: marca a conta paga + headline (o lançamento já foi gravado acima).
            if (finOpen.payload.bill) {
              try {
                await financeService.markBillPaid(collab.id, finOpen.payload.bill, txn.date);
                reply = `✅ *${finOpen.payload.bill.name}* paga.\n\n` + reply;
              } catch (markErr) {
                console.warn('[PayBill] mark err:', markErr.message);
              }
            }
```

- [ ] **Step 3: Verificar sintaxe**

Run: `node --check src/engine.js`
Expected: sem saída (exit 0).

---

## Task 3: Skill — documentar `pay_bill` com valor + meio de pagamento

**Files:**
- Modify: `skills/financeiro-pessoal.md` (seção das actions de conta fixa)

- [ ] **Step 1: Localizar a documentação do `pay_bill`**

Run: `grep -n "pay_bill" skills/financeiro-pessoal.md`
Expected: ao menos uma linha referenciando `pay_bill`.

- [ ] **Step 2: Adicionar/atualizar o bloco de exemplos do `pay_bill`**

Inserir (ou substituir o exemplo existente do `pay_bill`) com este bloco. Se já existir um exemplo de `pay_bill`, substitua-o por este; senão, adicione logo após a doc de `register_bill`:

```markdown
**`pay_bill`** — marcar uma conta fixa como paga. Aceita valor real e meio de pagamento (ambos opcionais):
- `bill_name` (obrigatório): nome da conta ("luz", "condomínio").
- `amount` (opcional): valor REAL pago no mês. Se omitido, usa o valor previsto da conta. Contas como luz/condomínio variam — registre o valor real e o previsto NÃO muda.
- meio de pagamento (opcional): `card` (nome do cartão) OU `account` (nome da carteira). Se omitido, registra sem carteira (igual hoje).

Exemplos:
- "paguei a luz 180" → `{"action":"pay_bill","params":{"bill_name":"luz","amount":180}}`
- "paguei o condomínio no nubank" → `{"action":"pay_bill","params":{"bill_name":"condomínio","card":"nubank"}}`
- "paguei a internet 99 pelo Itaú" → `{"action":"pay_bill","params":{"bill_name":"internet","amount":99,"account":"Itaú"}}`
- "paguei a Netflix" (sem valor/meio) → `{"action":"pay_bill","params":{"bill_name":"Netflix"}}`
```

- [ ] **Step 3: Conferir que não duplicou a regra anti-fabricação** — o bloco "🚨 O PIOR ERRO" continua valendo (confirmação só com marker). Não alterar esse bloco.

---

## Task 4: PWA — helper puro `parsePayMethod` (TDD) + extend `lib/financeiro.ts payBill`

**Files:**
- Create: `web/src/lib/payMethod.ts`
- Create: `web/src/lib/payMethod.test.ts`
- Modify: `web/src/lib/financeiro.ts:236-245` (`payBill`)

- [ ] **Step 1: Escrever o teste que falha** — `web/src/lib/payMethod.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { parsePayMethod } from './payMethod';

describe('parsePayMethod', () => {
  it('none → sem carteira', () => {
    expect(parsePayMethod('none')).toEqual({ kind: 'none' });
  });
  it('acc:<id> → carteira', () => {
    expect(parsePayMethod('acc:abc-123')).toEqual({ kind: 'account', id: 'abc-123' });
  });
  it('card:<id> → cartão', () => {
    expect(parsePayMethod('card:xyz-9')).toEqual({ kind: 'card', id: 'xyz-9' });
  });
  it('vazio/desconhecido → none', () => {
    expect(parsePayMethod('')).toEqual({ kind: 'none' });
    expect(parsePayMethod('lixo')).toEqual({ kind: 'none' });
  });
});
```

- [ ] **Step 2: Rodar o teste e ver falhar**

Run: `cd _remote/web && npx vitest run src/lib/payMethod.test.ts`
Expected: FAIL ("Failed to resolve import './payMethod'" / parsePayMethod is not a function).

- [ ] **Step 3: Implementar `web/src/lib/payMethod.ts`**

```ts
// Picker de "Pago com" no PagarContaSheet: o value do ComboBox codifica o método.
// 'none' | 'acc:<id>' | 'card:<id>'  →  objeto discriminado.
export type PayMethod =
  | { kind: 'none' }
  | { kind: 'account'; id: string }
  | { kind: 'card'; id: string };

export function parsePayMethod(value: string): PayMethod {
  if (value.startsWith('acc:')) return { kind: 'account', id: value.slice(4) };
  if (value.startsWith('card:')) return { kind: 'card', id: value.slice(5) };
  return { kind: 'none' };
}
```

- [ ] **Step 4: Rodar o teste e ver passar**

Run: `cd _remote/web && npx vitest run src/lib/payMethod.test.ts`
Expected: PASS (4 testes).

- [ ] **Step 5: Estender `payBill` em `web/src/lib/financeiro.ts`**

Substituir exatamente o bloco atual (linhas ~236-245):

```ts
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
```

Por:

```ts
// Paga a conta no valor REAL (default = previsto), por método (cartão/carteira/nenhum).
// NUNCA altera bill.amount (previsto). card = { id, closing_day } pra calcular a competência.
export async function payBill(
  collaboratorId: string,
  bill: PfBill,
  opts: { amount?: number; account_id?: string | null; card?: { id: string; closing_day: number } | null; date?: string } = {},
) {
  const date = opts.date || new Date().toISOString().slice(0, 10);
  const amount = (opts.amount != null && opts.amount > 0) ? opts.amount : Number(bill.amount);
  if (opts.card && bill.type !== 'income') {
    const { createCardPurchase } = await import('./cartoes'); // import dinâmico evita ciclo cartoes↔financeiro
    await createCardPurchase(collaboratorId, {
      cardId: opts.card.id, closingDay: opts.card.closing_day, amount,
      category: bill.category, description: bill.name, installments: 1, firstDate: date,
    });
  } else if (opts.account_id) {
    await createTransaction(collaboratorId, { type: bill.type, category: bill.category, amount, description: bill.name, transaction_date: date, account_id: opts.account_id });
  } else {
    await createTransaction(collaboratorId, { type: bill.type, category: bill.category, amount, description: bill.name, transaction_date: date });
  }
  const patch: Record<string, unknown> = { last_paid_at: date, status: 'paid' };
  if (bill.recurrence === 'once') patch.is_active = false;
  const { error } = await supabase.from('pf_bills')
    .update(patch).eq('id', bill.id).eq('collaborator_id', collaboratorId);
  if (error) throw error;
}
```

> `createTransaction` e `supabase` já estão no escopo de `lib/financeiro.ts`. `createCardPurchase` aceita `{ cardId, closingDay, amount, category, description, installments, firstDate }` (ver `lib/cartoes.ts`).

---

## Task 5: PWA — `usePayBill` com nova assinatura

**Files:**
- Modify: `web/src/hooks/useFinanceiro.ts:126`

- [ ] **Step 1: Substituir a linha do `usePayBill`**

Substituir exatamente:

```ts
export const usePayBill           = () => useFinMutation((cid, bill: PfBill) => fin.payBill(cid, bill));
```

Por:

```ts
export const usePayBill           = () => useFinMutation(
  (cid, args: { bill: PfBill; amount?: number; account_id?: string | null; card?: { id: string; closing_day: number } | null; date?: string }) =>
    fin.payBill(cid, args.bill, { amount: args.amount, account_id: args.account_id, card: args.card, date: args.date })
);
```

> `PfBill` já é importado em `useFinanceiro.ts` (linha 12). `fin` = `* as fin from '../lib/financeiro'`.

---

## Task 6: PWA — `PagarContaSheet` + wire na `ContasFixasPage`

**Files:**
- Create: `web/src/screens/financeiro/components/PagarContaSheet.tsx`
- Modify: `web/src/screens/financeiro/ContasFixasPage.tsx`

- [ ] **Step 1: Criar `web/src/screens/financeiro/components/PagarContaSheet.tsx`**

```tsx
// Sheet de pagamento de conta fixa: valor real (default = previsto) + meio de pagamento
// (carteira/cartão/nenhum) + data. Não altera o valor previsto da conta.
import { useEffect, useMemo, useState } from 'react';
import { AdaptiveSheet } from '../../../components/AdaptiveSheet';
import { Button } from '../../../components/Button';
import { ComboBox } from '../../../components/ComboBox';
import { DateInput } from '../../../components/DateInput';
import { Field } from '../../../components/Field';
import { useAccounts, useCards, usePayBill } from '../../../hooks/useFinanceiro';
import { parsePayMethod } from '../../../lib/payMethod';
import type { PfBill } from '../../../lib/financeiro';

function todayYmd() {
  return new Date().toISOString().slice(0, 10);
}
const fmtBRL = (v: number) =>
  'R$ ' + Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function PagarContaSheet({ open, onClose, bill }: { open: boolean; onClose: () => void; bill: PfBill | null }) {
  const accountsQ = useAccounts();
  const cardsQ = useCards();
  const payMut = usePayBill();
  const [amountText, setAmountText] = useState('');
  const [method, setMethod] = useState('none');
  const [date, setDate] = useState(todayYmd());
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !bill) return;
    setAmountText(String(bill.amount));
    setMethod('none');
    setDate(todayYmd());
    setError(null);
  }, [open, bill]);

  const methodOptions = useMemo(() => [
    { value: 'none', label: 'Só registrar (sem carteira)' },
    ...(accountsQ.data ?? []).map((a) => ({ value: `acc:${a.id}`, label: `🏦  ${a.name}` })),
    ...(bill?.type !== 'income' ? (cardsQ.data ?? []).map((c) => ({ value: `card:${c.id}`, label: `💳  ${c.name}` })) : []),
  ], [accountsQ.data, cardsQ.data, bill?.type]);

  if (!bill) return null;

  const amount = Number(amountText.replace(',', '.'));
  const previsto = Number(bill.amount);
  const variou = isFinite(amount) && Math.round(amount * 100) !== Math.round(previsto * 100);

  async function submit() {
    if (!bill) return;
    setError(null);
    if (!isFinite(amount) || amount <= 0) { setError('Informe um valor maior que zero.'); return; }
    const m = parsePayMethod(method);
    const card = m.kind === 'card' ? (cardsQ.data ?? []).find((c) => c.id === m.id) : undefined;
    try {
      await payMut.mutateAsync({
        bill,
        amount,
        account_id: m.kind === 'account' ? m.id : null,
        card: card ? { id: card.id, closing_day: card.closing_day } : null,
        date,
      });
      onClose();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <AdaptiveSheet open={open} onClose={onClose} title={`Pagar ${bill.name}`} size="sm">
      <div className="flex flex-col gap-md p-md">
        <Field label="Valor pago">
          <div className="flex items-baseline gap-2">
            <span className="text-fg-muted text-body-md">R$</span>
            <input
              inputMode="decimal"
              autoFocus
              value={amountText}
              onChange={(e) => setAmountText(e.target.value)}
              placeholder="0,00"
              className="w-full bg-transparent border-0 border-b border-border focus:border-tom outline-none text-[28px] font-black tabular-nums py-1 text-fg placeholder:text-fg-muted/40"
            />
          </div>
        </Field>
        {variou && (
          <p className="text-body-sm text-fg-muted -mt-2">previu {fmtBRL(previsto)} · paga {fmtBRL(amount)}</p>
        )}

        <Field label="Pago com">
          <ComboBox value={method} options={methodOptions} onChange={setMethod} placeholder="Buscar carteira/cartão…" />
        </Field>

        <Field label="Data">
          <DateInput value={date} onChange={setDate} />
        </Field>

        {error && <p className="text-body-sm text-danger">{error}</p>}

        <div className="flex items-center justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={onClose} disabled={payMut.isPending}>Cancelar</Button>
          <Button variant="primary" onClick={submit} disabled={payMut.isPending || !amountText.trim()}>
            {payMut.isPending ? 'Pagando…' : 'Confirmar pagamento'}
          </Button>
        </div>
      </div>
    </AdaptiveSheet>
  );
}
```

> Confirme as props de `ComboBox` (value/options/onChange/placeholder) e `AdaptiveSheet` (open/onClose/title/size) — já usadas em `TransactionSheet.tsx`. `useCards` retorna `PfCard` com `closing_day`.

- [ ] **Step 2: Wire na `ContasFixasPage.tsx` — importar + estado + trocar `confirm()`**

Adicionar import (após a linha 9 `import { BillSheet }`):

```tsx
import { PagarContaSheet } from './components/PagarContaSheet';
```

Adicionar estado (após a linha 99 `const [editing, setEditing] = ...`):

```tsx
  const [payingBill, setPayingBill] = useState<PfBill | null>(null);
```

Substituir a função `pay` (linhas 110-113):

```tsx
  async function pay(bill: PfBill) {
    if (!confirm(`Marcar "${bill.name}" como paga (R$${brl(Number(bill.amount))})?`)) return;
    try { await payMut.mutateAsync(bill); } catch (e) { alert((e as Error).message); }
  }
```

Por:

```tsx
  function pay(bill: PfBill) {
    setPayingBill(bill);
  }
```

> `payMut` deixa de ser usado diretamente aqui (o sheet usa o seu próprio `usePayBill`). Remover a linha `const payMut = usePayBill();` (linha 96) e o import `usePayBill` do `useFinanceiro` se ficar sem uso. Verifique com tsc.

Adicionar o sheet junto aos outros (após a linha 175 `<BillSheet open={!!editing} .../>`):

```tsx
      <PagarContaSheet open={!!payingBill} bill={payingBill} onClose={() => setPayingBill(null)} />
```

- [ ] **Step 3: tsc + build**

Run: `cd _remote/web && npx tsc --noEmit && npx vite build`
Expected: tsc sem erros; build sucesso.

---

## Task 7: Validação + Deploy

- [ ] **Step 1: Rodar a suíte de testes do PWA**

Run: `cd _remote/web && npx vitest run src/lib/payMethod.test.ts`
Expected: PASS.

- [ ] **Step 2: tsc + build final**

Run: `cd _remote/web && npx tsc --noEmit && npx vite build`
Expected: limpos.

- [ ] **Step 3: Sintaxe backend**

Run: `node --check src/engine.js && node --check src/services/financeiro-service.js`
Expected: exit 0.

- [ ] **Step 4: Deploy do engine + skill (SCP + restart)**

```bash
scp D:/la-organizer/_remote/src/services/financeiro-service.js tom:/opt/LA-Organizer/src/services/financeiro-service.js
scp D:/la-organizer/_remote/src/engine.js tom:/opt/LA-Organizer/src/engine.js
scp D:/la-organizer/_remote/skills/financeiro-pessoal.md tom:/opt/LA-Organizer/skills/financeiro-pessoal.md
ssh tom "cd /opt/LA-Organizer && pm2 restart tom && pm2 logs tom --lines 5 --nostream"
```
Expected: pm2 reinicia sem crash; logs sem erro de require/sintaxe.

- [ ] **Step 5: Web** — auto-deploy via Stop hook (não fazer push manual).

---

## Task 8: Review adversarial (Workflow) + smoke E2E

- [ ] **Step 1: Smoke backend no VPS (ambiente real `node --env-file=.env`)**

Script `scripts/smoke-pay-bill.js` exercitando: (a) `payBill` sem opts = previsto + caixa; (b) com `amount` = valor real, `bill.amount` inalterado; (c) com `card_id` = lançamento na fatura; (d) `markBillPaid` marca status/last_paid_at. Rodar com um colaborador de teste e uma conta fixa de teste; limpar ao final.

```bash
scp D:/la-organizer/_remote/scripts/smoke-pay-bill.js tom:/opt/LA-Organizer/scripts/smoke-pay-bill.js
ssh tom "cd /opt/LA-Organizer && node --env-file=.env scripts/smoke-pay-bill.js"
```
Expected: todas as asserções PASS; `bill.amount` previsto inalterado em todos os casos.

- [ ] **Step 2: Workflow de review adversarial** — fan-out de revisores por dimensão:
  - **Regressão:** `pay_bill` sem amount/método = comportamento idêntico ao atual?
  - **Segurança/RLS:** todas as queries filtram `collaborator_id`? `cid` sempre = `collab.id` no engine?
  - **Correção do roteamento:** card→fatura (competência), account→caixa+saldo, none→caixa; receita nunca vai pra cartão.
  - **Invariante:** `bill.amount` (previsto) nunca alterado em nenhum caminho (PWA, TOM, pendência).
  - **UX PWA:** sheet pré-preenche previsto, variação some quando igual, picker lista carteiras+cartões.
  - Verificar cada achado adversarialmente antes de tratar como real.

- [ ] **Step 3: Smoke E2E manual no preview (pós-login)** — abrir ContasFixasPage, "Marcar paga" → sheet; pagar com valor diferente → transação no valor real, previsto intacto; pagar no cartão → cai na fatura.

---

## Self-Review (preenchido)

**Spec coverage:** #2 (valor real sem mexer no previsto) → Tasks 1,4,6 (amount default + invariante). #3 (cartão) → Tasks 1,2,4,6 (roteamento card). TOM → Tasks 2,3. PWA → Tasks 4,5,6. Ambiguidade carteira×cartão → Task 2 (intent + resume). ✓

**Placeholder scan:** sem TBD/TODO; todo passo com código completo. ✓

**Type consistency:** `payBill(cid, bill, opts)` consistente (service e lib); `opts.card = {id, closing_day}` (PWA) vs `opts.card_id` (backend) — DIFEREM de propósito (PWA precisa de closing_day pra competência; backend faz `listCards`). Documentado. `markBillPaid(cid, bill, date)` idêntico nos dois usos no engine. `parsePayMethod` retorna `{kind:'none'|'account'|'card', id?}` consumido no sheet. ✓
