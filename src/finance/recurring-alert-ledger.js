'use strict';
// src/finance/recurring-alert-ledger.js — PURO (sem I/O): gate de idempotência do alerta proativo
// de recorrência. Raiz do GOVFIN-RECURRING-ALERTA-ETERNO (Rose/Light 13→20/08): sem memória de
// "já avisei", o alerta repetia toda manhã enquanto a janela refYmd durava. Aqui a decisão é
// determinística; o I/O (ler/gravar o ledger pf_recurring_alerts) fica no financeiro-service.
//
// keyOf(item): item vem do detectRecurring → { merchant, kind, amount_cents, dedup_key } | null.
//   dedup_key = 'sub' (assinatura nova: uma vez por comerciante, independe do valor) |
//               'creep:<cents>' (aumento: re-avisa só quando sobe pra um valor NOVO).
// selectNewAlerts(items, alertedRows): devolve { items } a anunciar e { keys } a gravar,
//   pulando o que já está no ledger. alertedRows: [{ merchant, dedup_key }].
function keyOf(item) {
  if (!item) return null;
  const cents = Math.round((Number(item.lastAmount) || 0) * 100);
  if (item.isNewSubscription) {
    return { merchant: item.merchant, kind: 'new_subscription', amount_cents: cents, dedup_key: 'sub' };
  }
  if (item.priceCreep) {
    return { merchant: item.merchant, kind: 'price_creep', amount_cents: cents, dedup_key: `creep:${cents}` };
  }
  return null;
}

function selectNewAlerts(items, alertedRows) {
  const seen = new Set((alertedRows || []).map((r) => `${r.merchant}|${r.dedup_key}`));
  const outItems = [];
  const keys = [];
  for (const it of (items || [])) {
    const k = keyOf(it);
    if (!k) continue;
    const sig = `${k.merchant}|${k.dedup_key}`;
    if (seen.has(sig)) continue;
    seen.add(sig); // dedup também dentro do mesmo lote
    outItems.push(it);
    keys.push(k);
  }
  return { items: outItems, keys };
}

module.exports = { keyOf, selectNewAlerts };
