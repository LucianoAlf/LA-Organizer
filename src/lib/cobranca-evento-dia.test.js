// COBRANCA-ONTEM-ERRADO (Alf 07/10 08:14): "🔵 Luciano, como foi *Mentoria Levi* ontem?" — o
// evento era de 05/10 (anteontem). O dia vinha de floor(horas desde o FIM / 24).
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const c = require('./cobranca-evento-dia');

// Linha REAL como estava quando a cobrança saiu: 05/10 09:00–10:00 BRT.
const MENTORIA = { title: 'Mentoria Levi', start_at: '2026-10-05T12:00:00+00:00', end_at: '2026-10-05T13:00:00+00:00' };
const ENVIO = Date.parse('2026-10-07T11:14:00Z'); // 07/10 08:14 BRT

test('a conta antiga (horas desde o fim) dava 1 = "ontem" — o defeito', () => {
  assert.equal(Math.max(1, Math.floor((ENVIO - Date.parse(MENTORIA.end_at)) / 86400000)), 1);
});

test('dias corridos no fuso de SP: 05/10 → 07/10 = 2', () => {
  assert.equal(c.diasCorridos(MENTORIA.start_at, '2026-10-07'), 2);
});

test('palavra do dia vem da data real', () => {
  assert.equal(c.quandoFoi('2026-10-07T09:00:00-03:00', '2026-10-07'), 'hoje cedo');
  assert.equal(c.quandoFoi('2026-10-06T15:00:00-03:00', '2026-10-07'), 'ontem');
  assert.equal(c.quandoFoi(MENTORIA.start_at, '2026-10-07'), 'anteontem');
  assert.equal(c.quandoFoi('2026-10-01T15:00:00-03:00', '2026-10-07'), 'no dia 01/10');
});

test('evento às 22h BRT (01:00 UTC do dia seguinte) conta pelo dia BRT', () => {
  // 07/10 01:00Z = 06/10 22:00 BRT → ontem (pela data UTC daria "hoje cedo")
  assert.equal(c.quandoFoi('2026-10-07T01:00:00+00:00', '2026-10-07'), 'ontem');
});

test('caso real: a cobrança da Mentoria diz anteontem, nunca ontem', () => {
  const r = c.textoCobranca({ nome: 'Luciano', titulo: MENTORIA.title, startIso: MENTORIA.start_at, hojeYmd: '2026-10-07' });
  assert.doesNotMatch(r.texto, /\bontem\b/);
  assert.match(r.texto, /anteontem/);
  assert.equal(r.dias, 2);
  assert.equal(r.kind, 'overdue_check');
  assert.equal(r.texto, '🟠 Luciano, *Mentoria Levi* (anteontem) ficou aberta. Já rolou? Manda "feito" ou me conta — texto/áudio.');
});

test('ontem mantém a pergunta original', () => {
  const r = c.textoCobranca({ nome: 'Luciano', titulo: 'X', startIso: '2026-10-06T15:00:00-03:00', hojeYmd: '2026-10-07' });
  assert.equal(r.texto, '🔵 Luciano, como foi *X* ontem? Me diz "feito" pra fechar, ou conta o que rolou.');
  assert.equal(r.kind, 'closure_check');
});

test('mais velho: data explícita + há N dias', () => {
  const r = c.textoCobranca({ nome: 'Luciano', titulo: 'X', startIso: '2026-10-01T15:00:00-03:00', hojeYmd: '2026-10-07' });
  assert.equal(r.texto, '🚨 Luciano, *X* (no dia 01/10, há 6 dias) sem fechamento. Fecha ou reagenda? Não dá pra ignorar — qualquer resposta serve.');
  assert.equal(r.kind, 'staleness_check');
});
