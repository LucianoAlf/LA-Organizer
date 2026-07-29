const { test } = require('node:test');
const assert = require('node:assert');
const { detectCorrection, detectFinanceEditIntent } = require('./detect-correction');

// ── FINEDIT-TRANSCRIPT-HIJACK (caso Alf 28/07) ────────────────────────────────
// Áudio de 1min sobre COMPRAR iluminação foi sequestrado pelo redirect de edição de
// lançamento: "finalizar a compra da iluminação" casou RE_TXN_NOUN_LOOSE e "estamos
// colocando a marcenaria" casou RE_EDIT_LOOSE (coloca\w*). Resposta determinística em
// 1 SEGUNDO ("esse lançamento tá fora das ~2h"), sem passar pelo LLM. Mesmo padrão do
// PROJECT-INTENT-TRANSCRIPT-HIJACK (09/07) e do FINEDIT-QUOTE-SCAFFOLD-MISROUTE (27/06).
const AUDIO_ALF_2807 = `[áudio transcrito] Então é o seguinte, o Sonoramente é o nosso núcleo de inclusão que vai atender os nossos alunos autistas, entendeu? Enfim, é um centro de musicoterapia, a gente tá chamando de núcleo de inclusão, mas é um centro de musicoterapia e tá na reta final, estamos colocando a marcenaria, é um espaço dentro da LA Unidade Campo Grande, sacou? E aí a parte de iluminação, são fitas de LED, são lâmpadas para dentro da sala, entendeu? Que a gente precisa colocar, tem os móveis, os instrumentos, enfim, tem muita coisa, mas a parte de iluminação eu acho que é o que destrava agora, entendeu?

>>> Demandas detectadas pelo decompositor (processe TODAS, uma por uma):
1. Revisar o projeto do Sonoramente para levantar a quantidade de lâmpadas por sala e finalizar a compra da iluminação.`;

test('transcrição longa NÃO é intenção de editar lançamento (caso Alf 28/07)', () => {
  assert.strictEqual(detectFinanceEditIntent(AUDIO_ALF_2807), null);
});

test('texto longo genérico com "compra" + verbo comum não dispara', () => {
  const longo = 'Preciso te explicar uma coisa. ' + 'A gente vai colocar os móveis novos na sala e depois fazer a compra do material. '.repeat(4);
  assert.ok(longo.length > 280);
  assert.strictEqual(detectFinanceEditIntent(longo), null);
});

test('NÃO-REGRESSÃO: comando curto de edição continua detectado', () => {
  assert.deepStrictEqual(detectFinanceEditIntent('muda a categoria daquela compra'), { op: 'edit' });
  assert.deepStrictEqual(detectFinanceEditIntent('corrige o valor do lancamento'), { op: 'edit' });
});

test('NÃO-REGRESSÃO: comando curto de exclusão continua detectado', () => {
  assert.deepStrictEqual(detectFinanceEditIntent('apaga aquele lancamento'), { op: 'delete' });
});

test('NÃO-REGRESSÃO: texto sem substantivo de transação segue null', () => {
  assert.strictEqual(detectFinanceEditIntent('coloca o prazo pra sexta'), null);
});

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
