'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { planoDaCitacao, textoChecklistMarcado, pistaChecklist } = require('./checklist-citado');

// Quintela 06/07 17:27 (50443ed4): o alerta mostrou os 4 itens nessa ordem, todos ⬜.
const F = [
  { id: 'aaaa1111-0000-4000-8000-000000000001', title: 'Acolher a mãe da aluna do prof. Will', status: 'pending', sort_position: 0 },
  { id: 'bbbb2222-0000-4000-8000-000000000002', title: 'Apurar internamente os relatos sobre o professor', status: 'pending', sort_position: 1 },
  { id: 'cccc3333-0000-4000-8000-000000000003', title: 'Conversar com o professor Will de forma objetiva', status: 'pending', sort_position: 2 },
  { id: 'dddd4444-0000-4000-8000-000000000004', title: 'Verificar se há relatos parecidos de outros alunos no mesmo horário (quarta 20h)', status: 'pending', sort_position: 3 },
];
const posicoes = (arr) => arr.map((c) => c.sort_position);
const plano = (userText, filhas = F, confirmou = true) => planoDaCitacao({ userText, filhas, confirmou });
const FALA = 'Desse checklist a unica coisa que ficou faltando é a resposta da familia, no caso o primeiro item, o resto ja coloque como feito';

test('Quintela: "só faltou o primeiro item, o resto coloque como feito" → marca 2, 3 e 4; o 1 fica', () => {
  const p = plano(FALA);
  assert.deepStrictEqual(posicoes(p.marcar), [1, 2, 3]);
  assert.deepStrictEqual(posicoes(p.faltam), [0]);
});

test('a posição é a da lista do alerta (sort_position), não a ordem em que o banco devolveu', () => {
  assert.deepStrictEqual(posicoes(plano(FALA, [F[3], F[1], F[0], F[2]]).marcar), [1, 2, 3]);
});

test('itens citados e feitos: "itens 2 e 3 feitos" e "o 1º e o 4º já fiz"', () => {
  assert.deepStrictEqual(posicoes(plano('itens 2 e 3 feitos').marcar), [1, 2]);
  assert.deepStrictEqual(posicoes(plano('o 1º e o 4º já fiz').marcar), [0, 3]);
});

test('não inverte nem adivinha: "o primeiro fiz, o resto não" / "o item 2 ainda não, o item 3 fiz" → null', () => {
  assert.strictEqual(plano('o primeiro fiz, o resto não'), null);
  assert.strictEqual(plano('o item 2 ainda não, o item 3 fiz'), null);
});

test('"itens 1 e 2 fiz, o resto ainda falta" → null (o "falta" do resto não pode inverter os citados)', () => {
  assert.strictEqual(plano('itens 1 e 2 fiz, o resto ainda falta'), null);
});

test('"o resto feito" sem dizer qual falta, e item que não existe → null', () => {
  assert.strictEqual(plano('o resto pode colocar como feito'), null);
  assert.strictEqual(plano('só falta o item 7, o resto feito'), null);
});

test('"só falta o primeiro" sem dizer que o resto foi feito → null (pode ser só um relato)', () => {
  assert.strictEqual(plano('só falta o primeiro item'), null);
});

test('já marcado não entra de novo: com o 2 feito, "o resto feito, só falta o primeiro" → 3 e 4', () => {
  const f = F.map((c) => (c.sort_position === 1 ? { ...c, status: 'done' } : c));
  assert.deepStrictEqual(posicoes(plano('o resto feito, só falta o primeiro', f).marcar), [2, 3]);
});

test('"feito" curto e confirmado → o checklist todo; sem confirmação → null', () => {
  assert.deepStrictEqual(posicoes(plano('Isso foi feito').marcar), [0, 1, 2, 3]);
  assert.strictEqual(plano('Isso foi feito', F, false), null);
});

test('fala longa que cita um item por palavras não vira "tudo feito"; dia da semana não é ordinal', () => {
  assert.strictEqual(plano('já conversei com o professor Will hoje, ficou tudo certo'), null);
  assert.strictEqual(plano('feito na quarta'), null);
});

test('nada pendente → null', () => {
  assert.strictEqual(plano(FALA, F.map((c) => ({ ...c, status: 'done' }))), null);
});

test('texto da resposta e pista pro LLM', () => {
  assert.strictEqual(textoChecklistMarcado({ titulo: 'Retenção', marcados: 3, bloco: '*Checklist:* 3/4', avisos: [] }),
    '✅ Marquei 3 itens do checklist de *Retenção*.\n\n*Checklist:* 3/4');
  assert.strictEqual(textoChecklistMarcado({ titulo: 'R', marcados: 1, bloco: '', avisos: ['✅ fechou'] }), '✅ Marquei 1 item do checklist de *R*.\n\n✅ fechou');
  const p = pistaChecklist('ffff9999-0000-4000-8000-000000000009', F);
  assert.match(p, /1\. item_id aaaa1111 — ⬜ Acolher/);
  assert.match(p, /"parent_id":"ffff9999"/);
  assert.match(p, /NÃO conclua a tarefa inteira/);
});

const ENG = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'engine.js'), 'utf8');
test('engine: citação a tarefa com checklist aberto vira mark-item e não cai no TASKDONE da mãe', () => {
  assert.match(ENG, /const _td = !_ckPend && decideTaskDoneFromQuote\(\{ rawText: text, target: _target \}\);/);
  assert.match(ENG, /action: 'mark-item', parent_id: _target\.refId, item_id: c\.id, done: true/);
  assert.match(ENG, /buildReplyRefCtxHint\(_target\) \+ _ckPista;/);
});

test('"item 7" no singular também é posição (o regex casava só "iten(s)")', () => {
  const { ordinaisCitados } = require('./checklist-citado');
  assert.deepStrictEqual([...ordinaisCitados('só falta o item 7')], [7]);
  assert.deepStrictEqual([...ordinaisCitados('itens 2, 3 e 4')], [2, 3, 4]);
});
