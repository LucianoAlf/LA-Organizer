'use strict';
// PETERSON-INTEGRITY-HIDES-OKCOUNT — rodar: node --test src/lib/integrity-reply.test.js
const test = require('node:test');
const assert = require('node:assert');
const { buildIntegrityReply } = require('./integrity-reply');

const DUP = 'Achei uma tarefa parecida já criada:\n_"Formatar texto..."_\n\nResponde com o número: 1️⃣ 2️⃣ 3️⃣';

test('Peterson: okCount=5 + dup → footer das criadas APARECE antes do menu', () => {
  const r = buildIntegrityReply('', DUP, 5);
  assert.match(r, /5 tarefas já registradas/, 'as 5 criadas não podem sumir');
  assert.match(r, /Responde com o número/, 'o menu de dedup continua');
  // ordem: criadas antes do menu
  assert.ok(r.indexOf('registradas') < r.indexOf('Responde'), 'footer das criadas vem antes do menu');
});

test('okCount=0 → NADA persistiu: sem footer de criadas, e ✅ otimista rebaixado', () => {
  const r = buildIntegrityReply('✅ *Conversar com a Dai* criado!', DUP, 0);
  assert.ok(!/já registrada/.test(r), 'não pode dizer que registrou nada');
  assert.ok(!/criado!/.test(r), 'o ✅ otimista some (failed)');
  assert.match(r, /Responde com o número/);
});

test('okCount=1 → singular', () => {
  assert.match(buildIntegrityReply('', DUP, 1), /1 tarefa já registrada\b/);
});

test('okCount>0: claim vago sem quantificador é rebaixado pelo partial; footer determinístico carrega a verdade', () => {
  const r = buildIntegrityReply('Criei as outras pra você 👇', DUP, 3);
  assert.ok(!/Criei as outras/.test(r), 'claim otimista sem número some (partial)');
  assert.match(r, /3 tarefas já registradas/, 'o footer determinístico é a fonte da verdade');
});

test('okCount>0: linha NEUTRA do cleanText é preservada', () => {
  const r = buildIntegrityReply('Beleza, Peterson!', DUP, 2);
  assert.match(r, /Beleza, Peterson!/, 'frase neutra (sem claim de conclusão) sobrevive');
  assert.match(r, /2 tarefas já registradas/);
});

test('sem dupQuestion → só o prev (defensivo)', () => {
  assert.strictEqual(buildIntegrityReply('', '', 2), '✅ 2 tarefas já registradas.');
});

test('EVENT (gêmeo): opts de evento → footer "eventos já registrados"', () => {
  const r = buildIntegrityReply('', DUP, 2, { sing: 'evento já registrado', plur: 'eventos já registrados' });
  assert.match(r, /2 eventos já registrados/);
  assert.ok(!/tarefas/.test(r), 'não fala "tarefas" no domínio de evento');
});

test('entradas vazias não quebram', () => {
  assert.strictEqual(typeof buildIntegrityReply('', DUP, 0), 'string');
  assert.strictEqual(typeof buildIntegrityReply(null, null, null), 'string');
});
