'use strict';
// citacao-nao-e-afirmacao.test.js — texto ENTRE ASPAS é rascunho/recado/citação, não fala do TOM
// sobre a própria escrita (03/10/2026). Rodar: node --test src/lib/citacao-nao-e-afirmacao.test.js
//
// Caso real (Clayton, Recreio, 25/09 16:06 UTC — marker_logs CHOKEPOINT confab:promise_nomarker):
// o TOM propôs um recado pro Luciano, entre _"…"_, e o "lembrete às 20h30" DENTRO do rascunho casou
// a REPLY_PROMISE_RE. A porta de cima apagou a 1ª metade do recado (o corte por frase partiu a
// citação no ponto final de dentro dela) e deixou um `"_` solto. Texto byte a byte do raw_excerpt.
const { test } = require('node:test');
const assert = require('node:assert');
const { decidirPromessaSemMarcador, PROMISE_NOMARKER_DISCLAIMER } = require('./promise-honesty');
const { vetoDePergunta, mascararCitacoes } = require('./veto-pergunta');
const { hasCompletionClaim, hasWeakCompletionClaim } = require('./optimistic-confirm');

const CLAYTON_2509 = '🤔 Clayton, é que eu tinha proposto avisar o Luciano sobre o erro e ficou esperando seu ok.\n\nO recado seria: _"Luciano, o Clayton tentou criar uma tarefa diária pra Vitoria (Recreio), com lembrete às 20h30 de segunda a sexta pra avisar no grupo Salas OK. O TOM deu erro técnico ao gravar, várias vezes, e a tarefa não foi criada."_\n\nMando pro Luciano? *Sim* ou *não*. Enquanto isso, a tarefa da Vitoria continua sem criar.';

const acusaEmBaixo = (f) => !!(hasCompletionClaim(f) || hasWeakCompletionClaim(f));

test('Clayton 25/09: o "lembrete às 20h30" do RASCUNHO não é promessa do TOM — intocado', () => {
  const r = decidirPromessaSemMarcador(CLAYTON_2509, {});
  assert.strictEqual(r.fired, false);
  assert.strictEqual(r.reply, CLAYTON_2509);
});

test('negativo: afirmação FORA das aspas na mesma fala segue caindo, e a citação sai inteira', () => {
  const t = 'Registrei a tarefa da Vitoria. O recado pro Luciano fica: _"Luciano, lembrete às 20h30 de segunda a sexta. Tarefa criada."_';
  const r = decidirPromessaSemMarcador(t, {});
  assert.strictEqual(r.fired, true, 'o "Registrei" está fora das aspas — é fala do TOM');
  assert.strictEqual(r.reply, 'O recado pro Luciano fica: _"Luciano, lembrete às 20h30 de segunda a sexta. Tarefa criada."_\n\n' + PROMISE_NOMARKER_DISCLAIMER);
});

test('negativo: afirmação e citação na MESMA frase — sai a frase inteira, nunca meia citação', () => {
  const r = decidirPromessaSemMarcador('Anotei o pedido "trocar lâmpada. Depois o bistrô".', {});
  assert.strictEqual(r.fired, true);
  assert.strictEqual(r.reply, PROMISE_NOMARKER_DISCLAIMER);
});

test('sem aspas, nada muda (byte a byte com o comportamento anterior)', () => {
  const t = 'Beleza, anotado! A Mayra segue com isso pra amanhã.';
  const r = decidirPromessaSemMarcador(t, {});
  assert.strictEqual(r.fired, true);
  assert.strictEqual(r.reply, 'A Mayra segue com isso pra amanhã.\n\n' + PROMISE_NOMARKER_DISCLAIMER);
});

