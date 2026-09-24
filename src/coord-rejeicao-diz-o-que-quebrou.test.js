'use strict';
// COORD-REJEICAO-DIZ-O-QUE-QUEBROU — recusa de recado tem que dizer O QUE quebrou.
//
// Medido em 24/09 sobre a história inteira de `marker_logs` (03/05 → 22/09): 47 rejeições de
// COORDINATION_REQUEST e **47 sem `raw_excerpt`** — nenhuma exceção em cinco meses. 32 delas são
// `schema_invalid`. O diagnóstico não é caro de produzir: o parser já acumula `reasons`, e o
// engine já imprime tudo num `console.warn` UMA LINHA ACIMA do `logMarker` que grava `null`.
//
// O custo apareceu nesta mesma rodada: as duas rejeições frescas (Duda 21/09 17:09:49 e Ramon
// 22/09 01:04:51 BRT) são irreproduzíveis. `schema_invalid` não diz qual campo o LLM errou nem
// com que valor — então não dá pra separar drift de prompt, alias novo e `mode` inventado.
//
// E `reasons` sozinho não basta: ele diz `marker[0]:mode`, o NOME do campo. Quem investiga
// precisa do VALOR emitido ("avisar", "lembrete"...) pra decidir se vira alias ou se é o prompt
// que envelheceu. Por isso o bloco cru vai junto.
//
// Mesma dívida que TASK_UPDATE pagou em 08/07 e EVENT_CREATE/EVENT_UPDATE em 07/09
// (ver `rejeicao-nao-pode-ser-cega.test.js`). Porta nova, mecanismo velho.

const assert = require('node:assert');
const { test } = require('node:test');
const fs = require('fs');
const path = require('path');

const { parseCoordinationRequestMarker } = require('./engine');

const bloco = (json) => `<<COORDINATION_REQUEST>>\n${json}\n<<END>>`;

test('CONTROLE: marcador bem formado continua virando item (a chamada está sã)', () => {
  const r = parseCoordinationRequestMarker(
    'Mando sim.\n' + bloco('{"recipient_name":"Rafinha","mode":"relay_literal","message_body":"chegou o material"}'),
  );
  assert.ok(r && Array.isArray(r.items), 'era pra ter items');
  assert.strictEqual(r.items.length, 1);
  assert.strictEqual(r.items[0].recipient_name, 'Rafinha');
});

test('o retorno malformado carrega o BLOCO emitido, não só o nome do campo', () => {
  const r = parseCoordinationRequestMarker(
    bloco('{"recipient_name":"Duda","mode":"avisar","message_body":"passa na sala 3"}'),
  );
  assert.strictEqual(r.malformed, true);
  assert.ok(r.reasons.some((x) => /mode/.test(x)), 'reasons devia apontar o campo mode');

  assert.ok(Array.isArray(r.blocks), 'sem `blocks` o log grava só "schema_invalid" e a recusa fica cega');
  assert.strictEqual(r.blocks.length, 1);
  assert.match(r.blocks[0], /"mode":"avisar"/,
    'o valor que o LLM inventou é o único dado que diz se vira alias ou se o prompt envelheceu');
});

test('JSON quebrado também preserva o bloco (é a rejeição mais opaca de todas)', () => {
  const r = parseCoordinationRequestMarker(bloco('{"recipient_name":"Ramon", "mode":'));
  assert.strictEqual(r.malformed, true);
  assert.ok(r.reasons.some((x) => /invalid_json/.test(x)));
  assert.match(r.blocks[0], /Ramon/);
});

test('caso Jereh (22/05): N marcadores malformados preservam os N blocos', () => {
  const r = parseCoordinationRequestMarker(
    bloco('{"recipient_name":"Yuri","mode":"aviso","message_body":"a"}')
    + '\n'
    + bloco('{"mode":"relay_literal","message_body":"b"}'),
  );
  assert.strictEqual(r.malformed, true);
  assert.strictEqual(r.blocks.length, 2, 'perder um bloco é perder um destinatário do diagnóstico');
});

// ---------------------------------------------------------------------------
// Contrato de fonte: o site de log não pode voltar a gravar `null`.
// ---------------------------------------------------------------------------
const FONTE = fs.readFileSync(path.join(__dirname, 'engine.js'), 'utf8');

test('o logMarker de schema_invalid grava o payload, não null', () => {
  const m = FONTE.match(
    /logMarker\(collab\.id, 'COORDINATION_REQUEST', 'rejected', 'schema_invalid',[\s\S]{0,260}?\);/,
  );
  assert.ok(m, 'nao achei o log de schema_invalid do COORDINATION_REQUEST');
  assert.doesNotMatch(m[0], /,\s*null\s*\)/, 'rejeicao sem raw e rejeicao que ninguem diagnostica depois');
  assert.match(m[0], /reasons/);
  assert.match(m[0], /blocks/);
  assert.match(m[0], /rawLimit/,
    'bloco cortado no meio do JSON parece dado e nao e — veja o cabecalho do logMarker');
});
