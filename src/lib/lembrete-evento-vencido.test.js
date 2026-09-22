const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { lembreteDeEventoVencido } = require('./lembrete-evento-vencido');

// Números reais do incidente Ana Paula (event_reminders + events em produção).
const SABADO_13H = '2026-09-19T16:00:00Z';        // 19/09 13:00 BRT
const DOMINGO_13H = '2026-09-20T16:00:00Z';       // 20/09 13:00 BRT
const SEGUNDA_MEIA_NOITE = new Date('2026-09-21T03:00:14Z'); // 21/09 00:00:14 BRT

test('o lembrete de sábado entregue na meia-noite de segunda está vencido', () => {
  const r = lembreteDeEventoVencido(SABADO_13H, SEGUNDA_MEIA_NOITE);
  assert.equal(r.vencido, true);
  assert.equal(r.atrasoMin, 35 * 60);
});

test('o lembrete de domingo entregue na meia-noite de segunda está vencido', () => {
  const r = lembreteDeEventoVencido(DOMINGO_13H, new Date('2026-09-21T03:00:15Z'));
  assert.equal(r.vencido, true);
  assert.equal(r.atrasoMin, 11 * 60);
});

test('o disparo saudável (15min antes, no tick seguinte) segue de pé', () => {
  // remind_at 12:45, cron dispara 12:45:13 — o padrão de 35 das 39 linhas da Ana.
  const r = lembreteDeEventoVencido(SABADO_13H, new Date('2026-09-19T15:45:13Z'));
  assert.equal(r.vencido, false);
});

test('o lembrete "na hora" (mins=0) sobrevive ao atraso do tick', () => {
  const r = lembreteDeEventoVencido(SABADO_13H, new Date('2026-09-19T16:00:20Z'));
  assert.equal(r.vencido, false);
});

test('atraso dentro da tolerância não derruba; fora dela derruba', () => {
  assert.equal(lembreteDeEventoVencido(SABADO_13H, new Date('2026-09-19T16:05:00Z')).vencido, false);
  assert.equal(lembreteDeEventoVencido(SABADO_13H, new Date('2026-09-19T16:06:00Z')).vencido, true);
});

test('start_at inválido não derruba nada (fail-open)', () => {
  assert.equal(lembreteDeEventoVencido(null, SEGUNDA_MEIA_NOITE).vencido, false);
  assert.equal(lembreteDeEventoVencido('nao-e-data', SEGUNDA_MEIA_NOITE).vencido, false);
});

// Catraca de fonte: o guard só serve se rodar ANTES dos dois `continue` que adiam sem
// consumir (DND e quiet_day). Se ele ficar depois, a linha morta continua viva na fila
// e volta a ser entregue quando o dia virar — que é exatamente o defeito de 21/09.
test('o guard de vencido roda antes dos defers de DND e quiet no checkEventReminders', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'rituals', 'dispatcher.js'), 'utf8');
  const ini = src.indexOf('async function checkEventReminders()');
  assert.ok(ini > 0, 'checkEventReminders não encontrada');
  const fim = src.indexOf('\nasync function ', ini + 10);
  const corpo = src.slice(ini, fim > 0 ? fim : src.length);

  const guard = corpo.indexOf('lembreteDeEventoVencido');
  const dnd = corpo.indexOf('getDndState');
  const quiet = corpo.indexOf('isQuietNow');

  assert.ok(guard > 0, 'checkEventReminders não chama lembreteDeEventoVencido');
  assert.ok(guard < dnd, 'o guard de vencido precisa vir antes do defer de DND');
  assert.ok(guard < quiet, 'o guard de vencido precisa vir antes do defer de quiet_day');
});
