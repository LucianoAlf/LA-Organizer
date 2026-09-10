'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { fundeBlocosRepetidos } = require('./funde-blocos-repetidos');

// O turno real do Alf, 09/09/2026 19:19. O TOM anunciou dois compromissos e criou um:
// marker_logs guardou `UNKNOWN_MARKER_STRIPPED · names:EVENT_CREATE,EVENT_CREATE,END delta:225`.
const TURNO_DO_ALF = [
  '✅ Dois compromissos marcados pra amanhã:',
  '',
  '<<EVENT_CREATE>>{"title":"Mentoria de IA — Leonardo da Br[Ai]n","start_at":"2026-09-10T14:30:00-03:00","context":"personal"}<<END>>',
  '<<EVENT_CREATE>>{"title":"Entrevista — Serjão (Recepcionista SonoraMente)","start_at":"2026-09-10T13:30:00-03:00","context":"work"}<<END>>',
].join('\n');

test('o turno do Alf: dois blocos viram um, com os DOIS eventos', () => {
  const out = fundeBlocosRepetidos(TURNO_DO_ALF, 'EVENT_CREATE');
  const blocos = out.match(/<<EVENT_CREATE>>/g) || [];
  assert.strictEqual(blocos.length, 1, 'tem que sobrar um bloco só');

  const corpo = out.match(/<<EVENT_CREATE>>([\s\S]*?)<<END>>/)[1];
  const itens = JSON.parse(corpo);
  assert.strictEqual(itens.length, 2, 'a Entrevista do Serjão não pode ficar pra trás');
  assert.match(itens[0].title, /Mentoria/);
  assert.match(itens[1].title, /Serj/);
});

test('a ordem é preservada', () => {
  const t = '<<TASK_UPDATE>>[{"n":1}]<<END>> meio <<TASK_UPDATE>>[{"n":2},{"n":3}]<<END>>';
  const itens = JSON.parse(fundeBlocosRepetidos(t, 'TASK_UPDATE').match(/<<TASK_UPDATE>>([\s\S]*?)<<END>>/)[1]);
  assert.deepStrictEqual(itens.map((i) => i.n), [1, 2, 3], 'array e objeto se misturam na ordem lida');
});

test('o texto ao redor sobrevive — é ele que a pessoa lê', () => {
  const out = fundeBlocosRepetidos(TURNO_DO_ALF, 'EVENT_CREATE');
  assert.match(out, /Dois compromissos marcados pra amanhã/,
    'o cleanText de cada parser sai daqui; comer a fala do TOM seria trocar um bug por outro');
});

test('UM bloco só passa intacto — o caminho de todo turno normal', () => {
  const um = 'oi <<EVENT_CREATE>>{"title":"x"}<<END>>';
  assert.strictEqual(fundeBlocosRepetidos(um, 'EVENT_CREATE'), um);
  assert.strictEqual(fundeBlocosRepetidos('sem marker nenhum', 'EVENT_CREATE'), 'sem marker nenhum');
});

test('JSON quebrado em QUALQUER bloco aborta a fusão inteira', () => {
  // Fail-closed: melhor o comportamento antigo (perde o 2º) do que gravar payload remendado.
  // Escrita perdida some do banco; escrita ERRADA entra e ninguém audita.
  const t = '<<EVENT_CREATE>>{"title":"ok"}<<END>> <<EVENT_CREATE>>{isso nao e json}<<END>>';
  assert.strictEqual(fundeBlocosRepetidos(t, 'EVENT_CREATE'), t);
});

test('marker fora da allowlist nunca funde', () => {
  // FINANCE_ACTION le o payload direto, sem Array.isArray — e e dinheiro. Fundir la sem ler o
  // executor inteiro seria adivinhar.
  const t = '<<FINANCE_ACTION>>{"a":1}<<END>> <<FINANCE_ACTION>>{"a":2}<<END>>';
  assert.strictEqual(fundeBlocosRepetidos(t, 'FINANCE_ACTION'), t);
  const h = '<<HABIT_ACTION>>{"a":1}<<END>> <<HABIT_ACTION>>{"a":2}<<END>>';
  assert.strictEqual(fundeBlocosRepetidos(h, 'HABIT_ACTION'), h,
    'HABIT_ACTION ja resolve sozinho com /gi — fundir aqui seria trabalho dobrado');
});

test('tres blocos ou mais também fundem', () => {
  // O caso da Fefê (01/07): names:TASK_UPDATE,TASK_UPDATE,TASK_UPDATE,END,TASK_UPDATE
  const t = ['<<TASK_UPDATE>>{"n":1}<<END>>', '<<TASK_UPDATE>>{"n":2}<<END>>',
    '<<TASK_UPDATE>>{"n":3}<<END>>'].join('\n');
  const itens = JSON.parse(fundeBlocosRepetidos(t, 'TASK_UPDATE').match(/<<TASK_UPDATE>>([\s\S]*?)<<END>>/)[1]);
  assert.strictEqual(itens.length, 3);
});

