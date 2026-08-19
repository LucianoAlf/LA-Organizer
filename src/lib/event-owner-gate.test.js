// src/lib/event-owner-gate.test.js
// Rodar: node --test src/lib/event-owner-gate.test.js
//
// EVENT-PARTICIPANT-GATE-MUDO (Alf 19/08 12:14 BRT) — o gate "participante só pode completar"
// (engine.js ~3332) rejeitava reschedule/cancel de convidado SEM empurrar failMessage. O caller
// só tinha o fallback genérico "_não consegui atualizar o compromisso_", que soa como defeito
// técnico e esconde a ação certa. Caso real: Alf respondeu ao lembrete da "Reunião MKT - NBG!"
// com "será às 14h ok?"; o TOM entendeu, emitiu EVENT_UPDATE certo, o resolver achou o evento
// (dono: Yuri) — e a recusa saiu muda. A mensagem tem que dizer QUEM pode e OFERECER o recado.
const { test } = require('node:test');
const assert = require('node:assert');
const { buildOwnerGateMessage } = require('./event-owner-gate');

test('reschedule por participante: nomeia o dono e oferece o recado', () => {
  const m = buildOwnerGateMessage('reschedule', 'Reunião MKT - NBG!', 'Yuri');
  assert.match(m, /Reunião MKT - NBG!/);
  assert.match(m, /\*Yuri\*/);
  assert.match(m, /remarcar/i);
  assert.match(m, /recado/i);
  assert.match(m, /\?\s*$/, 'termina em pergunta (oferta de coordenação)');
});
test('cancel por participante: verbo certo', () => {
  const m = buildOwnerGateMessage('cancel', 'Reunião X', 'Yuri');
  assert.match(m, /cancelar/i);
});
test('ação desconhecida cai no verbo genérico "alterar"', () => {
  const m = buildOwnerGateMessage('update', 'Reunião X', 'Yuri');
  assert.match(m, /alterar/i);
});
test('sem nome do dono: não inventa — fala "quem criou"', () => {
  const m = buildOwnerGateMessage('reschedule', 'Reunião X', null);
  assert.match(m, /quem criou/i);
  assert.doesNotMatch(m, /\*null\*|\*undefined\*/);
});
test('nunca soa como falha técnica', () => {
  for (const a of ['reschedule', 'cancel', 'update']) {
    const m = buildOwnerGateMessage(a, 'T', 'Dono');
    assert.doesNotMatch(m, /não consegui|problema técnico|erro/i);
  }
});