test('mascararCitacoes: preserva o tamanho, mascara só o miolo de aspas FECHADAS', () => {
  for (const [abre, fecha] of [['"', '"'], ['“', '”'], ['«', '»']]) {
    const t = `Recado: ${abre}Registrei. Tudo ok?${fecha} fim.`;
    const m = mascararCitacoes(t);
    assert.strictEqual(m.length, t.length);
    assert.ok(!/[\p{L}.?!]/u.test(m.slice(9, m.length - 6)), `miolo mascarado: ${m}`);
    assert.ok(m.startsWith('Recado: ' + abre) && m.endsWith(fecha + ' fim.'));
  }
  // aspa aberta e nunca fechada (excerpt cortado, polegada) não vira citação
  assert.strictEqual(mascararCitacoes('Registrei o cabo de 10" hoje.'), 'Registrei o cabo de 10" hoje.');
  // aspas atravessando linha: a quebra de dentro some da máscara, o tamanho fica
  const ml = 'Texto pro grupo:\n"Registrei a tarefa.\nTudo certo."';
  assert.strictEqual(mascararCitacoes(ml).length, ml.length);
  assert.strictEqual(mascararCitacoes(ml).split('\n').length, 2);
});

test('porta de baixo: claim só DENTRO de aspas é vetado; claim fora segue acusado', () => {
  const dentro = 'Texto pro grupo:\n"Registrei a tarefa da Vitoria, lembrete às 20h30."';
  assert.strictEqual(acusaEmBaixo(dentro), true, 'pré-condição: o detector (congelado) acusa o rascunho');
  const v = vetoDePergunta(dentro, { ehAcusada: acusaEmBaixo });
  assert.strictEqual(v.veto, true);
  assert.strictEqual(v.motivo, 'citacao');
  const fora = 'Registrei a tarefa. Texto pro grupo: "lembrete às 20h30"';
  assert.strictEqual(vetoDePergunta(fora, { ehAcusada: acusaEmBaixo }).veto, false);
  const sugestao = 'Sugestão de texto pro grupo: "✅ Tarefa criada pra Vitoria, lembrete às 20h30."';
  assert.strictEqual(acusaEmBaixo(sugestao), true, 'pré-condição');
  assert.strictEqual(vetoDePergunta(sugestao, { ehAcusada: acusaEmBaixo }).veto, true);
});

test('grupo: a porta do grupo usa a mesma régua (aspas e pergunta)', () => {
  const { buildTomContent } = require('../services/group-chat-engine');
  const { NO_MARKER_HONEST_NOTE } = require('./optimistic-confirm');
  const rascunho = 'Sugestão de texto pro grupo: "✅ Tarefa criada pra Vitoria, lembrete às 20h30."';
  assert.strictEqual(buildTomContent(rascunho, []), rascunho, 'rascunho entre aspas não é escrita do TOM');
  const mentira = 'Registrei a tarefa da Vitoria. Texto pro grupo: "lembrete às 20h30"';
  assert.ok(String(buildTomContent(mentira, [])).includes(NO_MARKER_HONEST_NOTE), 'afirmação fora das aspas segue acusada no grupo');
  const fs = require('fs');
  const src = fs.readFileSync(require('path').join(__dirname, '..', 'services', 'group-chat-engine.js'), 'utf8');
  assert.ok(src.includes("require('../lib/veto-pergunta')"));
  assert.ok(/\|\| vetoDePergunta\(prose, \{ ehAcusada: [^\n]*\}\)\.veto/.test(src));
});

test('grupo: o sensor guarda a fala ORIGINAL (raw_excerpt) — sem ela o replay é cego', () => {
  const { buildTomContent } = require('../services/group-chat-engine');
  let visto = null;
  buildTomContent('Registrei a tarefa da Vitoria.', [], { onChokepoint: (antes) => { visto = antes; } });
  assert.strictEqual(visto, 'Registrei a tarefa da Vitoria.');
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'services', 'group-chat-engine.js'), 'utf8');
  assert.ok(/reason: `grupo_claim_sem_marker: \$\{groupId\}`\.slice\(0, 120\),\s*\n\s*raw_excerpt:/.test(src), 'o CONFAB do grupo grava raw_excerpt');
});
