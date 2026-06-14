const { test } = require('node:test');
const assert = require('node:assert');
const {
  parseAmount, ofxDateToIso, parseOfx, parseCsv,
  issuerFromFilename, competenciaFromFilename, buildCardInvoiceFromStatement, statementToInvoice,
  decodeBuffer, buildImportKeys,
} = require('./statement-parse');

const OFX_CARD = `OFXHEADER:100
DATA:OFXSGML
<OFX>
<SIGNONMSGSRSV1><SONRS><FI><ORG>Nubank</FI></SONRS></SIGNONMSGSRSV1>
<CREDITCARDMSGSRSV1>
<CCSTMTTRNRS>
<CCSTMTRS>
<CURDEF>BRL
<CCACCTFROM><ACCTID>1234</CCACCTFROM>
<BANKTRANLIST>
<DTSTART>20260507
<DTEND>20260606
<STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>20260514
<TRNAMT>-14.64
<FITID>a1
<MEMO>Movida Rac Flap
</STMTTRN>
<STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>20260524
<TRNAMT>-999.90
<FITID>a2
<MEMO>Google Chatgpt
</STMTTRN>
<STMTTRN>
<TRNTYPE>CREDIT
<DTPOSTED>20260520
<TRNAMT>500.00
<FITID>a3
<MEMO>Pagamento recebido
</STMTTRN>
</BANKTRANLIST>
</CCSTMTRS>
</CCSTMTTRNRS>
</CREDITCARDMSGSRSV1>
</OFX>`;

const OFX_BANK = `<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><BANKACCTFROM><ACCTID>9</BANKACCTFROM>
<BANKTRANLIST><DTEND>20260630
<STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20260601<TRNAMT>2000.00<MEMO>Salario</STMTTRN>
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20260602<TRNAMT>-50.00<MEMO>Mercado</STMTTRN>
</BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`;

test('parseAmount: BR, US, negativo, R$, parênteses', () => {
  assert.equal(parseAmount('1.234,56'), 1234.56);
  assert.equal(parseAmount('1,234.56'), 1234.56);
  assert.equal(parseAmount('14,64'), 14.64);
  assert.equal(parseAmount('-999.90'), -999.9);
  assert.equal(parseAmount('R$ 50,00'), 50);
  assert.equal(parseAmount('(12,34)'), -12.34);
  assert.ok(Number.isNaN(parseAmount('abc')));
});

test('ofxDateToIso converte data OFX', () => {
  assert.equal(ofxDateToIso('20260514'), '2026-05-14');
  assert.equal(ofxDateToIso('20260514120000[-03:EST]'), '2026-05-14');
  assert.equal(ofxDateToIso(''), null);
});

test('parseOfx (cartão SGML) extrai kind/org/período/transações', () => {
  const r = parseOfx(OFX_CARD);
  assert.equal(r.kind, 'card');
  assert.equal(r.org, 'Nubank');
  assert.equal(r.periodEnd, '2026-06-06');
  assert.equal(r.transactions.length, 3);
  assert.equal(r.transactions[0].descricao, 'Movida Rac Flap');
  assert.equal(r.transactions[0].amount, -14.64);
  assert.equal(r.transactions[0].date, '2026-05-14');
  assert.equal(r.transactions[2].trntype, 'CREDIT');
});

test('parseOfx detecta extrato de conta (account)', () => {
  const r = parseOfx(OFX_BANK);
  assert.equal(r.kind, 'account');
  assert.equal(r.transactions.length, 2);
});

test('parseCsv com header BR (; e vírgula decimal)', () => {
  const csv = 'data;descrição;valor\n14/05/2026;Movida Rac Flap;14,64\n24/05/2026;Google Chatgpt;999,90';
  const r = parseCsv(csv);
  assert.equal(r.transactions.length, 2);
  assert.equal(r.transactions[0].date, '2026-05-14');
  assert.equal(r.transactions[0].descricao, 'Movida Rac Flap');
  assert.equal(r.transactions[0].amount, 14.64);
  assert.equal(r.transactions[1].amount, 999.9);
});

test('parseCsv com header US (date,title,amount)', () => {
  const csv = 'date,title,amount\n2026-05-14,Movida,14.64\n2026-05-24,Google,999.90';
  const r = parseCsv(csv);
  assert.equal(r.transactions.length, 2);
  assert.equal(r.transactions[1].amount, 999.9);
});

test('issuer/competencia do nome do arquivo', () => {
  assert.equal(issuerFromFilename('Nubank_2026-06-21.ofx'), 'Nubank');
  assert.equal(issuerFromFilename('C6 Bank-fatura.csv'), 'C6');
  assert.equal(competenciaFromFilename('Nubank_2026-06-21.ofx'), '2026-06-21');
  assert.equal(competenciaFromFilename('fatura_06-2026.csv'), '2026-06-01');
});

