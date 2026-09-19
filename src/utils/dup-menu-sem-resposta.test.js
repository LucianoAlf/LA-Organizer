'use strict';
// Audit 17/09 (Rafinha, achado a60338c6) — o menu de dup que NÃO TEM RESPOSTA COERENTE.
//
// Ele derrubou a proposta de recado às 20:07:32, o LLM re-emitiu os 4 TASK_CREATE e o
// dup-guard renderizou o menu 1/2/3 com os dois lados BYTE A BYTE IGUAIS:
//   existente "Trocar lâmpada do bistrô — Campo Grande" / nova a mesma string,
// oferecendo 2️⃣ "crio essa nova mesmo (com nome um pouco diferente pra não confundir)".
// 1 e 2 descrevem a MESMA string e a 2 promete um rename que ninguém faz. Ele respondeu
// "Ô, Tom, tá vacilando" e o mesmo menu voltou 38s depois.
//
// Por que o skip de re-emit não pegou: a existente 0dbf3f4b nasceu 20:02:34 e o re-emit
// chegou 20:07:52 — 5min18s, DEZOITO segundos acima do teto de 5min. O relógio de parede
// era o único discriminador. Alargar a janela reabre a cascata da Ana (08/07), então o que
// este teste fixa é a decomposição: IDENTIDADE (autor+prazo+título) e JANELA são duas
// perguntas, e só a segunda é sobre tempo.
const { test } = require('node:test');
const assert = require('node:assert');
const { isSelfRecentConflict, isSameItemConflict } = require('./self-recent-conflict');

const RAFINHA = 'c9e72a40-3f91-4be8-bc6c-0e4060f7fc84';
const TITULO = 'Trocar lâmpada do bistrô — Campo Grande';
const WIN = 5 * 60 * 1000;
const NASCEU = '2026-09-17T20:02:34.448842-03:00';
const REEMIT = new Date('2026-09-17T20:07:52.517798-03:00').getTime(); // 5min18s depois

const existente = (o = {}) => ({
  id: '0dbf3f4b-640f-497c-8d8f-4cb939edd359',
  created_by: RAFINHA,
  created_at: NASCEU,
  due_date: '2026-09-18',
  title: TITULO,
  ...o,
});

test('turno real: 5min18s deixa o skip silencioso de fora (janela preservada)', () => {
  assert.strictEqual(
    isSelfRecentConflict(existente(), RAFINHA, REEMIT, WIN, '2026-09-18', TITULO),
    false,
  );
});

test('turno real: mesmo fora da janela, é o MESMO item — menu não tem resposta', () => {
  assert.strictEqual(
    isSameItemConflict(existente(), RAFINHA, '2026-09-18', TITULO),
    true,
  );
});

test('título distinto segue virando menu (doutrina de 18/09 preservada)', () => {
  assert.strictEqual(
    isSameItemConflict(existente(), RAFINHA, '2026-09-18', 'Trocar lâmpada do corredor do estúdio — Campo Grande'),
    false,
  );
});

test('prazo distinto segue virando menu (série multi-dia da Ana, 11/09)', () => {
  assert.strictEqual(
    isSameItemConflict(existente(), RAFINHA, '2026-09-30', TITULO),
    false,
  );
});

test('outro autor segue virando menu — identidade não atravessa pessoas', () => {
  assert.strictEqual(
    isSameItemConflict(existente({ created_by: 'outro' }), RAFINHA, '2026-09-18', TITULO),
    false,
  );
});

test('dentro da janela o skip silencioso continua igual (cascata da Ana, 08/07)', () => {
  const dentro = new Date('2026-09-17T20:04:00-03:00').getTime();
  assert.strictEqual(
    isSelfRecentConflict(existente(), RAFINHA, dentro, WIN, '2026-09-18', TITULO),
    true,
  );
});
