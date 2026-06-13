const { test } = require('node:test');
const assert = require('node:assert');
const { parseInvoiceBlock, normalizeItems, buildInvoicePreview, detectInvoiceReply } = require('./invoice-import');

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
});
