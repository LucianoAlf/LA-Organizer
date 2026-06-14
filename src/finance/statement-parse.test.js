const { test } = require('node:test');
const assert = require('node:assert');
const {
  parseAmount, ofxDateToIso, parseOfx, parseCsv,
  issuerFromFilename, competenciaFromFilename, buildCardInvoiceFromStatement, statementToInvoice,
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
