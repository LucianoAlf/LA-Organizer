# Pagar Conta Fixa Flexível — Design

**Data:** 2026-06-10
**Origem:** Pedidos da Rose (via Alf) — uso pessoal das Finanças.
**Escopo:** PWA + TOM (WhatsApp). Bug de perda-de-estado (#1) fica em trilha separada.

## Problema

Hoje o pagamento de uma conta fixa (`payBill`) sempre:
1. Registra a transação com o **valor previsto** fixo (`bill.amount`).
2. Cria uma transação de **caixa sem carteira** (não dá pra pagar no cartão).

Dores da Rose:
- **#2 — Valor varia por mês** (luz, condomínio, cartão). Ela quer lançar o **valor real do mês** sem alterar o **valor previsto** (que serve de estimativa pro orçamento).
- **#3 — Pagar no cartão de crédito.** Ela usa muito recorrência no cartão; pagar a conta fixa via cartão deve lançar na **fatura** (competência certa), não debitar carteira.

## Princípio de design

Uma única mudança semântica no **pagamento de conta** atende os dois lados (PWA e TOM), reaproveitando peças que já existem no engine: `resolveSource()` (nome→carteira/cartão + ambiguidade), `recordCardPurchase()` / `insertCardPurchase()`, `writeCashTransaction()`.

**Invariante central:** o campo `pf_bills.amount` (valor previsto) **NUNCA é alterado** por um pagamento. O valor real do mês vive só na transação/fatura gerada.

## Arquitetura

### Unidade 1 — Serviço de pagamento (backend `financeiro-service.js` + PWA `lib/financeiro.ts`)

Estender a assinatura para:

```
payBill(collaboratorId, bill, opts?)
opts = { amount?: number, account_id?: string|null, card_id?: string|null, date?: string }
```

Comportamento:
- `amount` = valor real. Default = `bill.amount` (previsto). **Não toca em `bill.amount`.**
- Marca a conta paga: `last_paid_at = date`, `status = 'paid'`; se `recurrence === 'once'` → `is_active = false`.
- Roteia o lançamento por método:
  - `card_id` presente → **compra no cartão** (`insertCardPurchase`, 1 parcela à vista, competência pela `closing_day`). Categoria = `bill.category`, descrição = `bill.name`.
  - `account_id` presente → transação de caixa com `account_id` (trigger debita o saldo).
  - nenhum → transação de caixa **sem** carteira (comportamento atual preservado — não surpreende quem já usa).
- `type` = `bill.type` (income/expense). Para pagamento de cartão só faz sentido `expense`; se `bill.type==='income'` o `card_id` é ignorado (receita não vai pra fatura).

Contrato no PWA (`lib/financeiro.ts`): mesma semântica, usando `cartoes.createCardPurchase` quando `card_id`, senão `createTransaction`. Mantém `collaborator_id` explícito (RLS).

### Unidade 2 — PWA: `PagarContaSheet`

Hoje `ContasFixasPage` chama `confirm()` + `payBill(bill)` cru. Vira um mini-sheet (`AdaptiveSheet`/`BottomSheet`), pré-preenchido (≈2 toques):

- **Valor** — input numérico, default = valor previsto, editável. (#2)
- **Pago com** — `ComboBox` único listando: opção default `"Só registrar (sem carteira)"`, depois 🏦 carteiras (`useAccounts`), depois 💳 cartões (`useCards`). Cada opção carrega um discriminador (`kind: 'none'|'account'|'card'` + id). (#3)
- **Data** — `DateInput`, default hoje.
- **Linha de variação** (discreta): se `valor real ≠ previsto`, mostra `previu R$X · paga R$Y`.
- Botão **"Confirmar pagamento"** → `usePayBill().mutateAsync({ bill, amount, account_id, card_id, date })`.

`ContasFixasPage`: o botão "Marcar paga" passa a abrir o sheet (estado `payingBill: PfBill | null`) em vez do `confirm()`.

`usePayBill` hook: assinatura passa a aceitar `{ bill, amount?, account_id?, card_id?, date? }`.

### Unidade 3 — TOM: estender o case `pay_bill` (engine.js)

Reusa o padrão do `register_transaction`:
- `params.amount` (opcional) → valor real; default = previsto.
- Método via `params.account_name || params.account || params.carteira || params.conta || params.card` + `params.method` → `resolveSource(cid, name, { type: bill.type, method })`.
  - `kind === 'card'` & expense → marca paga + `recordCardPurchase`.
  - `kind === 'account'` → marca paga + `writeCashTransaction` debitando a carteira.
  - `kind === 'none'` → comportamento atual (caixa sem carteira), no valor real.
  - `kind === 'ambiguous'` → mesma pendência binária ("cartão ou conta?") que o register já abre (via `pendingIntents.openIntent`), carregando o payload do pay_bill.
- Confirmação mostra valor **real** pago + método; se real ≠ previsto, acrescenta a variação.
- Marca `outcome.persisted = true`.

### Unidade 4 — Skill `financeiro-pessoal.md`

Documentar que `pay_bill` aceita `amount` + meio de pagamento, com exemplos:
- "paguei a luz 180" → `pay_bill {bill_name:"luz", amount:180}`
- "paguei o condomínio no nubank" → `pay_bill {bill_name:"condomínio", amount:?, card:"nubank"}` (valor opcional)
- "paguei a internet pelo Itaú" → `account:"Itaú"`.
Reforçar a regra anti-fabricação já existente (confirmação só com marker).

## Fluxo de dados

```
PWA:  PagarContaSheet → usePayBill → lib.payBill(opts)
        ├─ card_id  → cartoes.createCardPurchase  → pf_transactions(card_id) → fatura (realtime)
        ├─ account  → fin.createTransaction(account_id) → caixa + saldo (trigger)
        └─ none     → fin.createTransaction(sem account) → caixa
      + update pf_bills(status,last_paid_at)

TOM:  "paguei luz 180 no nubank" → LLM → <<FINANCE_ACTION pay_bill>>
        → handleFinanceAction → findBills → resolveSource
        → recordCardPurchase | writeCashTransaction | caixa-sem-fonte
        + payBill marca a conta
```

## Erros / casos de borda

- Conta não encontrada / múltiplas → mensagens já existentes (`findBills`).
- `amount` inválido (≤0 ou NaN) → no PWA: botão desabilitado; no TOM: usa previsto.
- Pagar conta `income` (a receber) no cartão → ignora cartão (cartão é fatura/despesa).
- Conta `once` → marca inativa ao pagar (comportamento atual mantido).
- Idempotência: re-pagar uma conta já paga gera nova transação (comportamento atual; fora de escopo).

## Testes

- **Puro/serviço:** `payBill` com cada método (none/account/card) → grava transação certa, **não altera `bill.amount`**, marca paga. (Vitest no PWA; smoke node no backend.)
- **Engine:** `pay_bill` com amount + card_name → roteia pra fatura; com amount só → caixa no valor real; ambiguidade → abre intent.
- **Regressão:** `pay_bill` sem amount e sem método → idêntico ao comportamento atual (previsto, caixa sem carteira).
- **PWA build/tsc** limpos; smoke E2E manual no preview (pós-login).

## Fora de escopo

- Bug #1 (perda de estado ao voltar pro app) — investigação separada, aguardando detalhe da Rose.
- Média móvel / auto-ajuste do valor previsto — YAGNI.
- Idempotência de pagamento duplicado.
