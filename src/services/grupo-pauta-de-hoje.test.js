'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { pautaDeHojeParaOGrupo, _limparCache } = require('./pauta-dm');
const situ = require('./situacao-aluno');

const BARRA = situ.resolverUnidade('barra');
const aluno = (nome, hora) => ({ nome, aluno_nome: nome, nome_aluno: nome, hora, horario: hora });

test('Barra 03/10: "alunos de hoje sem anamnese" → a pauta do dia, não a unidade inteira', async () => {
  _limparCache();
  const deps = { pendenciasDoDia: async () => ({ anamnese: [aluno('Giovani Breda Silva', '08:00')], contrato: [], totalUnidade: { anamnese: 53, contrato: 53, alunos: 265 }, motivo: null }) };
  const r = await pautaDeHojeParaOGrupo({ laReport: {}, unidadeId: BARRA, hoje: '2026-10-03', recorte: 'anamnese', deps });
  assert.strictEqual(r.motivo, null);
  assert.match(r.texto, /Pauta de hoje — Barra \(03\/10\)/);
  assert.match(r.texto, /1 aluno sem anamnese/);
  assert.doesNotMatch(r.texto, /53/);
  assert.doesNotMatch(r.texto, /Contrato/);
});
test('fonte caiu: diz que não leu, nunca número', async () => {
  _limparCache();
  const deps = { pendenciasDoDia: async () => ({ anamnese: null, contrato: null, totalUnidade: null, motivo: 'timeout' }) };
  const r = await pautaDeHojeParaOGrupo({ laReport: {}, unidadeId: BARRA, hoje: '2026-10-03', recorte: 'anamnese', deps });
  assert.strictEqual(r.motivo, 'timeout');
  assert.match(r.texto, /Não consegui ler a fonte/);
});
test('fiação: o motor do grupo atende "hoje":true e o prompt ensina o campo', () => {
  const eng = fs.readFileSync(path.join(__dirname, 'group-chat-engine.js'), 'utf8');
  assert.match(eng, /p\.hoje === true/);
  assert.match(eng, /pautaDeHojeParaOGrupo/);
  assert.match(eng, /const listasPix = \[\.\.\.pautasDeHoje\]/);
  const pr = fs.readFileSync(path.join(__dirname, 'group-chat-prompt.js'), 'utf8');
  assert.match(pr, /"hoje":true = só quem tem AULA HOJE/);
  assert.match(pr, /NUNCA diga que a lista está no painel em vez de emitir o marker/);
});
