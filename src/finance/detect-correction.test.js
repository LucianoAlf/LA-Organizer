const { test } = require('node:test');
const assert = require('node:assert');
const { detectCorrection } = require('./detect-correction');

test('era <num> → edit amount', () => {
  assert.deepStrictEqual(detectCorrection('era 25'), { op: 'edit', amount: 25 });
  assert.deepStrictEqual(detectCorrection('na verdade era 25'), { op: 'edit', amount: 25 });
  assert.deepStrictEqual(detectCorrection('corrige pra 30'), { op: 'edit', amount: 30 });
  assert.deepStrictEqual(detectCorrection('muda o valor pra 40'), { op: 'edit', amount: 40 });
});
test('valor com milhar/decimal', () => {
  assert.deepStrictEqual(detectCorrection('era R$ 1.234,56'), { op: 'edit', amount: 1234.56 });
});
test('muda a categoria pra <canônica> → edit category', () => {
  assert.deepStrictEqual(detectCorrection('muda a categoria pra lazer'), { op: 'edit', category: 'lazer' });
  assert.deepStrictEqual(detectCorrection('troca a categoria pra Alimentação'), { op: 'edit', category: 'alimentacao' });
});
test('categoria não-canônica → null (LLM trata)', () => {
  assert.strictEqual(detectCorrection('muda a categoria pra xpto'), null);
});
test('delete com âncora financeira', () => {
  assert.deepStrictEqual(detectCorrection('exclui essa'), { op: 'delete', ref: 'exclui essa' });
  assert.deepStrictEqual(detectCorrection('apaga a de 30'), { op: 'delete', ref: 'apaga a de 30' });
  assert.deepStrictEqual(detectCorrection('exclui o lançamento'), { op: 'delete', ref: 'exclui o lançamento' });
});
test('delete SEM âncora financeira → null (pode ser tarefa/evento)', () => {
  assert.strictEqual(detectCorrection('cancela a reunião'), null);
  assert.strictEqual(detectCorrection('apaga a reunião amanhã'), null);
  assert.strictEqual(detectCorrection('apaga o evento de sexta'), null);
});
test('nova despesa NÃO é correção', () => {
  assert.strictEqual(detectCorrection('gastei 50 no mercado'), null);
  assert.strictEqual(detectCorrection('comprei tv 1200 em 10x no nubank'), null);
});
test('vazio/não-string → null', () => {
  assert.strictEqual(detectCorrection(''), null);
  assert.strictEqual(detectCorrection(null), null);
});
test('delete pronome-only só com 2 palavras (verbo+pronome)', () => {
  assert.deepStrictEqual(detectCorrection('apaga isso'), { op: 'delete', ref: 'apaga isso' });
});
test('NÃO apaga "apaga essa tarefa" (3ª palavra não-financeira)', () => {
  assert.strictEqual(detectCorrection('apaga essa tarefa'), null);
});
test('"apaga essa transação" ainda dispara (substantivo financeiro)', () => {
  assert.deepStrictEqual(detectCorrection('apaga essa transação'), { op: 'delete', ref: 'apaga essa transação' });
});
