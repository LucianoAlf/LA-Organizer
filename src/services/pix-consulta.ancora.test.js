'use strict';
// Âncora de posição/ligação no código (mesmo espírito de pix-cadastro-grupo.ancora.test.js).
// A consulta de lista/número só vale alguma coisa se:
//   1. rodar ANTES do LLM (senão o turno já gastou o `ai.chat` e a lista vira post extra),
//   2. os números chegarem ao prompt (senão o TOM segue chutando quantidade),
//   3. a unidade sair do GRUPO (`la_report_unidade_id`), nunca da fala,
//   4. nenhuma falha de leitura derrubar o turno normal do grupo (try/catch).
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const engine = fs.readFileSync(path.join(__dirname, 'group-chat-engine.js'), 'utf8');
const prompt = fs.readFileSync(path.join(__dirname, 'group-chat-prompt.js'), 'utf8');

test('group-chat-engine.js chama atenderPedidoNoGrupo ANTES de qualquer chamada ao LLM', () => {
  assert.match(engine, /require\('\.\/pix-consulta-fontes'\)/, 'a consulta real, não um stub local');
  // A CHAMADA, não a menção: um comentário citando o nome não prova ordem nenhuma.
  const i = engine.indexOf('await atenderPedidoNoGrupo(');
  const llm = engine.indexOf('ai.chat(');
  assert.ok(i >= 0, 'o engine precisa chamar atenderPedidoNoGrupo');
  assert.ok(llm >= 0);
  assert.ok(i < llm, 'a consulta tem que rodar antes do LLM');
});

test('o bloco de números é passado a buildGroupChatPrompt', () => {
  assert.match(engine, /numerosContext:/, 'o engine precisa passar numerosContext ao prompt');
  const iCalc = engine.indexOf('atenderPedidoNoGrupo');
  const iUso = engine.indexOf('numerosContext:');
  assert.ok(iCalc < iUso, 'os números são lidos antes de virarem prompt');
});

test('a unidade vem do GRUPO (la_report_unidade_id), nunca da fala', () => {
  // Assertiva sobre CÓDIGO, não sobre comentário: responder pela unidade errada num grupo de
  // trabalho é pior que não responder.
  assert.match(engine, /const unidadeId = ctx\.group\.la_report_unidade_id/,
    'a unidade da consulta sai do registro do grupo');
});

test('a leitura inteira está dentro de try/catch — erro nunca derruba o turno do grupo', () => {
  assert.match(engine, /catch \(e\) \{ console\.error\('\[GroupChat\] consulta PIX/,
    'a consulta precisa de um catch próprio, que só loga');
});

test('group-chat-prompt.js declara e renderiza numerosContext, igual a notesContext', () => {
  assert.match(prompt, /function buildGroupChatPrompt\(\{[^}]*numerosContext/s,
    'numerosContext tem que ser parâmetro de buildGroupChatPrompt');
  assert.match(prompt, /\$\{numerosContext \? `\\n\$\{numerosContext\}\\n` : ''\}/,
    'numerosContext tem que ser renderizado no template, no mesmo estilo de notesContext');
});
