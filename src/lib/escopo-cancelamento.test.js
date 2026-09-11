'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { decidirEscopoCancelamento: d, avisoSoOcorrencia } = require('./escopo-cancelamento');

// Literais da Anne, 24/07 (d59121d6) — "Marcar endócrino" é rotina.
test('Anne: "Csncela" + TOM "Tiro todos do sistema" → a rotina inteira', () => {
  assert.deepStrictEqual(d({ pedido: 'Csncela', resposta: 'Cancelado. Tiro todos do sistema.', ehSerie: true }), { escopo: 'series', motivo: 'resposta' });
});
test('Anne: "Sim" confirmando + "✅ Fora do sistema." → a rotina inteira', () => {
  assert.strictEqual(d({ pedido: 'Sim', resposta: '✅ Fora do sistema.', ehSerie: true }).escopo, 'series');
});
test('Anne 23:18: "Pode tirar da lista marcar endocrino" → a rotina inteira pelo pedido', () => {
  assert.deepStrictEqual(d({ pedido: 'Pode tirar da lista marcar endocrino', resposta: 'Cancelado. Sai do sistema agora.', ehSerie: true }), { escopo: 'series', motivo: 'pedido' });
});
test('pedido de uma vez só vence a fala do TOM', () => {
  assert.deepStrictEqual(d({ pedido: 'cancela só a de hoje', resposta: 'Tiro todos', ehSerie: true }), { escopo: 'occurrence', motivo: 'unica' });
  assert.strictEqual(d({ pedido: 'amanhã não vai rolar, cancela', ehSerie: true }).escopo, 'occurrence');
});
test('sem sinal: só a ocorrência (e o engine avisa que a rotina continua)', () => {
  assert.deepStrictEqual(d({ pedido: 'cancela', resposta: 'Cancelado.', ehSerie: true }), { escopo: 'occurrence', motivo: 'padrao' });
});
test('tarefa avulsa nunca vira série; scope do LLM continua valendo', () => {
  assert.deepStrictEqual(d({ pedido: 'tira todos', ehSerie: false }), { escopo: 'occurrence', motivo: 'nao_serie' });
  assert.deepStrictEqual(d({ pedido: 'cancela', ehSerie: true, scopeLLM: 'series' }), { escopo: 'series', motivo: 'llm' });
});
test('aviso diz a data e o que fazer pra parar de vez', () => {
  assert.strictEqual(avisoSoOcorrencia('Marcar endócrino', '2026-07-25'),
    '🔁 Cancelei só a de 25/07 de *Marcar endócrino* — a rotina continua. Se é pra parar de vez, me diz "tira a rotina toda".');
});

const _fs = require('node:fs');
const _p = require('node:path');
const ENG = _fs.readFileSync(_p.join(__dirname, '..', 'engine.js'), 'utf8');
const SYS = _fs.readFileSync(_p.join(__dirname, '..', 'prompts', 'system.js'), 'utf8');
test('engine: o cancelamento decide o alcance pela fala e avisa quando cancela só uma', () => {
  assert.match(ENG, /decidirEscopoCancelamento\(\{ pedido: opts && opts\.inboundText, resposta: opts && opts\.replyText, ehSerie: _ehSerieCan, scopeLLM: a\.scope \}\)/);
  assert.match(ENG, /if \(_escCan\.escopo === 'series'\) a\.scope = 'series';/);
  assert.match(ENG, /if \(_escCan\.motivo === 'padrao'\) groupNotices\.push\(avisoSoOcorrencia\(/);
  assert.match(ENG, /select\('id, title, created_by, assigned_to, recurrence_rule, recurrence_parent_id, due_date'\)/);
  assert.match(ENG, /applyTaskActions\(collab, parsedTask\.actions, \{ inboundText: text, replyText: /);
});
test('prompt: total de lista é resposta, não "adicionei"', () => {
  assert.match(SYS, /NUNCA "adicionei o total"/);
});
