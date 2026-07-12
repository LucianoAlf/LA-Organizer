const test = require('node:test');
const assert = require('node:assert');
const { buildLaunchPreview, buildPayInvoicePreview, detectLaunchConfirm, detectUndoLaunch } = require('./launch-confirm');
const { detectUserConfirmation } = require('../services/user-confirmation');

// decisão real do engine: text → conf (detectUserConfirmation) → detectLaunchConfirm
const decide = (text) => detectLaunchConfirm(text, detectUserConfirmation(text));

const cardItem = (over = {}) => ({
  op: 'card_purchase',
  source: { kind: 'card', id: 'c1', name: 'Latam PASS' },
  txn: { type: 'expense', amount: 62.92, description: 'Cheirin', category: 'alimentacao', installments: 1, date: '2026-06-04', ...over },
});

test('preview: 1 item cartão mostra valor, categoria e fonte', () => {
  const out = buildLaunchPreview([cardItem()]);
  assert.match(out, /Cheirin/);
  assert.match(out, /62,92/);
  assert.match(out, /Latam PASS/);
  assert.match(out, /sim/i); // pede confirmação
});

test('preview: parcelado mostra "em 3x"', () => {
  const out = buildLaunchPreview([cardItem({ amount: 350.04, installments: 3, description: 'Sofá' })]);
  assert.match(out, /em 3x/);
});

test('preview: vários itens, fonte única aparece UMA vez', () => {
  const out = buildLaunchPreview([cardItem(), cardItem({ description: 'Polo', amount: 38.98 })]);
  assert.match(out, /Cheirin/);
  assert.match(out, /Polo/);
  assert.strictEqual((out.match(/Latam PASS/g) || []).length, 1);
});

test('preview: receita usa sinal +', () => {
  const out = buildLaunchPreview([{
    op: 'cash', source: { kind: 'account', id: 'a1', name: 'Itaú' },
    txn: { type: 'income', amount: 1000, description: 'Projeto', category: 'salario', installments: 1, date: '2026-06-16' },
  }]);
  assert.match(out, /\+R\$\s?1\.000,00/);
});

test('preview: mostra a data dd/mm quando informada', () => {
  assert.match(buildLaunchPreview([cardItem({ date: '2026-06-21' })]), /21\/06/);
});

test('preview: sem data → "hoje"', () => {
  assert.match(buildLaunchPreview([cardItem({ date: undefined })]), /hoje/);
});

test('preview: lista vazia → null', () => {
  assert.strictEqual(buildLaunchPreview([]), null);
});

test('pay-invoice preview: cartão, valor, competência, conta e tarefa', () => {
  const out = buildPayInvoicePreview({ cardName: 'Nubank', amount: 6295.54, competencia: '2026-06-01', fromName: 'Itaú', taskTitles: ['Pagar fatura Nubank'] });
  assert.match(out, /Nubank/);
  assert.match(out, /6\.295,54/);
  assert.match(out, /junho\/2026/);
  assert.match(out, /Itaú/);
  assert.match(out, /Pagar fatura Nubank/);
  assert.match(out, /sim/i);
});

test('pay-invoice preview: sem conta e sem tarefa', () => {
  const out = buildPayInvoicePreview({ cardName: 'C6', amount: 100, competencia: '2026-07-01' });
  assert.doesNotMatch(out, /saindo da/);
  assert.doesNotMatch(out, /fecho a tarefa/i);
});

test('pay-invoice preview: valor zero → null', () => {
  assert.strictEqual(buildPayInvoicePreview({ cardName: 'X', amount: 0 }), null);
});

// ── detectLaunchConfirm — CONFIRMAÇÃO do lançamento estagiado (launch_confirm) ──
// BUG Rose 11/07 23:40: "Não lança" casava o verbo "lança" (regex generoso, engine 8534)
// e lançava contra o "não" → 11 itens gravados sem OK. Regressão do FIN-INVOICE-COMMIT-ON-QUESTION
// no caminho launch_confirm. Regra de ouro: negação NUNCA lança.
test('NÃO lança quando o user NEGA — "Não lança" (o bug da Rose)', () => {
  assert.strictEqual(decide('Não lança'), 'no');
  assert.notStrictEqual(decide('Não lança'), 'yes');
});
test('NÃO lança: variações de negação com o verbo "lança"', () => {
  assert.strictEqual(decide('Nao lança'), 'no');           // sem acento
  assert.strictEqual(decide('não pode lançar agora'), 'no');
  assert.strictEqual(decide('por favor não lança'), 'no'); // "não" não está no início → guarda extra
  assert.strictEqual(decide('melhor não'), 'no');
  assert.strictEqual(decide('espera, não lança ainda'), 'no');
});
test('LANÇA quando o user AFIRMA', () => {
  assert.strictEqual(decide('sim'), 'yes');
  assert.strictEqual(decide('pode lançar'), 'yes');
  assert.strictEqual(decide('manda lançar'), 'yes');
  assert.strictEqual(decide('confirmado'), 'yes');
  assert.strictEqual(decide('lança'), 'yes');
  assert.strictEqual(decide('lança como outros'), 'yes');  // Rose 23:33 (consentiu)
});
test('ambíguo/correção (sem sim/não claro e sem verbo) → null (cai no LLM)', () => {
  assert.strictEqual(decide('era 50 reais'), null);
  assert.strictEqual(decide('esse é o cartão itaú'), null);
});
test('contrato puro: conf="no" nunca vira yes mesmo com o verbo "lança"', () => {
  assert.strictEqual(detectLaunchConfirm('lança isso', 'no'), 'no');
});

// ── detectUndoLaunch — DESFAZER o lote recém-lançado ("apaga tudo") ──
// Rose 11/07 23:44: "Apaga tudo" caiu no LLM → sob timeout/fallback não desfez → apagou manual.
// Determinístico agora (gated por intent undo_launch aberta), sobrevive a fallback.
test('detectUndoLaunch: reconhece "apaga tudo"/"desfaz"/"cancela o lançamento"', () => {
  assert.strictEqual(detectUndoLaunch('Apaga tudo'), true);   // frase exata da Rose
  assert.strictEqual(detectUndoLaunch('apaga tudo isso'), true);
  assert.strictEqual(detectUndoLaunch('desfaz'), true);
  assert.strictEqual(detectUndoLaunch('desfaz o lançamento'), true);
  assert.strictEqual(detectUndoLaunch('cancela o lançamento'), true);
  assert.strictEqual(detectUndoLaunch('apaga isso'), true);
  assert.strictEqual(detectUndoLaunch('apaga o que você lançou'), true);
});
test('detectUndoLaunch: NÃO dispara em item específico, negação ou fala solta', () => {
  assert.strictEqual(detectUndoLaunch('apaga o uber'), false);   // item específico (fluxo txn_pick/LLM)
  assert.strictEqual(detectUndoLaunch('não apaga'), false);
  assert.strictEqual(detectUndoLaunch('sim'), false);
  assert.strictEqual(detectUndoLaunch('manda a próxima fatura'), false);
  assert.strictEqual(detectUndoLaunch('obrigada'), false);
});
