const { test } = require('node:test');
const assert = require('node:assert');
const { formatFinancialDoc, pickDocTitle } = require('./group-doc-format');

test('formatFinancialDoc: agrupa por categoria, preserva TODOS os itens, cabeçalho com total', () => {
  const inv = {
    emissor: 'Nubank', vencimento: '2026-07-10', total: 250.0,
    itens: [
      { descricao: 'iFood almoço', valor: 50, data: '2026-06-15' },
      { descricao: 'Uber centro', valor: 30, data: '2026-06-16' },
      { descricao: 'Restaurante X', valor: 70, data: '2026-06-17' },
      { descricao: '99 corrida', valor: 100, data: '2026-06-18', parcela_atual: 1, parcela_total: 3 },
    ],
  };
  const out = formatFinancialDoc(inv);
  assert.ok(out.includes('Nubank'));
  assert.ok(out.includes('Total: R$ 250,00'));
  assert.ok(out.includes('4 itens'));
  ['iFood almoço', 'Uber centro', 'Restaurante X', '99 corrida'].forEach((d) => assert.ok(out.includes(d), 'falta item: ' + d));
  assert.ok(out.includes('(1/3)'), 'parcela renderizada');
});

test('formatFinancialDoc: total calculado quando não vem pronto + sem itens não quebra', () => {
  const out = formatFinancialDoc({ emissor: 'X', itens: [{ descricao: 'A', valor: 12.5 }, { descricao: 'B', valor: 7.5 }] });
  assert.ok(out.includes('Total: R$ 20,00'));
  assert.ok(out.includes('2 itens'));
  const vazio = formatFinancialDoc({ emissor: 'Y', itens: [] });
  assert.ok(vazio.includes('0 itens'));
});

test('pickDocTitle: monta Fatura <emissor> MM/AAAA; fallback', () => {
  assert.strictEqual(pickDocTitle({ emissor: 'Santander', vencimento: '2026-07-10' }), 'Fatura Santander 07/2026');
  assert.ok(pickDocTitle({}).startsWith('Fatura'));
});
