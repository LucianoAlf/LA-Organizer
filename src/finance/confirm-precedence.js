'use strict';
// Quando DUAS confirmações estão abertas ao mesmo tempo, quem decide é a pergunta mais
// RECENTE — não a ordem dos interceptors dentro do processMessage. PURO (sem I/O).
//
// Caso Rose 14/08 10:50 BRT: às 10:42 o TOM perguntou "Vou pagar a fatura do Cartão Nubank —
// R$ 443,84. Confirma que mando?" (intent finance_source/launch_confirm). Ela não respondeu:
// mandou a FOTO da fatura, e às 10:49 o TOM abriu outra pergunta — "Lanço essas compras?
// Responde *lançar*" (intent invoice_import/awaiting_confirm). Ela respondeu "Lançar".
// "lançar" casa nos DOIS parsers (detectLaunchConfirm → 'yes', detectInvoiceReply →
// 'commit_financeiro'), e o consumidor de launch_confirm roda ~1000 linhas ANTES do de
// invoice_import: engoliu a resposta, pagou a fatura e deixou as 14 compras sem lançar.

function _ts(intent) {
  const t = intent && intent.asked_at ? Date.parse(intent.asked_at) : NaN;
  return Number.isFinite(t) ? t : null;
}

// true → o consumidor de launch_confirm deve ficar quieto neste turno e deixar a resposta
// chegar no interceptor de invoice_import.
function launchConfirmYields(openIntents, launchIntent) {
  const base = _ts(launchIntent);
  if (base === null || !Array.isArray(openIntents)) return false;
  return openIntents.some((i) => {
    if (!i || i.kind !== 'invoice_import') return false;
    if (!i.payload || i.payload.stage !== 'awaiting_confirm') return false;
    const t = _ts(i);
    return t !== null && t > base;
  });
}

module.exports = { launchConfirmYields };
