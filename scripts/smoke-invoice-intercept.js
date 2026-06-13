// Smoke READ-ONLY do intercept de import de fatura: parseInvoiceBlock -> findCard -> buildInvoicePreview.
// NÃO lança nada (não chama insertCardPurchase). Uso: cd /opt/LA-Organizer && node --env-file=.env scripts/smoke-invoice-intercept.js
const ii = require('/opt/LA-Organizer/src/finance/invoice-import');
const fin = require('/opt/LA-Organizer/src/services/financeiro-service');
const ROSE = '8bfb18b6-3c2e-4579-b4a9-06409d7e84c4';
const invoice = {
  emissor: 'Nubank', vencimento: '2026-07-15', total: 186.28,
  itens: [
    { descricao: 'Shopee Faura', valor: 136.28, data: '2026-05-07', parcela_atual: 12, parcela_total: 12 },
    { descricao: 'iFood', valor: 50.0, data: '2026-05-08', parcela_atual: 1, parcela_total: 1 },
  ],
};
const text = '[FATURA_JSON]' + JSON.stringify(invoice) + '[/FATURA_JSON]\nresumo legivel';
(async () => {
  const p = ii.parseInvoiceBlock(text);
  console.log('[smoke] parse found=' + p.found + ' itens=' + (p.invoice ? p.invoice.itens.length : 0));
  const cards = await fin.findCard(ROSE, p.invoice.emissor);
  console.log('[smoke] findCard("Nubank") => ' + JSON.stringify((cards || []).map((c) => c.name)));
  const card = (cards && cards.length) ? cards[0] : null;
  const itensCat = p.invoice.itens.map((it) => ({ ...it, categoria: 'compras' }));
  const preview = ii.buildInvoicePreview({
    emissor: p.invoice.emissor, vencimento: p.invoice.vencimento, total: p.invoice.total,
    cardName: card ? card.name : '???', itens: itensCat, dupWarning: null,
  });
  console.log('[smoke] --- PREVIEW QUE A ROSE VERIA ---');
  console.log(preview);
})().catch((e) => console.log('[smoke] ERR', e.message));
