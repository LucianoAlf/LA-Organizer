'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { buildFinanceDigest, fmtMoney } = require('./finance-digest');

test('vazio → string vazia (sinaliza "não enviar")', () => {
  assert.strictEqual(buildFinanceDigest({ nome: 'Alf' }), '');
  assert.strictEqual(buildFinanceDigest({ nome: 'Alf', atrasadas: [], hoje: [], emBreve: [] }), '');
});

test('fmtMoney: inteiro sem centavos, fração com vírgula', () => {
  assert.strictEqual(fmtMoney(1800), 'R$ 1.800');
  assert.strictEqual(fmtMoney(120.5), 'R$ 120,50');
  assert.strictEqual(fmtMoney(650), 'R$ 650');
});

test('caso do print do Alf: 3 blocos em ordem + 💳 na fatura', () => {
  const msg = buildFinanceDigest({
    nome: 'Alf',
    atrasadas: [{ name: 'Aluguel', amount: 1800, dia: 5, isCard: false }],
    hoje: [{ name: 'Internet', amount: 120, dia: 8, isCard: false }],
    emBreve: [
      { name: 'Conta de Luz', amount: 150, dia: 10, isCard: false },
      { name: 'Fatura Nubank', amount: 650, dia: 10, isCard: true },
    ],
  });
  assert.ok(msg.indexOf('🔴') < msg.indexOf('🟡'), 'atrasada antes de hoje');
  assert.ok(msg.indexOf('🟡') < msg.indexOf('🔵'), 'hoje antes de em breve');
  assert.match(msg, /Aluguel · \*R\$ 1\.800\*  _\(venceu dia 5\)_/);
  assert.match(msg, /Internet · \*R\$ 120\*/);
  assert.match(msg, /💳 Fatura Nubank · \*R\$ 650\* _\(dia 10\)_/);
  assert.match(msg, /Financeiro de hoje, Alf/);
});

test('só um bloco → os outros são omitidos', () => {
  const msg = buildFinanceDigest({ nome: 'Alf', hoje: [{ name: 'Internet', amount: 120, dia: 8, isCard: false }] });
  assert.doesNotMatch(msg, /🔴/);
  assert.doesNotMatch(msg, /🔵/);
  assert.match(msg, /🟡/);
});

test('rodapé cita 1 conta + 1 fatura', () => {
  const msg = buildFinanceDigest({
    nome: 'Alf',
    hoje: [{ name: 'Internet', amount: 120, dia: 8, isCard: false }],
    emBreve: [{ name: 'Fatura Nubank', amount: 650, dia: 10, isCard: true }],
  });
  assert.match(msg, /"paguei internet"/);
  assert.match(msg, /"paguei a fatura do nubank"/);
});

test('sem nome → saudação sem vírgula', () => {
  const msg = buildFinanceDigest({ nome: '', hoje: [{ name: 'Internet', amount: 120, dia: 8, isCard: false }] });
  assert.match(msg, /👽 \*Financeiro de hoje\*/);
  assert.doesNotMatch(msg, /Financeiro de hoje,/);
});

test('só cartão → rodapé sem exemplo de conta', () => {
  const msg = buildFinanceDigest({ nome: 'Alf', hoje: [{ name: 'Fatura Nubank', amount: 650, dia: 8, isCard: true }] });
  assert.match(msg, /"paguei a fatura do nubank"/);
  assert.doesNotMatch(msg, /paguei internet/);
});
