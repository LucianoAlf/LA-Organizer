'use strict';
// qa-delegacao-ligada.test.js — QA-DELEGA-PRA-GENTE-REAL (30/09, 08:13–08:15).
// O gov-agent rodou o Replay Lab com "[QA] Replay 01" repetindo as frases reais da Krissya
// ("delega pra Kailane…"). O TOM criou 2 tarefas de verdade pra Kailane de verdade, ela recebeu 2
// avisos no WhatsApp e, às 15h, o lembrete. A trava `qa-isolation.permiteDelegacao` ("QA só delega
// pra QA, gente só pra gente") EXISTIA desde 05/08 — mas nunca foi chamada fora do próprio arquivo.
// Guard sem fio é etiqueta. Agora ela está na porta de criar-pra-outro (tarefa E evento) e na de
// repassar tarefa existente.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { canCreateForOther } = require('./roles');

const QA = { id: 'q', full_name: '[QA] Replay 01', phone: '5500999990001', role: 'collaborator' };
const KAILANE = { id: 'k', full_name: 'Kailane Marcos', phone: '5521900000000', role: 'collaborator', unit: 'Barra' };
const KRISSYA = { id: 'r', full_name: 'Krissya', phone: '5521900000001', role: 'manager', unit: 'Barra' };
const QA2 = { id: 'q2', full_name: '[QA] Replay 02', phone: '5500999990002', role: 'collaborator' };

test('QA não cria tarefa/evento pra gente real (e gente real não cria pra QA)', () => {
  assert.deepStrictEqual(canCreateForOther(QA, KAILANE), { allowed: false, reason: 'qa_isolation' });
  assert.deepStrictEqual(canCreateForOther(KRISSYA, QA), { allowed: false, reason: 'qa_isolation' });
});
test('QA↔QA e gente↔gente seguem como antes', () => {
  assert.strictEqual(canCreateForOther(QA, QA2).allowed, true);
  assert.strictEqual(canCreateForOther(KRISSYA, KAILANE).allowed, true);
});
test('perfil QA renomeado continua isolado pelo telefone (e vice-versa)', () => {
  assert.strictEqual(canCreateForOther({ ...QA, full_name: 'Replay' }, KAILANE).allowed, false);
  assert.strictEqual(canCreateForOther({ ...QA, phone: '5521911112222' }, KAILANE).allowed, false);
});

const engine = fs.readFileSync(path.join(__dirname, '..', 'engine.js'), 'utf8');
test('âncora: o repasse de tarefa existente (delegate) também passa pela trava de QA', () => {
  const i = engine.indexOf("console.warn('[Task] delegate REJECTED — self-delegation');");
  assert.ok(i > 0, 'âncora do delegate sumiu');
  const depois = engine.slice(i, i + 900);
  assert.match(depois, /permiteDelegacao\(collaborator, recipient\)/);
});
test('âncora: a limpeza da sombra apaga também o que o perfil QA CRIOU', () => {
  const sombra = fs.readFileSync(path.join(__dirname, '..', 'governance', 'shadow-runner.js'), 'utf8');
  assert.match(sombra, /from\('tasks'\)\.delete\(\)\.eq\('created_by', qa\.id\)\.gte\('created_at', inicioRodada\)/);
  assert.ok(!/from\('tasks'\)\.delete\(\)\.eq\('created_by', qa\.id\)\);/.test(sombra), 'nunca apagar TUDO o que o QA criou — só a rodada');
});
