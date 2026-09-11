'use strict';
// CONSULTA-REPETE-PAINEL (triagem 11/09 — 07591221, 724688d2, 72f7e752).
const { test } = require('node:test');
const assert = require('node:assert');
const { montarRespostaDeConsulta } = require('./resposta-consulta');

const PAINEL = '💳 *Latam PASS · fatura de agosto*\n━━━━━━━━━━━━━━━\n💰 Fatura atual: *R$ 5.701,40*\n📊 Limite: [██░░░░░░░░] 16%';

test('primeiro painel sai do banco, como hoje (a prosa do LLM não entra)', () => {
  const r = montarRespostaDeConsulta({ textoDoTom: 'Sua fatura está em R$ 9.999', paineis: [PAINEL], recentes: [] });
  assert.deepStrictEqual(r, { texto: PAINEL, repetidos: 0 });
});
test('Rose 11/08: o mesmo painel de minutos atrás NÃO sai de novo — vai a resposta à pergunta', () => {
  const prosa = 'A diferença é R$ 143,80: a tela soma R$ 5.701,40 e o PDF lançado R$ 5.557,60.';
  const r = montarRespostaDeConsulta({ textoDoTom: prosa, paineis: [PAINEL], recentes: ['Oi', PAINEL] });
  assert.deepStrictEqual(r, { texto: prosa, repetidos: 1 });
});
test('painel repetido sem prosa útil → pergunta honesta, nunca o painel de novo', () => {
  const r = montarRespostaDeConsulta({ textoDoTom: 'Olha aí:', paineis: [PAINEL], recentes: [PAINEL.replace(/\n/g, '\n ')] });
  assert.strictEqual(r.repetidos, 1);
  assert.match(r.texto, /mesmo painel que te mandei agora há pouco/);
});
test('dois painéis, um repetido: sai só o novo', () => {
  const outro = '💳 *Nubank · fatura de agosto*\n💰 Fatura atual: *R$ 812,00*';
  assert.deepStrictEqual(montarRespostaDeConsulta({ textoDoTom: '', paineis: [PAINEL, outro], recentes: [PAINEL] }), { texto: outro, repetidos: 1 });
});

const ENG = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'engine.js'), 'utf8');
test('engine: consulta financeira passa pelo montarRespostaDeConsulta com os outbound recentes', () => {
  assert.match(ENG, /montarRespostaDeConsulta\(\{ textoDoTom: finParsed\.cleanText, paineis: finReplies, recentes:/);
  assert.match(ENG, /finParsed\.actions\.every\(\(a\) => _FIN_READ\.has\(a\.action\)\)/);
});
