const { test } = require('node:test');
const assert = require('node:assert');
const { parseInvoiceBlock, normalizeItems, buildInvoicePreview, detectInvoiceReply, looksLikeInvoiceText, allItemsRefund, refundCompetencia, normInvoiceDate } = require('./invoice-import');

test('allItemsRefund: lista 100% estornos → true; mistura ou compras → false (regressão Rose)', () => {
  assert.equal(allItemsRefund([{ descricao: 'Estorno Pg *Lac', valor: -16.58 }, { descricao: 'Estorno Amazonmktplc', valor: -34.76 }]), true);
  assert.equal(allItemsRefund([{ descricao: 'Estorno X', valor: 16.58 }]), true); // detecta por descrição mesmo se vier positivo
  assert.equal(allItemsRefund([{ descricao: 'Compra mercado', valor: 50 }, { descricao: 'Estorno Y', valor: -10 }]), false);
  assert.equal(allItemsRefund([{ descricao: 'Compra TV', valor: 3200 }]), false);
  assert.equal(allItemsRefund([]), false);
});

// ── detectInvoiceReply: PEDIDO DE VER ≠ COMMIT (Rose 14/07 22:08) ──────────────
// "Sim, me passa só o que falta lançar" começava com "Sim" (RE_COMMIT_ANCHORED),
// ≤10 palavras, sem "?" → commitou 59 itens SEM OK. Mas "me passa/mostra o que falta"
// é pedido de VISUALIZAÇÃO (a opção-a que o próprio TOM ofereceu), não ordem de lançar.
// Regra de ouro (finance): na dúvida entre lançar e ver, NÃO lança.
test('NÃO commita quando é pedido de VER — "Sim, me passa só o que falta lançar" (o bug da Rose)', () => {
  assert.strictEqual(detectInvoiceReply('Sim, me passa só o que falta lançar'), null);
  assert.strictEqual(detectInvoiceReply('me mostra o que falta'), null);
  assert.strictEqual(detectInvoiceReply('quero ver o que já tá lançado'), null);
  assert.strictEqual(detectInvoiceReply('só o que falta pra não duplicar'), null);
  assert.strictEqual(detectInvoiceReply('me passa o que falta antes'), null);
});
test('AINDA commita quando é ordem clara de lançar (sem pedido de ver)', () => {
  assert.strictEqual(detectInvoiceReply('lançar'), 'commit_financeiro');
  assert.strictEqual(detectInvoiceReply('pode lançar'), 'commit_financeiro');
  assert.strictEqual(detectInvoiceReply('isso, pode lançar tudo'), 'commit_financeiro');
  assert.strictEqual(detectInvoiceReply('sim'), 'commit_financeiro');
  assert.strictEqual(detectInvoiceReply('confirma'), 'commit_financeiro');
});
test('cancelar e anotações intactos', () => {
  assert.strictEqual(detectInvoiceReply('cancela'), 'cancel');
  assert.strictEqual(detectInvoiceReply('só nas anotações'), 'commit_anotacoes');
});

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

