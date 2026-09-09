'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { unificaEscritas } = require('./escritas-recentes');
const { restatesRecentWrite } = require('/opt/LA-Organizer/src/lib/optimistic-confirm');

// O turno real: evento criado 19:19:03, reafirmado 19:19:26.
const EVENTO_DA_MENTORIA = [{ title: 'Mentoria de IA — Leonardo da Br[Ai]n', start_at: '2026-09-10T17:30:00Z' }];
const FALA_QUE_REAFIRMA = 'Esse é o comprovante da Mentoria com Leonardo — e tá batendo certinho '
  + 'com o que já ficou na agenda:\n\n📅 *Mentoria de IA — Leonardo da Br[Ai]n*';

test('CASO ALF: reafirmar um EVENTO recém-criado passa a contar como reafirmação', () => {
  // Antes, a lista vinha só de `tasks` — o evento era invisível, o guard achava que era promessa
  // vazia, o auto-retry disparava e nascia uma TAREFA duplicando o evento.
  const soTarefas = unificaEscritas([], []);
  assert.strictEqual(restatesRecentWrite(FALA_QUE_REAFIRMA, soTarefas), false,
    'sem o evento na lista, a reafirmação não é reconhecida — era este o estado');

  const comEvento = unificaEscritas([], EVENTO_DA_MENTORIA);
  assert.strictEqual(restatesRecentWrite(FALA_QUE_REAFIRMA, comEvento), true,
    'com o evento na lista, o guard reconhece e não deixa o retry duplicar');
});

test('tarefa e evento entram na mesma lista, no formato que o guard espera', () => {
  const r = unificaEscritas(
    [{ title: 'Comprar cabo', remind_at: '2026-09-10T12:00:00Z' }],
    [{ title: 'Reunião MKT', start_at: '2026-09-10T18:00:00Z' }],
  );
  assert.deepStrictEqual(r, [
    { title: 'Comprar cabo', remind_at: '2026-09-10T12:00:00Z' },
    { title: 'Reunião MKT', remind_at: '2026-09-10T18:00:00Z' },
  ]);
});

test('o tempo do evento vem de start_at — é o que a pessoa cita ao reafirmar', () => {
  const [e] = unificaEscritas([], [{ title: 'X', start_at: '2026-09-10T18:00:00Z' }]);
  assert.strictEqual(e.remind_at, '2026-09-10T18:00:00Z');
});

test('linha sem título é descartada — nunca vira casamento por vazio', () => {
  const r = unificaEscritas([{ remind_at: 'x' }, null], [{ start_at: 'y' }, undefined]);
  assert.deepStrictEqual(r, []);
});

test('entrada torta nunca lança', () => {
  for (const [a, b] of [[null, null], [undefined, undefined], ['x', 3], [{}, {}]]) {
    assert.doesNotThrow(() => unificaEscritas(a, b));
    assert.deepStrictEqual(unificaEscritas(a, b), []);
  }
});

test('o engine busca escritas recentes pelo modulo, nas DUAS portas', () => {
  // A trava: eram duas consultas `from('tasks')` soltas, uma na porta de cima
  // (downgradeEmptyPromise) e outra na de baixo (enforceNoMarkerHonesty). Se uma voltar a
  // montar a lista à mão, o evento fica invisível de novo naquela porta.
  const fs = require('fs');
  const path = require('path');
  const eng = fs.readFileSync(path.join('/opt/LA-Organizer/src', 'engine.js'), 'utf8');
  const usos = (eng.match(/buscarEscritasRecentes\(/g) || []).length;
  assert.strictEqual(usos, 2, 'as duas portas de honestidade têm que usar a mesma fonte');
});