test('buildCardInvoiceFromStatement: DEBIT vira despesa, CREDIT (pagamento) fora', () => {
  const parsed = parseOfx(OFX_CARD);
  const inv = buildCardInvoiceFromStatement(parsed, 'Nubank_2026-06-21.ofx');
  assert.equal(inv.emissor, 'Nubank');
  assert.equal(inv.vencimento, '2026-06-21');
  assert.equal(inv.itens.length, 2); // Movida + Google; pagamento (CREDIT) descartado
  assert.equal(inv.itens[0].valor, 14.64); // valor absoluto
  assert.equal(inv.itens[1].valor, 999.9);
  assert.ok(!inv.itens.some((i) => /pagamento/i.test(i.descricao)));
});

test('statementToInvoice E2E (OFX → invoice cartão)', () => {
  const r = statementToInvoice({ filename: 'Nubank_2026-06-21.ofx', text: OFX_CARD });
  assert.equal(r.ok, true);
  assert.equal(r.format, 'ofx');
  assert.equal(r.kind, 'card');
  assert.equal(r.invoice.itens.length, 2);
});

test('statementToInvoice E2E (CSV → invoice)', () => {
  const csv = 'date,title,amount\n2026-05-14,Movida,14.64\n2026-05-24,Google,999.90';
  const r = statementToInvoice({ filename: 'Nubank_2026-06-21.csv', text: csv });
  assert.equal(r.ok, true);
  assert.equal(r.format, 'csv');
  assert.equal(r.invoice.itens.length, 2);
});

test('statementToInvoice: sem transações → ok=false', () => {
  const r = statementToInvoice({ filename: 'x.ofx', text: '<OFX><CCSTMTRS></CCSTMTRS></OFX>' });
  assert.equal(r.ok, false);
});

test('parseOfx extrai FITID de cada transação', () => {
  const r = parseOfx(OFX_CARD);
  assert.equal(r.transactions[0].fitid, 'a1');
  assert.equal(r.transactions[2].fitid, 'a3');
});

test('decodeBuffer respeita CHARSET 1252 (latin1) e UTF-8 (acento não quebra)', () => {
  const latinBuf = Buffer.concat([
    Buffer.from('OFXHEADER:100\nCHARSET:1252\n', 'ascii'),
    Buffer.from('Comissão Anônima', 'latin1'),
  ]);
  assert.match(decodeBuffer(latinBuf), /Comissão Anônima/);
  const utfBuf = Buffer.concat([
    Buffer.from('OFXHEADER:100\nENCODING:UTF-8\n', 'ascii'),
    Buffer.from('Comissão Anônima', 'utf8'),
  ]);
  assert.match(decodeBuffer(utfBuf), /Comissão Anônima/);
});

test('buildImportKeys: OFX usa FITID; PDF/CSV usa hash com ocorrência (idempotente)', () => {
  const ofxKeys = buildImportKeys([{ import_ref: 'ABC123', valor: 10, data: '2026-05-14', descricao: 'X' }], { cardId: 'c1', competencia: '2026-06-01' });
  assert.equal(ofxKeys[0], 'ofx:c1:ABC123');
  // 2 compras idênticas no mesmo dia → chaves DIFERENTES (ocorrência)
  const items = [
    { valor: 5, data: '2026-05-14', descricao: 'Cafe' },
    { valor: 5, data: '2026-05-14', descricao: 'Cafe' },
  ];
  const k1 = buildImportKeys(items, { cardId: 'c1', competencia: '2026-06-01' });
  assert.notEqual(k1[0], k1[1], 'duas compras iguais no mesmo dia → chaves distintas');
  // reimport da MESMA fatura → MESMAS chaves (dedup funciona)
  const k2 = buildImportKeys(items, { cardId: 'c1', competencia: '2026-06-01' });
  assert.deepEqual(k1, k2, 'reimport gera as mesmas chaves');
  // cartão/competência diferente → chave diferente
  const k3 = buildImportKeys(items, { cardId: 'c2', competencia: '2026-06-01' });
  assert.notEqual(k1[0], k3[0]);
});

test('buildCardInvoiceFromStatement: estorno (CREDIT) entra negativo; pagamento fica fora (Fase B)', () => {
  const parsed = { transactions: [
    { amount: -100, descricao: 'Compra X', date: '2026-05-14', trntype: 'DEBIT' },
    { amount: 16.58, descricao: 'Estorno Pg Lac', date: '2026-05-14', trntype: 'CREDIT' },
    { amount: 500, descricao: 'Pagamento recebido', date: '2026-05-10', trntype: 'CREDIT' },
  ] };
  const inv = buildCardInvoiceFromStatement(parsed, 'Nubank_2026-06-21.ofx');
  const compra = inv.itens.find((i) => i.descricao === 'Compra X');
  const est = inv.itens.find((i) => /Estorno/i.test(i.descricao));
  assert.equal(compra.valor, 100);
  assert.equal(est.valor, -16.58);
  assert.ok(!inv.itens.some((i) => /Pagamento/i.test(i.descricao)), 'pagamento de fatura fica fora');
});
