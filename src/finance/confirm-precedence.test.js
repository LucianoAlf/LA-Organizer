'use strict';
const test = require('node:test');
const assert = require('node:assert');

const precedence = require('./confirm-precedence');
const launchConfirm = require('./launch-confirm');
const invoiceImport = require('./invoice-import');

// Formas REAIS das duas intents da Rose em 14/08 (pending_intents, asked_at em UTC).
// A de pay_invoice foi resolvida `confirmed` às 13:50:03Z — o turno do "Lançar" — e a de
// invoice_import, aberta 6min DEPOIS, ficou com resolved_at=null.
const LAUNCH_PAY_INVOICE = {
  id: 'i-pay',
  kind: 'finance_source',
  asked_at: '2026-08-14T13:42:31Z',
  payload: {
    form: 'launch_confirm',
    actions: [{ action: 'pay_invoice', params: { card: 'Cartão Nubank', amount: 443.84 } }],
  },
};
const INVOICE_IMPORT_AWAITING = {
  id: 'i-inv',
  kind: 'invoice_import',
  asked_at: '2026-08-14T13:49:05Z',
  payload: { stage: 'awaiting_confirm', card_name: 'Cartão Nubank', total: 593.32 },
};

test('caso Rose 14/08 10:50 BRT: os DOIS parsers reivindicam "Lançar"', () => {
  assert.strictEqual(launchConfirm.detectLaunchConfirm('Lançar', null), 'yes');
  assert.strictEqual(invoiceImport.detectInvoiceReply('Lançar'), 'commit_financeiro');
});

test('launch_confirm cede quando há invoice_import MAIS RECENTE esperando confirmação', () => {
  const abertas = [LAUNCH_PAY_INVOICE, INVOICE_IMPORT_AWAITING];
  assert.strictEqual(precedence.launchConfirmYields(abertas, LAUNCH_PAY_INVOICE), true);
});

test('não cede quando o invoice_import é MAIS ANTIGO que o launch_confirm', () => {
  const velho = { ...INVOICE_IMPORT_AWAITING, asked_at: '2026-08-14T13:30:00Z' };
  assert.strictEqual(precedence.launchConfirmYields([velho, LAUNCH_PAY_INVOICE], LAUNCH_PAY_INVOICE), false);
});

test('não cede quando o invoice_import não está esperando confirmação', () => {
  const outroStage = { ...INVOICE_IMPORT_AWAITING, payload: { stage: 'awaiting_card' } };
  assert.strictEqual(precedence.launchConfirmYields([outroStage, LAUNCH_PAY_INVOICE], LAUNCH_PAY_INVOICE), false);
});

test('não cede quando não há invoice_import aberta (fluxo normal de lançamento)', () => {
  assert.strictEqual(precedence.launchConfirmYields([LAUNCH_PAY_INVOICE], LAUNCH_PAY_INVOICE), false);
});

test('entradas degeneradas não derrubam o consumidor', () => {
  assert.strictEqual(precedence.launchConfirmYields(null, LAUNCH_PAY_INVOICE), false);
  assert.strictEqual(precedence.launchConfirmYields([INVOICE_IMPORT_AWAITING], null), false);
  assert.strictEqual(precedence.launchConfirmYields([{ kind: 'invoice_import' }], LAUNCH_PAY_INVOICE), false);
});
