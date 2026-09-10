'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { seriesFamintas } = require('./series-famintas');

const DIA = 86400000;
// Gerador diário de teste: mesmo horário UTC do dtstart, dentro de [de, ate].
function diaria(_rule, dtstart, de, ate) {
  const out = [];
  let t = dtstart.getTime();
  while (t < de.getTime()) t += DIA;
  for (; t <= ate.getTime(); t += DIA) out.push(new Date(t));
  return out;
}
const AGORA = Date.parse('2026-09-10T12:00:00Z');
// "Marcar presencas do horário" da Ana: diária 13:00 BRT desde 10/08.
const PRESENCAS = { id: 'm1', table: 'events', title: 'Marcar presencas do horário', recurrence_rule: 'FREQ=DAILY',
  start_at: '2026-08-10T16:00:00+00:00', created_at: '2026-08-10T20:51:44Z' };
const dias = (...ds) => new Map([['m1', ds.map((d) => `2026-09-${d}`)]]);

test('série com todas as datas da janela criadas não está com fome', () => {
  const r = seriesFamintas({ moldes: [PRESENCAS], diasPorMolde: dias(10, 11, 12, 13, 14, 15, 16), agoraMs: AGORA, janelaDias: 7, proximas: diaria });
  assert.deepStrictEqual(r, []);
});

test('o gerador parou: as datas acabam antes da janela → faminta, com quantas faltam', () => {
  const r = seriesFamintas({ moldes: [PRESENCAS], diasPorMolde: dias(10, 11, 12, 13, 14), agoraMs: AGORA, janelaDias: 7, proximas: diaria });
  assert.strictEqual(r.length, 1);
  assert.strictEqual(r[0].id, 'm1');
  assert.strictEqual(r[0].faltam, 2);
});

test('molde criado há menos de 24h não acusa — o gerador ainda não passou por ele', () => {
  const novo = { ...PRESENCAS, created_at: '2026-09-10T08:00:00Z' };
  assert.deepStrictEqual(seriesFamintas({ moldes: [novo], diasPorMolde: new Map(), agoraMs: AGORA, proximas: diaria }), []);
});

test('o dia do próprio molde conta como coberto (Anne: semanal que começa 15/09)', () => {
  const estacio = { id: 'm2', table: 'events', title: 'Olhar o site da Estácio', recurrence_rule: 'FREQ=WEEKLY',
    start_at: '2026-09-15T14:00:00+00:00', created_at: '2026-08-18T12:00:00Z' };
  const soODia = () => [new Date('2026-09-15T14:00:00Z')];
  assert.deepStrictEqual(seriesFamintas({ moldes: [estacio], diasPorMolde: new Map(), agoraMs: AGORA, proximas: soODia }), []);
});

test('tarefa usa due_date como âncora', () => {
  const tk = { id: 't1', table: 'tasks', title: 'Conferir caixa', recurrence_rule: 'FREQ=DAILY', due_date: '2026-08-01', created_at: '2026-08-01T10:00:00Z' };
  const r = seriesFamintas({ moldes: [tk], diasPorMolde: new Map(), agoraMs: AGORA, proximas: diaria });
  assert.strictEqual(r.length, 1);
  assert.strictEqual(r[0].table, 'tasks');
});

test('regra que não parseia não derruba o sensor', () => {
  const quebra = () => { throw new Error('rrule inválida'); };
  assert.deepStrictEqual(seriesFamintas({ moldes: [PRESENCAS], diasPorMolde: new Map(), agoraMs: AGORA, proximas: quebra }), []);
});

test('entrada torta nunca quebra', () => {
  assert.deepStrictEqual(seriesFamintas({ moldes: null, diasPorMolde: null, agoraMs: AGORA, proximas: diaria }), []);
  assert.deepStrictEqual(seriesFamintas({ moldes: [{}], diasPorMolde: new Map(), agoraMs: AGORA, proximas: diaria }), []);
});

test('O CASO REAL: gerador parado desde 18/08, datas criadas até 16/09 → a janela padrão acusa em 10/09', () => {
  // Com a janela de 7 dias este mesmo estado dava "tudo ok" (medido em produção em 10/09).
  const r = seriesFamintas({ moldes: [PRESENCAS], diasPorMolde: dias(10, 11, 12, 13, 14, 15, 16), agoraMs: AGORA, proximas: diaria });
  assert.strictEqual(r.length, 1);
  assert.ok(r[0].faltam >= 20, `faltam ${r[0].faltam}`);
});

test('uma noite só de gerador falhando já aparece na manhã seguinte', () => {
  const cheio = [];
  for (let k = 0; k < 27; k++) cheio.push(new Date(AGORA + k * DIA + 4 * 3600000).toISOString().slice(0, 10));
  const r = seriesFamintas({ moldes: [PRESENCAS], diasPorMolde: new Map([['m1', cheio]]), agoraMs: AGORA, proximas: diaria });
  assert.strictEqual(r.length, 1);
  assert.strictEqual(r[0].faltam, 1);
});
