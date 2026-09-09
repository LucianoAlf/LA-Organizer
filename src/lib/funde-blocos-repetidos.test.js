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
test('as CINCO portas fundem antes de parsear', () => {
  const fs = require('fs');
  const path = require('path');
  const eng = fs.readFileSync(path.join(__dirname, '..', 'engine.js'), 'utf8');
  for (const marker of ['TASK_UPDATE', 'EVENT_CREATE', 'EVENT_UPDATE', 'MEMORY_SAVE', 'MONTHLY_PLAN']) {
    assert.ok(eng.includes(`fundeBlocosRepetidos(text, '${marker}')`),
      `${marker} parou de fundir — o 2o bloco volta a virar UNKNOWN_MARKER_STRIPPED e a `
      + 'escrita some com a pessoa lendo a confirmacao');
  }
  assert.ok(eng.includes("require('./lib/funde-blocos-repetidos')"), 'import sumiu do engine');
});
