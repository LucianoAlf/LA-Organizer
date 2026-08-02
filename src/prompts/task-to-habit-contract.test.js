'use strict';
// Contrato prompt ↔ parser do <<TASK_TO_HABIT>>.
//
// Classe de bug que já custou caro aqui: o prompt ENSINA um formato e o código espera
// outro, e a ação vira NOOP silencioso (o LLM obedece, o parser não reconhece, ninguém
// vê). Este teste lê os DOIS arquivos como texto — o exemplo literal que o TOM aprende
// e o regex literal que o engine usa — e prova que um casa com o outro.
const assert = require('node:assert');
const { test } = require('node:test');
const fs = require('fs');
const path = require('path');

const SYSTEM_SRC = fs.readFileSync(path.join(__dirname, 'system.js'), 'utf8');
const ENGINE_SRC = fs.readFileSync(path.join(__dirname, '..', 'engine.js'), 'utf8');

test('o prompt ensina o marker e o engine tem o parser dele', () => {
  assert.ok(SYSTEM_SRC.includes('<<TASK_TO_HABIT>>'), 'prompt não ensina o marker');
  assert.ok(ENGINE_SRC.includes('<<TASK_TO_HABIT>>'), 'engine não tem o parser');
});

test('o marker está na lista de VÁLIDOS do prompt (senão o TOM se autocensura)', () => {
  const bloco = SYSTEM_SRC.slice(SYSTEM_SRC.indexOf('MARKERS VÁLIDOS'), SYSTEM_SRC.indexOf('MARKERS HALLUCINATED'));
  assert.ok(bloco.includes('<<TASK_TO_HABIT>>'), 'marker fora da lista canônica');
});

test('o exemplo do prompt casa com o regex do engine e parseia', () => {
  // exemplo literal ensinado ao TOM
  const ex = SYSTEM_SRC.match(/<<TASK_TO_HABIT>>\{[^\n]*?\}<<END>>/);
  assert.ok(ex, 'exemplo de uso não encontrado no prompt');

  // regex literal do engine
  const reSrc = ENGINE_SRC.match(/const reT2H = (\/<<TASK_TO_HABIT>>[^\n]*?\/i);/);
  assert.ok(reSrc, 'regex do parser não encontrado no engine');
  const re = eval(reSrc[1]); // eslint-disable-line no-eval

  const m = String(ex[0]).match(re);
  assert.ok(m, 'o exemplo que o prompt ensina NÃO casa com o parser do engine');

  const payload = JSON.parse(m[1]);
  assert.ok(typeof payload.task_title === 'string' && payload.task_title.length > 0);
  assert.ok(typeof payload.reminder_time === 'string');
});

test('o parser aceita as variações reais que o LLM produz', () => {
  const reSrc = ENGINE_SRC.match(/const reT2H = (\/<<TASK_TO_HABIT>>[^\n]*?\/i);/);
  const re = eval(reSrc[1]); // eslint-disable-line no-eval
  const casos = [
    ['sem reminder_time', '<<TASK_TO_HABIT>>{"task_title":"Verificar presenças"}<<END>>'],
    ['com quebra de linha e espaços', '<<TASK_TO_HABIT>>\n  {\n "task_title": "X",\n "reminder_time": "08:30"\n }\n<<END>>'],
    ['array de duas rotinas', '<<TASK_TO_HABIT>>[{"task_title":"A"},{"task_title":"B"}]<<END>>'],
    ['com prosa antes', 'Beleza, deixo só como lembrete.\n<<TASK_TO_HABIT>>{"task_title":"A"}<<END>>'],
  ];
  for (const [nome, txt] of casos) {
    const m = txt.match(re);
    assert.ok(m, `parser não casou: ${nome}`);
    assert.doesNotThrow(() => JSON.parse(m[1].trim()), `JSON inválido: ${nome}`);
  }
});

test('o marker é reconhecido como executável (não é stripado como alucinação)', () => {
  const known = fs.readFileSync(path.join(__dirname, '..', 'lib', 'known-marker-partial.js'), 'utf8');
  assert.ok(known.includes("'TASK_TO_HABIT'"), 'ficaria fora de KNOWN_MARKER_NAMES');
  const voice = fs.readFileSync(path.join(__dirname, '..', 'utils', 'shouldSendVoice.js'), 'utf8');
  assert.ok(voice.includes('TASK_TO_HABIT'), 'resposta operacional poderia sair em áudio');
});
