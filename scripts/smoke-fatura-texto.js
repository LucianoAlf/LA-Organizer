// Smoke: fatura colada como TEXTO -> looksLikeInvoiceText + analyzeInvoiceText (Gemini estrutura).
// Uso na VPS: cd /opt/LA-Organizer && node --env-file=.env scripts/smoke-fatura-texto.js
const gemini = require('/opt/LA-Organizer/src/services/gemini');
const ii = require('/opt/LA-Organizer/src/finance/invoice-import');
const fatura = `📋 FATURA NUBANK — ROSE
Vencimento: 15/06/2026
Total a pagar: R$ 3.643,53
Período: 07/05 a 07/06/2026
Compras:
1. 07/05 · Shopee Faura · R$ 136,28 · Compras Arthur
2. 07/05 · Kiwify Dozeroaos2 · R$ 6,92 · parcela 1/10 Curso de desenvolvimento infantil
3. 07/05 · Shein Wal · R$ 80,70 · parcela 1/2 Compras
4. 07/05 · Lojas Riachuelo · R$ 41,97 · Compras Arthur
5. 07/05 · Lojas Riachuelo · R$ 68,39 · parcela 1/4 Compras Arthur
6. 07/05 · Mp Melimais · R$ 19,90 · Assinatura Melimais Maio
7. 07/05 · Amazon · R$ 30,74 · parcela 1/5 Compras Arthur
8. 07/05 · Shopee Moda Ba · R$ 56,48 · parcela 1/2 Compras Arthur
9. 07/05 · Lojas Riachuelo · R$ 52,79 · parcela 1/4 Compras Arthur
10. 07/05 · Pg Lac · R$ 74,25 · parcela 1/2 Vitaminas`;
(async () => {
  console.log('[smoke] looksLikeInvoiceText:', ii.looksLikeInvoiceText(fatura));
  const r = await gemini.analyzeInvoiceText(fatura);
  console.log('[smoke] ok=' + r.ok + ' isInvoice=' + r.isInvoice + ' itens=' + (r.invoice ? r.invoice.itens.length : 0) + ' emissor=' + (r.invoice ? r.invoice.emissor : '?'));
  if (r.invoice && r.invoice.itens.length) {
    console.log('[smoke] item1:', JSON.stringify(r.invoice.itens[0]));
    console.log('[smoke] item2 (deve ser parcela 1/10):', JSON.stringify(r.invoice.itens[1]));
    console.log(r.invoice.itens.length === 10 ? '[smoke] ✅ estruturou os 10 itens' : '[smoke] ⚠️ itens=' + r.invoice.itens.length + ' (esperado 10)');
  }
})().catch((e) => console.log('[smoke] ERR', e.message));