test('parseInvoiceBlock: total = soma dos itens lançados, ignorando saldo rolado (Alf 14/06)', () => {
  const raw = '[FATURA_JSON]{"emissor":"Nubank","total":16645.50,"itens":[' +
    '{"descricao":"Valor pendente do mês anterior","valor":10004.70,"data":"2026-05-21"},' +
    '{"descricao":"Compra X","valor":100,"data":"2026-05-14"},' +
    '{"descricao":"Compra Y","valor":40.80,"data":"2026-05-15"}' +
    ']}[/FATURA_JSON]';
  const r = parseInvoiceBlock(raw);
  assert.equal(r.invoice.itens.length, 2);        // saldo rolado filtrado
  assert.equal(r.invoice.total, 140.80);          // soma dos 2, NÃO o 16645.50 declarado
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

test('detectInvoiceReply NÃO commita pergunta nem correção (Rose 22/06 — FIN-INVOICE-COMMIT-ON-QUESTION)', () => {
  // pergunta com "lançar" no MEIO da frase → NÃO é OK (o caso que lançou sem ela autorizar)
  assert.equal(detectInvoiceReply('tem duas compras ai que são parceladas, você vai lançar em cada mês certinho? me explica'), null);
  assert.equal(detectInvoiceReply('você vai lançar em cada mês?'), null);
  // "lançar" no meio de frase / pedido de mudança → NÃO commita
  assert.equal(detectInvoiceReply('antes de lançar muda a categoria'), null);
  assert.equal(detectInvoiceReply('sim, mas muda a categoria do cheirin'), null);
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

test('refundCompetencia: estorno datado em maio cai na fatura da compra (junho), NÃO na aberta (julho) — Rose closing 7', () => {
  const today = new Date(Date.UTC(2026, 5, 14)); // 14/06/2026 — fatura aberta hoje = julho (dia 14 > closing 7)
  assert.equal(refundCompetencia('2026-05-14', 7, today), '2026-06-01'); // estorno Amazonmktplc
  assert.equal(refundCompetencia('18/05', 7, today), '2026-06-01');      // estorno Pg Lac (DD/MM, sem ano)
});

test('refundCompetencia: corrige ano-chute do Gemini (2024 → ano corrente)', () => {
  const today = new Date(Date.UTC(2026, 5, 14));
  assert.equal(refundCompetencia('2024-05-14', 7, today), '2026-06-01');
  assert.equal(refundCompetencia('14/05/24', 7, today), '2026-06-01');
});

test('refundCompetencia: data ausente/lixo → fatura corrente (fallback currentCompetencia)', () => {
  const today = new Date(Date.UTC(2026, 5, 14)); // 14 > closing 7 → julho
  assert.equal(refundCompetencia(null, 7, today), '2026-07-01');
  assert.equal(refundCompetencia('sei lá', 7, today), '2026-07-01');
});

test('refundCompetencia: respeita a borda do fechamento (day <= closing fica no mês)', () => {
  const today = new Date(Date.UTC(2026, 5, 14));
  assert.equal(refundCompetencia('2026-05-05', 7, today), '2026-05-01'); // dia 5 <= 7 → maio
  assert.equal(refundCompetencia('2026-05-08', 7, today), '2026-06-01'); // dia 8 > 7 → junho
});

test('normalizeItems mantém estorno/devolução como crédito NEGATIVO, mas pagamento fica fora (Fase B)', () => {
  const items = normalizeItems([
    { descricao: 'Compra X', valor: 100, data: '2026-05-14' },
    { descricao: 'Estorno Pg Lac', valor: -16.58, data: '2026-05-14' },
    { descricao: 'Devolução Loja Y', valor: 34.76, data: '2026-05-18' }, // positivo → forçado negativo
    { descricao: 'Pagamento recebido', valor: -500, data: '2026-05-10' }, // pagamento NÃO entra
  ]);
  const x = items.find((i) => i.descricao === 'Compra X');
  const est = items.find((i) => /Estorno/i.test(i.descricao));
  const dev = items.find((i) => /Devolu/i.test(i.descricao));
  assert.equal(x.valor, 100);
  assert.equal(est.valor, -16.58);
  assert.equal(dev.valor, -34.76);
  assert.ok(!items.some((i) => /Pagamento/i.test(i.descricao)), 'pagamento de fatura fica fora');
  assert.equal(items.length, 3);
});

test('normInvoiceDate: "DD/MM" sem ano assume o ano de referência', () => {
  assert.equal(normInvoiceDate('19/05', 2026), '2026-05-19');
});

test('normInvoiceDate: corrige ano-chute do Gemini (2024 → ano corrente)', () => {
  assert.equal(normInvoiceDate('2024-05-19', 2026), '2026-05-19');
  assert.equal(normInvoiceDate('2024-07-15', 2026), '2026-07-15'); // vencimento "fatura de JULHO" (Rose 15/06)
});

test('normInvoiceDate: preserva ano plausível (refYear ± 1 — virada de ano)', () => {
  assert.equal(normInvoiceDate('2025-12-28', 2026), '2025-12-28');
  assert.equal(normInvoiceDate('2026-01-03', 2026), '2026-01-03');
});

test('normInvoiceDate: sem refYear NÃO mexe (retrocompat) e null vira null', () => {
  assert.equal(normInvoiceDate('2024-05-19'), '2024-05-19');
  assert.equal(normInvoiceDate(null, 2026), null);
});

test('normalizeItems com refYear corrige o ano das compras (Rose 15/06: 2024 → 2026)', () => {
  const items = normalizeItems([
    { descricao: 'Bebe do Papai', valor: 132.45, data: '2024-05-19' },
    { descricao: 'Amazon', valor: 27.12, data: '19/05' },
  ], 2026);
  assert.equal(items[0].data, '2026-05-19');
  assert.equal(items[1].data, '2026-05-19');
});

test('parseInvoiceBlock com refYear corrige vencimento E datas dos itens (caso Rose Latam PASS)', () => {
  const raw = '[FATURA_JSON]' + JSON.stringify({
    emissor: 'Latam PASS', vencimento: '2024-07-15',
    itens: [
      { descricao: 'Bebe do Papai', valor: 132.45, data: '2024-05-19' },
      { descricao: 'Cancelamento blw - Estorno', valor: -83.90, data: '2024-05-24' },
    ],
  }) + '[/FATURA_JSON]';
  const r = parseInvoiceBlock(raw, 2026);
  assert.equal(r.invoice.vencimento, '2026-07-15');                 // competência derivada → julho/2026
  assert.equal(r.invoice.itens[0].data, '2026-05-19');
  const est = r.invoice.itens.find((i) => /Estorno/i.test(i.descricao));
  assert.equal(est.data, '2026-05-24');
  assert.equal(est.valor, -83.90);                                  // estorno segue crédito negativo
});
