'use strict';
// CARD-DUE-RECURRING-GAP (Rose 11/06): "lembrete de vencimento de cartão" NÃO é uma conta.
// pf_bills.amount é NOT NULL — uma fatura ainda-aberta não tem valor conhecido. O LLM, sem ação
// dedicada, emitia register_bill SEM amount → o insert estourava a constraint NOT NULL → throw →
// "Deu ruim ao registrar um dos itens — tenta de novo?" 3x, sem criar nada e sem retry.
//
// Modelo correto: vencimento de cartão = pf_cards.due_day, lembrado no digest financeiro da
// manhã (sendFinanceDigest, 2 dias antes). Não há lembrete de cartão por-horário-custom.
//
// Esta função é PURA (sem DB): decide o que o handler register_bill faz quando NÃO há amount
// válido. O handler resolve o cartão por nome (findCard) e passa o match aqui.

// amount válido = presente, numérico e > 0.
function hasValidAmount(amount) {
  if (amount == null || amount === '') return false;
  const n = Number(amount);
  return Number.isFinite(n) && n > 0;
}

// Dia do mês 1..31 (inteiro) ou null.
function validDueDay(d) {
  if (d == null || d === '') return null;
  const n = Number(d);
  return Number.isInteger(n) && n >= 1 && n <= 31 ? n : null;
}

// params: { amount, name, card, due_day } — o marker register_bill do LLM.
// matchedCard: cartão resolvido por nome { id, name, due_day } (ou null se não casou).
// Retorna { kind, ... }:
//   'bill'         → tem amount → segue o createBill normal.
//   'card_confirm' → casou cartão que JÁ tem due_day → só confirma a entrega (NÃO altera). { card, dueDay }
//   'card_set'     → casou cartão SEM due_day e o LLM informou o dia → setar due_day. { card, dueDay }
//   'card_ask_day' → casou cartão SEM due_day e sem dia informado → pedir o dia. { card }
//   'bill_ask_day' → conta fixa recorrente COM valor mas SEM dia de vencimento → pedir o dia
//                    (sem crashar). { name, amount }  ← raiz do crash due_day NULL (Rose 14/06)
//   'ask_value'    → não é cartão e não tem valor → pedir o valor (sem crashar). { name }
function classifyRegisterBill(params, matchedCard) {
  const due = validDueDay(params && params.due_day);
  if (hasValidAmount(params && params.amount)) {
    // Conta fixa RECORRENTE (monthly) exige dia de vencimento — pf_bills.due_day é NOT NULL.
    // Sem o dia, createBill inseria NULL → crash (caso Rose 14/06: "Assinatura Mercado Livre"
    // da fatura virou register_bill sem dia). 'once' deriva o dia do due_date no createBill.
    const isOnce = params && params.recurrence === 'once';
    const hasDueDate = !!(params && params.due_date);
    if (!isOnce && due == null && !hasDueDate) {
      return { kind: 'bill_ask_day', name: (params && params.name) || null, amount: Number(params.amount) };
    }
    return { kind: 'bill' };
  }
  if (matchedCard) {
    if (matchedCard.due_day != null) {
      return { kind: 'card_confirm', card: matchedCard, dueDay: matchedCard.due_day };
    }
    if (due != null) return { kind: 'card_set', card: matchedCard, dueDay: due };
    return { kind: 'card_ask_day', card: matchedCard };
  }
  return { kind: 'ask_value', name: (params && params.name) || null };
}

module.exports = { classifyRegisterBill, hasValidAmount, validDueDay };
