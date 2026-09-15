'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { mesmoHorario, rotuloHorario } = require('./mesmo-horario');

// Alf, 14/09: os dois compromissos reais.
const LEVI = { title: 'Mentoria com Levi', start_at: '2026-09-18T09:00:00-03:00', end_at: '2026-09-18T10:00:00-03:00' };
const KENNEDY = { title: 'Mentoria com Kennedy', start_at: '2026-09-17T09:00:00-03:00', end_at: '2026-09-17T10:00:00-03:00' };

test('Alf: Kennedy na quinta 9h e Levi na sexta 9h NÃO colidem', () => {
  assert.strictEqual(mesmoHorario(KENNEDY, LEVI), false);
});

test('quarta, quinta e sexta às 9h são três compromissos', () => {
  const qua = { start_at: '2026-09-16T09:00:00-03:00', end_at: '2026-09-16T10:00:00-03:00' };
  assert.strictEqual(mesmoHorario(qua, KENNEDY), false);
  assert.strictEqual(mesmoHorario(qua, LEVI), false);
});

test('mesmo dia e mesmo horário colide; horário sobreposto também', () => {
  assert.strictEqual(mesmoHorario(KENNEDY, { start_at: '2026-09-17T09:00:00-03:00', end_at: '2026-09-17T10:00:00-03:00' }), true);
  assert.strictEqual(mesmoHorario(KENNEDY, { start_at: '2026-09-17T09:30:00-03:00', end_at: '2026-09-17T10:30:00-03:00' }), true);
});

test('mesmo dia em horários diferentes não colide; encostar no fim não é sobrepor', () => {
  assert.strictEqual(mesmoHorario(KENNEDY, { start_at: '2026-09-17T15:00:00-03:00', end_at: '2026-09-17T16:00:00-03:00' }), false);
  assert.strictEqual(mesmoHorario(KENNEDY, { start_at: '2026-09-17T10:00:00-03:00', end_at: '2026-09-17T11:00:00-03:00' }), false);
});

test('sem fim vale 1 hora; sem início não dá pra colidir', () => {
  assert.strictEqual(mesmoHorario({ start_at: '2026-09-17T09:40:00-03:00' }, KENNEDY), true);
  assert.strictEqual(mesmoHorario({ start_at: '2026-09-17T08:30:00-03:00' }, KENNEDY), true, '8h30 sem fim ocupa até 9h30 e pega a mentoria das 9h');
  assert.strictEqual(mesmoHorario({ start_at: '2026-09-17T10:30:00-03:00' }, KENNEDY), false);
  assert.strictEqual(mesmoHorario({ title: 'x' }, KENNEDY), false);
});

test('meia-noite: o dia é o de Brasília, não o UTC', () => {
  const noite = { start_at: '2026-09-17T23:30:00-03:00', end_at: '2026-09-17T23:59:00-03:00' };
  const madrugadaSeguinte = { start_at: '2026-09-18T00:10:00-03:00', end_at: '2026-09-18T01:00:00-03:00' };
  assert.strictEqual(mesmoHorario(noite, madrugadaSeguinte), false);
});

test('rótulo do horário ocupado', () => {
  assert.strictEqual(rotuloHorario(KENNEDY), 'qui 17/09, 9h–10h');
  assert.strictEqual(rotuloHorario({ start_at: '2026-09-18T08:30:00-03:00', end_at: '2026-09-18T09:30:00-03:00' }), 'sex 18/09, 8h30–9h30');
  // 22h30 em Brasília já é dia seguinte em UTC — o rótulo tem que ser o dia de quem lê.
  assert.strictEqual(rotuloHorario({ start_at: '2026-09-17T22:30:00-03:00', end_at: '2026-09-17T23:30:00-03:00' }), 'qui 17/09, 22h30–23h30');
});

const ENG = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'engine.js'), 'utf8');
test('engine: duplicata só no mesmo horário, mensagem diz o horário, "Sim" mostra o conflito e o "2" deixa rastro', () => {
  assert.ok(ENG.includes('if (!mesmoHorario(candidate, ev)) continue;'), 'o detector ainda compara compromissos de outro horário');
  assert.ok(ENG.includes('Você já tem um compromisso nesse mesmo horário'), 'a mensagem não diz que é o mesmo horário');
  assert.ok(ENG.includes('else if (_res.integrityPayload) _out = _buildIntegrityConfirmText(_res.integrityPayload);'), 'o "Sim" ainda responde a frase vaga');
  assert.ok(ENG.includes("'EVENT_CREATE', 'executed', `dup_bypass_choice2:"), 'o "cria mesmo assim" continua sem marcador');
});
