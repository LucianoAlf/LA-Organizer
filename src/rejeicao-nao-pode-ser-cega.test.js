'use strict';
// REJEICAO-NAO-PODE-SER-CEGA — teste de contrato + catraca de dívida.
//
// Medido em 07/09 sobre 90 dias de marker_logs: **257 rejeições sem `raw_excerpt`**, em
// **19 tipos de marcador**. Sem o payload, `all_failed:2` não diz QUAL alvo falhou nem por quê —
// e a investigação vira garimpo em log de motor. Foi literalmente o custo do incidente da Barra
// hoje: a rejeição da tarefa da Krissya estava no banco sem uma linha de diagnóstico.
//
// O caminho 1:1 do TASK_UPDATE grava `{actions, fails}` desde 08/07 (caso Leo). Os outros nunca
// ganharam. Neste commit entraram EVENT_CREATE (16 cegas, 6 pessoas) e EVENT_UPDATE (18 cegas).
//
// A DÍVIDA que sobra é explícita: 57 chamadas ainda gravam `'rejected'` com raw `null`. Não vou
// varrer as 57 hoje — mas a catraca abaixo impede que virem 58 em silêncio. Dívida medida e
// travada é dívida; dívida que cresce calada é o que essa casa chama de queijo suíço.

const assert = require('node:assert');
const { test } = require('node:test');
const fs = require('fs');
const path = require('path');

const FONTE = fs.readFileSync(path.join(__dirname, 'engine.js'), 'utf8');

test('EVENT_CREATE grava o payload quando recusa', () => {
  const m = FONTE.match(/logMarker\(collab\.id, 'EVENT_CREATE', result, reason,[\s\S]{0,160}?\);/);
  assert.ok(m, 'nao achei o log de EVENT_CREATE');
  assert.match(m[0], /result === 'rejected' \?/, 'o raw tem que ser condicionado a rejeicao');
  assert.match(m[0], /parsedEv\.actions/, 'sem as actions o registro nao diz o que se tentou');
});

test('EVENT_UPDATE grava o payload E a fala honesta quando recusa', () => {
  const m = FONTE.match(/logMarker\(collab\.id, 'EVENT_UPDATE', result, reason,[\s\S]{0,220}?\);/);
  assert.ok(m, 'nao achei o log de EVENT_UPDATE');
  assert.match(m[0], /result === 'rejected' \?/);
  assert.match(m[0], /parsedEU\.actions/);
  assert.match(m[0], /evFailMessages/, 'aqui existe a mensagem que foi pro usuario — guarde junto');
});

test('sucesso NAO precisa de payload (o raw e para diagnosticar recusa)', () => {
  for (const tipo of ['EVENT_CREATE', 'EVENT_UPDATE']) {
    const m = FONTE.match(new RegExp("logMarker\\(collab\\.id, '" + tipo + "', result, reason,[\\s\\S]{0,220}?\\);"));
    assert.match(m[0], /: null\)/, `${tipo}: no caminho de sucesso o raw deve seguir null`);
  }
});

// ---------------------------------------------------------------------------
// CATRACA. Sobe = alguem gravou uma recusa nova sem diagnostico.
// Desce = alguem pagou divida (atualize o numero e comemore).
// ---------------------------------------------------------------------------
const CEGAS_CONHECIDAS = 57;

test('CATRACA: rejeicao cega nao pode aumentar', () => {
  const n = (FONTE.match(/logMarker\([^;]*'rejected'[^;]*, null\)/g) || []).length;
  assert.ok(n <= CEGAS_CONHECIDAS,
    `subiu de ${CEGAS_CONHECIDAS} para ${n} chamadas que gravam 'rejected' sem payload. `
    + 'Rejeicao sem raw e rejeicao que ninguem consegue diagnosticar depois — passe as actions '
    + '(padrao: { actions, fails }, igual ao TASK_UPDATE).');
  if (n < CEGAS_CONHECIDAS) {
    assert.fail(`caiu para ${n} — alguem pagou divida. Atualize CEGAS_CONHECIDAS para ${n} `
      + 'para a catraca travar no patamar novo.');
  }
});
