'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { detectExplicitDayIntent } = require('./temporal-intent');
const { stripReplyScaffold } = require('../events/detect-approval-reply');

// Caso real Ana (29/06 13:01): reply-quote a uma cobrança que diz "Resolve hoje
// ou reagenda?" + fala "remarcar para dia 05/07". O "hoje" da CITAÇÃO não pode
// contar como intenção do usuário, senão o auto-align clobbera o 05/07 pra hoje.
const ANA = '[O usuário está RESPONDENDO a esta mensagem anterior: "🔴 *Pagamento Rescisão professor Lana* atrasou 1 dia. Resolve hoje ou reagenda? Me responde aqui — pode ser áudio."]\nTom, eu pedi para remarcar para dia 05/07. Será incluído na folha';

test('CONTROLE: a forma BUGGY (texto cru) casaria "hoje" da citação — prova que o teste pega o bug', () => {
  const cruLC = ANA.toLowerCase();
  // Reproduz a detecção antiga (sem stripReplyScaffold): o bug era exatamente este.
  const buggyWantsToday = /\b(hoje)\b/.test(cruLC) && !/\bamanh[ãa]/.test(cruLC);
  assert.strictEqual(buggyWantsToday, true, 'o texto cru DEVE casar "hoje" (da citação) — é o bug que estamos matando');
});

test('Ana: "hoje" na CITAÇÃO não conta — reschedule p/ 05/07 não vira hoje', () => {
  const r = detectExplicitDayIntent(ANA);
  assert.strictEqual(r.wantsToday, false);
  assert.strictEqual(r.wantsTomorrow, false);
  // sanity: o scaffold realmente separa a fala real
  assert.match(stripReplyScaffold(ANA).userText, /^Tom, eu pedi/);
});

test('Ana 28/06: variação "Reagenda... Me lembra dia 05/07" também não contamina', () => {
  const txt = '[O usuário está RESPONDENDO a esta mensagem anterior: "🔴 Pagamento Rescisão professor Lana atrasou 1 dia. Resolve hoje ou reagenda?"]\nReagenda tom\nVai ser incluído no pagamento.\n\nMe lembra dia 05/07 apenas';
  assert.deepStrictEqual(detectExplicitDayIntent(txt), { wantsToday: false, wantsTomorrow: false });
});

test('NEGATIVO: "amanhã" na CITAÇÃO (cobrança "vence amanhã") não contamina', () => {
  const txt = '[O usuário está RESPONDENDO a esta mensagem anterior: "Colocar cabo na planilha vence amanhã. Tá encaminhado?"]\nremarca pra dia 10';
  assert.deepStrictEqual(detectExplicitDayIntent(txt), { wantsToday: false, wantsTomorrow: false });
});

test('LEGÍTIMO preservado: "hoje" na fala REAL ainda alinha', () => {
  assert.deepStrictEqual(detectExplicitDayIntent('paga isso hoje'), { wantsToday: true, wantsTomorrow: false });
});

test('LEGÍTIMO preservado: "amanhã" na fala real tem precedência sobre "hoje"', () => {
  assert.deepStrictEqual(detectExplicitDayIntent('hoje não, me lembra amanhã'), { wantsToday: false, wantsTomorrow: true });
});

test('LEGÍTIMO preservado: sem scaffold, "hoje" puro conta', () => {
  assert.deepStrictEqual(detectExplicitDayIntent('hoje'), { wantsToday: true, wantsTomorrow: false });
});

test('reply-quote LEGÍTIMO: "hoje" na fala real (não na citação) ainda conta', () => {
  const txt = '[O usuário está RESPONDENDO a esta mensagem anterior: "Quer reagendar?"]\npode deixar pra hoje mesmo';
  assert.deepStrictEqual(detectExplicitDayIntent(txt), { wantsToday: true, wantsTomorrow: false });
});
