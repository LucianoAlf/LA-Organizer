// CONFIRMACAO-DE-EVENTO (07/10) — passado + conflito numa pergunta só, um "sim" só.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const c = require('./confirmacao-evento');

const JORNADA = { id: '41a6e5af', title: 'Jornada de Cordas', start_at: '2026-10-07T16:00:00+00:00', end_at: '2026-10-07T20:00:00+00:00', reason: 'partial_overlap' };
const REUNIAO = { title: 'Reuniao semana da crianças', start_at: '2026-10-07T15:30:00-03:00', end_at: '2026-10-07T16:30:00-03:00' };
const CRIADA = Date.parse('2026-10-06T20:52:13Z');

test('pendencias: conflito real, futuro → segura só pelo conflito', () => {
  const p = c.pendencias({ item: REUNIAO, startIso: REUNIAO.start_at, conflitos: [JORNADA], agoraMs: CRIADA });
  assert.deepEqual([p.segurar, p.passado, p.conflitos.length], [true, false, 1]);
});

test('pendencias: flags do engine liberam (as duas de uma vez)', () => {
  const ok = c.marcarConfirmado(REUNIAO);
  const p = c.pendencias({ item: ok, startIso: REUNIAO.start_at, conflitos: [JORNADA], agoraMs: Date.parse('2026-10-08T00:00:00Z') });
  assert.equal(p.segurar, false);
  assert.equal(REUNIAO[c.FLAG_CONFLITO], undefined, 'não muta');
});

test('pergunta: caso real (só conflito)', () => {
  assert.equal(c.perguntaDeConfirmacao([{ acao: 'criar', titulo: REUNIAO.title, start_at: REUNIAO.start_at, end_at: REUNIAO.end_at, passado: false, conflitos: [JORNADA] }]),
    'Antes de marcar *Reuniao semana da crianças* (07/10 15:30–16:30):\n• bate com *Jornada de Cordas* (13:00–17:00)\n\nMarco assim mesmo? Se preferir outro horário, me diz qual.');
});

test('pergunta: passado + conflito forte (outro local) num bloco; remarcar muda o verbo', () => {
  const q = c.perguntaDeConfirmacao([{ acao: 'remarcar', titulo: 'X', start_at: REUNIAO.start_at, end_at: REUNIAO.end_at, passado: true, conflitos: [{ ...JORNADA, reason: 'presencial_diff_location', location_text: 'LA Barra' }] }]);
  assert.equal(q, 'Antes de remarcar *X* pra 07/10 15:30–16:30:\n• esse horário já passou\n• bate com *Jornada de Cordas* (13:00–17:00, em LA Barra)\n\nRemarco assim mesmo? Se preferir outro horário, me diz qual.');
});

test('flags do modelo saem', () => {
  const it = { title: 'x', _passado_confirmado: true, _conflito_confirmado: true };
  c.descartarFlagsDoModelo(it);
  assert.deepEqual(it, { title: 'x' });
});
