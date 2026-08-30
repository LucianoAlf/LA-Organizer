'use strict';
// HABIT-MULTI-BLOCO-SILENT-DROP (Matheus 25/08 08:14:50→08:15:03 BRT, finding b94f7465).
//
// "Da checkin ai que o pai tá brabo! ontem e hoje CHECK" → o LLM emitiu DOIS
// <<HABIT_ACTION>> separados (24/08 e 25/08). `parseHabitMarker` usa regex NÃO-global:
// consumiu o 1º, deixou o 2º no texto, e o catch-all stripper o removeu
// (marker_logs UNKNOWN_MARKER_STRIPPED names:HABIT_ACTION,HABIT_ACTION,END delta:87).
// Só 1 habit_log foi gravado. Mesmo defeito que fez nascer `parseFinanceMarkers` em
// 03/06 (caso Luciano, "Estacionamento / Ifood") — HABIT_ACTION ficou de fora.
//
// O env é stubado antes do require porque supabase/client exige as duas vars e a suíte
// roda sem --env-file.
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://stub.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'stub-key';

const { test } = require('node:test');
const assert = require('node:assert');

const { parseHabitMarker } = require('../engine');

const LITERAL_MATHEUS = [
  'Haha, pai brabo é pai orgulhoso! 💪 Registrando os dois:',
  '',
  '<<HABIT_ACTION>>{"action":"log","habit_name":"CrossFit","date":"2026-08-24"}<<END>>',
  '<<HABIT_ACTION>>{"action":"log","habit_name":"CrossFit","date":"2026-08-25"}<<END>>',
].join('\n');

test('caso Matheus 25/08: dois blocos HABIT_ACTION → as DUAS ações são parseadas', () => {
  const r = parseHabitMarker(LITERAL_MATHEUS);
  assert.ok(r && !r.malformed, 'parse devia ter dado certo');
  assert.strictEqual(r.actions.length, 2, 'o 2º <<HABIT_ACTION>> foi descartado em silêncio');
  assert.deepStrictEqual(r.actions.map((a) => a.date), ['2026-08-24', '2026-08-25']);
});

test('caso Matheus 25/08: nenhum marker sobra no texto entregue ao usuário', () => {
  const r = parseHabitMarker(LITERAL_MATHEUS);
  assert.ok(!/<<HABIT_ACTION>>|<<END>>/.test(r.cleanText),
    'marker residual no cleanText — é ele que o catch-all stripper remove e vira aviso de perda parcial');
});

// --- CONTROLES: têm que valer antes e depois do fix ---

test('controle: um bloco só segue funcionando, cleanText limpo', () => {
  const r = parseHabitMarker('Registrado!\n\n<<HABIT_ACTION>>{"action":"log","habit_name":"CrossFit"}<<END>>');
  assert.strictEqual(r.actions.length, 1);
  assert.strictEqual(r.cleanText, 'Registrado!');
});

test('controle: um bloco com ARRAY de 2 (caminho que já funcionava)', () => {
  const r = parseHabitMarker('Dois:\n<<HABIT_ACTION>>[{"action":"log","habit_name":"CrossFit"},{"action":"log","habit_name":"Ler"}]<<END>>');
  assert.strictEqual(r.actions.length, 2);
});

test('controle: texto sem marker devolve null', () => {
  assert.strictEqual(parseHabitMarker('Bom dia! Tudo certo por aqui.'), null);
});

test('controle: dois blocos, o 2º malformado → o 1º válido sobrevive', () => {
  const r = parseHabitMarker([
    'Anotando:',
    '<<HABIT_ACTION>>{"action":"log","habit_name":"CrossFit"}<<END>>',
    '<<HABIT_ACTION>>{isso nao e json}<<END>>',
  ].join('\n'));
  assert.ok(r && !r.malformed, 'um bloco quebrado não pode derrubar o bloco bom');
  assert.strictEqual(r.actions.length, 1);
  assert.ok(!/<<HABIT_ACTION>>/.test(r.cleanText), 'o bloco malformado também tem que sair do texto');
});

test('controle: TODOS os blocos malformados → malformed, com motivos', () => {
  const r = parseHabitMarker('<<HABIT_ACTION>>{"action":"update","habit_name":"CrossFit"}<<END>>');
  assert.ok(r && r.malformed);
  assert.ok(Array.isArray(r.motivos) && r.motivos.length, 'motivos alimenta o redirect de habit-sem-edicao');
});