// O turno da Rafinha, 17/07/2026 09:59:31 BRT. Ela mandou 10 itens do checklist, o TOM
// confirmou os 10 — e o parser consumiu UM. Os outros nove viraram
// `UNKNOWN_MARKER_STRIPPED` e ela leu o rodapé honesto pedindo pra repetir "o que faltou".
// Mesma raiz reincidiu em 09/09 11:21 com a Juliana (9 itens).
const TURNO_DA_RAFINHA = [
  '✅ Marcando os 10 da *L.A Drums Games Peterson*!',
  '',
  ...[
    'fad2a627-b903-427c-9037-c803e60d2de5', '31f48117-c90d-45e2-931d-ffc52e2a97ff',
    'c8e06586-70e9-4c43-8adb-2af17f9b95ed', '7f872ba2-ff7e-401a-a05b-68d89d4e1c37',
    '5b1c0f2a-2d44-4a51-9a1e-6f0b7c8d9e10', 'a1b2c3d4-e5f6-4708-8910-111213141516',
    'b2c3d4e5-f607-4819-9021-222324252627', 'c3d4e5f6-0718-492a-a132-333435363738',
    'd4e5f607-1829-4a3b-b243-444546474849', 'e5f60718-293a-4b4c-c354-555657585960',
  ].map((id) => `<<PERSONAL_LIST_ACTION>>{"action":"toggle_item","item_id":"${id}","is_done":true}<<END>>`),
].join('\n');

test('o turno da Rafinha: dez blocos viram um, com os DEZ toggles', () => {
  const out = fundeBlocosRepetidos(TURNO_DA_RAFINHA, 'PERSONAL_LIST_ACTION');
  const blocos = out.match(/<<PERSONAL_LIST_ACTION>>/g) || [];
  assert.strictEqual(blocos.length, 1, 'tem que sobrar um bloco só');

  const itens = JSON.parse(out.match(/<<PERSONAL_LIST_ACTION>>([\s\S]*?)<<END>>/)[1]);
  assert.strictEqual(itens.length, 10, 'nove itens ficavam pra trás e ela tinha que repetir');
  assert.ok(itens.every((i) => i.action === 'toggle_item' && i.is_done === true));
  assert.match(out, /Marcando os 10/, 'a fala que a pessoa lê sobrevive');
});

test('entrada torta nunca lança', () => {
  // Roda no caminho de todo turno: se lançar aqui, o turno inteiro morre.
  for (const e of [null, undefined, '', 123, {}]) {
    assert.doesNotThrow(() => fundeBlocosRepetidos(e, 'EVENT_CREATE'));
  }
  assert.doesNotThrow(() => fundeBlocosRepetidos('texto', null));
  assert.doesNotThrow(() => fundeBlocosRepetidos('texto', ''));
});

// ---------------------------------------------------------------------------
// A CATRACA. O helper sozinho nao conserta nada — ele precisa estar LIGADO nos parsers.
// 21 dos 23 parsers do engine usam regex nao-global; a licao ja existia no HABIT_ACTION
// desde um incidente igual ("com regex nao-global so o 1o era consumido") e nao tinha
// atravessado pras outras portas. Este teste e o que impede a lição de se perder de novo.
// ---------------------------------------------------------------------------
test('as SEIS portas fundem antes de parsear', () => {
  const fs = require('fs');
  const path = require('path');
  const eng = fs.readFileSync(path.join(__dirname, '..', 'engine.js'), 'utf8');
  for (const marker of ['TASK_UPDATE', 'EVENT_CREATE', 'EVENT_UPDATE', 'MEMORY_SAVE', 'MONTHLY_PLAN']) {
    assert.ok(eng.includes(`fundeBlocosRepetidos(text, '${marker}')`),
      `${marker} parou de fundir — o 2o bloco volta a virar UNKNOWN_MARKER_STRIPPED e a `
      + 'escrita some com a pessoa lendo a confirmacao');
  }
  // PERSONAL_LIST_ACTION é parseado inline, sobre `reply` — não tem função `parseXMarker`.
  assert.ok(eng.includes("fundeBlocosRepetidos(reply, 'PERSONAL_LIST_ACTION')"),
    'PERSONAL_LIST_ACTION parou de fundir — foi o caso da Rafinha (17/07) e da Juliana (09/09)');
  assert.ok(eng.includes("require('./lib/funde-blocos-repetidos')"), 'import sumiu do engine');
});
