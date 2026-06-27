'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { decideTaskDoneFromQuote } = require('./taskdone-quote');

// O detector REAL (detectUserConfirmation) não carrega local (pending-intents → ../supabase/client,
// só na VPS). Aqui injetamos stubs pra provar a LÓGICA do helper; o vocabulário "done" real
// ("Isso foi feito" → yes) é certificado no E2E da VPS.
const yes = () => 'yes';
const no = () => 'no';
const nul = () => null;

const TASK_TGT = { refType: 'task', refId: 'a034a0ae-1111', title: 'Cancelar aulas do Isaac e da Mariana' };
const EVENT_TGT = { refType: 'event', refId: 'e1', title: 'Reunião' };
const scaffold = (u) => `[O usuário está RESPONDENDO a esta mensagem anterior: "📌 Arthur, amanhã: Cancelar aulas do Isaac e da Mariana"]\n${u}`;

test('task + confirm=yes → conclui (refId+title)', () => {
  assert.deepEqual(
    decideTaskDoneFromQuote({ rawText: scaffold('Isso foi feito'), target: TASK_TGT, detectConfirm: yes }),
    { refId: 'a034a0ae-1111', title: 'Cancelar aulas do Isaac e da Mariana' });
});
test('confirm=no → null (não conclui)', () => {
  assert.equal(decideTaskDoneFromQuote({ rawText: scaffold('ainda não'), target: TASK_TGT, detectConfirm: no }), null);
});
test('confirm=null (resposta com conteúdo) → null (não age sozinho)', () => {
  assert.equal(decideTaskDoneFromQuote({ rawText: scaffold('não fiz ainda mas faço amanhã'), target: TASK_TGT, detectConfirm: nul }), null);
});
test('alvo = EVENTO → null mesmo com confirm=yes (escopo só task)', () => {
  assert.equal(decideTaskDoneFromQuote({ rawText: scaffold('isso foi feito'), target: EVENT_TGT, detectConfirm: yes }), null);
});
test('sem alvo (target null) → null', () => {
  assert.equal(decideTaskDoneFromQuote({ rawText: scaffold('feito'), target: null, detectConfirm: yes }), null);
});
test('task sem refId → null (defensivo)', () => {
  assert.equal(decideTaskDoneFromQuote({ rawText: scaffold('feito'), target: { refType: 'task' }, detectConfirm: yes }), null);
});
test('o detector recebe o userText SEM o scaffold (família reply-quote)', () => {
  let seen = null;
  decideTaskDoneFromQuote({ rawText: scaffold('Isso foi feito'), target: TASK_TGT, detectConfirm: (u) => { seen = u; return 'yes'; } });
  assert.equal(seen, 'Isso foi feito');
});
