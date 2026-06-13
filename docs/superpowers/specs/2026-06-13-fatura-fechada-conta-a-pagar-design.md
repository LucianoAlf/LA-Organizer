# Fatura fechada → Conta a pagar — Design (Sug Rose 5b)

**Goal:** faturas de cartão **fechadas e não pagas** aparecem na tela *Contas a pagar*, numa seção própria, pra o usuário ver e pagar tudo num lugar só.

## Decisões (Alf, 13/06 — via mockup A/B)
- **Posição:** seção separada **"💳 Faturas de cartão"** (NÃO integrada por vencimento na lista de contas).
- **Escopo:** só faturas **FECHADAS** e com saldo (a fatura aberta/corrente segue só na tela *Cartões*).
- **Arquitetura:** **virtual/derivada** — sem materializar `pf_bills`. Fonte de verdade = `pf_transactions` (competência) + `pf_card_payments`. Pagar reusa `payCardInvoice`. Zero duplicação/dessincronia; total da fatura sempre ao vivo.

## Comportamento
- Uma fatura entra na lista quando a competência **já fechou** (`competencia < currentCompetencia(card)`) e tem saldo (`remaining = total − pago > 0`).
- **Some** quando quitada (`remaining ≤ 0`).
- Cada linha: nome do cartão, `fechou dia X · vence dia Y`, R$ restante, botão **Pagar**.
- **Pagar** abre o sheet de pagamento de fatura já existente (extraído pra componente compartilhado): valor parcial/total + conta de origem → `payCardInvoice`.
- **Total a pagar** passa a somar contas (bills) + faturas.
- Seção aparece nas duas abas (*Todas* e *A pagar*).

## Arquivos
- `web/src/lib/cartoes.ts` — `listClosedUnpaidInvoices(cid)` → `ClosedInvoice[]` `{ card, competencia, total, paid, remaining }` (varre cartões ativos; agrupa pf_transactions/pf_card_payments por competência < currentComp; filtra remaining>0).
- `web/src/hooks/useFinanceiro.ts` — `useClosedUnpaidInvoices()`.
- `web/src/screens/financeiro/components/PagarFaturaSheet.tsx` — **extrair** o `PagarSheet` local de `CartaoDetalhePage` (compartilhado).
- `web/src/screens/financeiro/CartaoDetalhePage.tsx` — passar a usar o `PagarFaturaSheet` extraído (sem mudança de comportamento).
- `web/src/screens/financeiro/ContasFixasPage.tsx` — seção "💳 Faturas de cartão" + somar no Total a pagar + abrir `PagarFaturaSheet` inline.

## Fora de escopo (v1)
Materializar fatura como `pf_bill`; mostrar fatura aberta/corrente; ritual/notificação nova (o TOM já cita faturas no "a pagar").

## Verificação E2E (preview)
Seção aparece com fatura fechada não paga; pagar quita e some da lista; Total a pagar inclui a fatura.
