'use strict';
// Âncora de posição (mesmo espírito de pix-cadastro-grupo.ancora.test.js): o PIX no 1:1 (Ana Paula,
// DM 05/10) só vale se cada peça rodar no lugar certo do processMessage. Lê o próprio engine.js e
// prova a ORDEM — um mutante que mova qualquer peça pro lugar errado quebra aqui.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '..', 'engine.js'), 'utf8');
const ini = src.indexOf('async function processMessage(');
const fim = src.indexOf('async function sendRitual(');
const pm = src.slice(ini, fim);
const idx = (s) => { const i = pm.indexOf(s); assert.ok(i >= 0, `processMessage precisa de: ${s}`); return i; };

test('o aviso de quem já foi do PIX é resolvido ANTES do prompt e do LLM', () => {
  assert.ok(idx('resolverPixDoTurno(') < idx('await buildSystemPrompt(collab, _promptOpts)'));
  assert.ok(idx('resolverPixDoTurno(') < idx('let reply = response.text'));
});

test('o TASK_UPDATE em tarefa do PIX sai do marcador ANTES de o marcador executar', () => {
  assert.ok(idx('tirarConclusaoDePix(reply)') < idx('let parsedTask = parseTaskUpdateMarker(reply)'));
});

test('a lista numerada (<<LISTA_PIX>>) e o resultado do aviso entram ANTES do catch-all e do chokepoint', () => {
  const lista = idx('atenderMarkersListaPixDM(');
  assert.ok(lista < idx('<<SITUACAO_ALUNO>> no 1:1'));
  assert.ok(idx('_pixDmResultado.linhas.join') < idx('CONFAB-NOMARKER-CHOKEPOINT (Camada 1)'));
});

test('a numeração mora em pix_dm_numeracao: nada de PIX_LISTA_DM no marker_logs nem no engine', () => {
  assert.ok(!src.includes('PIX_LISTA_DM'), 'engine.js não conhece mais o marcador provisório');
  const num = fs.readFileSync(path.join(__dirname, 'pix-dm-numeracao.js'), 'utf8');
  assert.ok(num.includes("const TABELA = 'pix_dm_numeracao'"));
  assert.ok(!/from\(\s*'marker_logs'/.test(num));
});

test('a fala DELA decide pauta x lista completa, e as partes seguintes saem DEPOIS do reply', () => {
  assert.ok(pm.includes('textoDoUsuario: text'), 'atenderMarkersListaPixDM recebe a fala da pessoa');
  assert.ok(idx('const _sent = await whatsapp.sendMessage(phone, reply)') < idx('for (const _parte of _pixDmExtras)'));
});
