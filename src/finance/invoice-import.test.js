const { test } = require('node:test');
const assert = require('node:assert');
const { parseInvoiceBlock, normalizeItems, buildInvoicePreview, detectInvoiceReply, looksLikeInvoiceText } = require('./invoice-import');

test('parseInvoiceBlock extrai o JSON e limpa o texto', () => {
  const raw = '[FATURA_JSON]{"emissor":"Nubank","vencimento":"2026-06-15","total":3643.53,"itens":[{"descricao":"Shopee","valor":136.28,"data":"2026-05-07","parcela_atual":12,"parcela_total":12}]}[/FATURA_JSON]\nResumo legível aqui.';
  const r = parseInvoiceBlock(raw);
  assert.equal(r.found, true);
  assert.equal(r.invoice.emissor, 'Nubank');
  assert.equal(r.invoice.itens.length, 1);
  assert.equal(r.invoice.itens[0].valor, 136.28);
});

test('parseInvoiceBlock retorna found=false sem o bloco', () => {
  assert.equal(parseInvoiceBlock('mensagem comum').found, false);
});

test('parseInvoiceBlock tolera JSON malformado (found=false, malformed=true)', () => {
  const r = parseInvoiceBlock('[FATURA_JSON]{quebrado[/FATURA_JSON]');
  assert.equal(r.found, false);
  assert.equal(r.malformed, true);
});

test('normalizeItems descarta item sem valor e preenche parcela default', () => {
  const items = normalizeItems([
    { descricao: 'A', valor: 10, data: '2026-05-07' },
    { descricao: 'SemValor' },
  ]);
  assert.equal(items.length, 1);
  assert.equal(items[0].parcela_total, 1);
  assert.equal(items[0].parcela_atual, 1);
});

test('buildInvoicePreview lista itens numerados com parcela e categoria', () => {
  const out = buildInvoicePreview({
    emissor: 'Nubank', vencimento: '2026-06-15', total: 270,
    cardName: 'Nubank Rose',
    itens: [
      { descricao: 'Shopee', valor: 136.28, data: '2026-05-07', parcela_atual: 12, parcela_total: 12, categoria: 'compras' },
      { descricao: 'iFood', valor: 50, data: '2026-05-08', parcela_atual: 1, parcela_total: 1, categoria: 'alimentacao' },
    ],
  });
  assert.match(out, /Nubank Rose/);
  assert.match(out, /1\. .*Shopee.*136,28.*12\/12.*compras/);
  assert.match(out, /2\. .*iFood.*50,00.*alimentacao/);
  assert.match(out, /lançar/i);
});

test('detectInvoiceReply roteia lançar / anotações / cancelar', () => {
  assert.equal(detectInvoiceReply('pode lançar'), 'commit_financeiro');
  assert.equal(detectInvoiceReply('lança aí'), 'commit_financeiro');
  assert.equal(detectInvoiceReply('salva nas anotações'), 'commit_anotacoes');
  assert.equal(detectInvoiceReply('só anota'), 'commit_anotacoes');
  assert.equal(detectInvoiceReply('cancela'), 'cancel');
  assert.equal(detectInvoiceReply('deixa pra lá'), 'cancel');
  assert.equal(detectInvoiceReply('e a agenda de amanhã?'), null);
  // formas reais da Rose de confirmar (sem dizer "lançar")
  assert.equal(detectInvoiceReply('pode ir com os 40'), 'commit_financeiro');
  assert.equal(detectInvoiceReply('segue o lançamento dos 40'), 'commit_financeiro');
});

test('looksLikeInvoiceText detecta fatura colada, ignora msg comum e lista crua', () => {
  const fatura = '📋 FATURA NUBANK — ROSE\nVencimento: 15/06/2026\nTotal a pagar: R$ 3.643,53\nCompras:\n1. 07/05 Shopee R$ 136,28\n2. 07/05 Kiwify R$ 6,92 parcela 1/10\n3. 07/05 Shein R$ 80,70\n4. 07/05 Lojas Riachuelo R$ 41,97';
  assert.equal(looksLikeInvoiceText(fatura), true);
  assert.equal(looksLikeInvoiceText('oi tom, tudo bem? quanto gastei esse mês?'), false);
  // lista de gastos crus SEM header de fatura → não casa (segue fluxo normal de markers)
  assert.equal(looksLikeInvoiceText('Amazon 30,74\nShopee 56,48\nPrezunic 176,77 mercado'), false);
  assert.equal(looksLikeInvoiceText('paguei 50 no ifood'), false);
});

test('normalizeItems descarta saldo rolado/pagamento mas mantém encargos reais (Alf 14/06)', () => {
  const items = normalizeItems([
    { descricao: 'Saldo em atraso', valor: 10004.71, data: '2026-05-21' },
    { descricao: 'Pagamento recebido', valor: 500, data: '2026-05-10' },
    { descricao: 'Saldo anterior', valor: 1234, data: '2026-05-01' },
    { descricao: 'Multa de atraso', valor: 200.86, data: '2026-05-22' },
    { descricao: 'Juros de dívida encerrada', valor: 239.84, data: '2026-05-22' },
    { descricao: 'IOF de atraso', valor: 38.98, data: '2026-05-22' },
    { descricao: 'Anthropic', valor: 25.42, data: '2026-05-14' },
  ]);
  const descs = items.map((i) => i.descricao);
  assert.ok(!descs.includes('Saldo em atraso'), 'saldo em atraso deve sair');
  assert.ok(!descs.includes('Pagamento recebido'), 'pagamento deve sair');
  assert.ok(!descs.includes('Saldo anterior'), 'saldo anterior deve sair');
  assert.ok(descs.includes('Multa de atraso'), 'multa de atraso fica (encargo real)');
  assert.ok(descs.includes('Juros de dívida encerrada'), 'juros fica (encargo real)');
  assert.ok(descs.includes('IOF de atraso'), 'IOF de atraso fica (encargo real)');
  assert.ok(descs.includes('Anthropic'), 'compra normal fica');
  assert.equal(items.length, 4);
});

test('normalizeItems descarta "Valor pendente do mês anterior" (saldo rolado do OFX) — Alf 14/06', () => {
  const items = normalizeItems([
    { descricao: 'Valor pendente do mês anterior', valor: 10004.70, data: '2026-05-21' },
    { descricao: 'IOF por fatura atrasada', valor: 38.98, data: '2026-05-22' },
    { descricao: 'Multa por fatura atrasada', valor: 200.85, data: '2026-05-22' },
    { descricao: 'Movida Rac Flap', valor: 14.64, data: '2026-05-14' },
  ]);
  const descs = items.map((i) => i.descricao);
  assert.ok(!descs.includes('Valor pendente do mês anterior'), 'saldo rolado do OFX deve sair');
  assert.ok(descs.includes('IOF por fatura atrasada'), 'IOF atrasada fica (encargo real)');
  assert.ok(descs.includes('Multa por fatura atrasada'), 'multa atrasada fica (encargo real)');
  assert.ok(descs.includes('Movida Rac Flap'), 'compra normal fica');
  assert.equal(items.length, 3);
});
