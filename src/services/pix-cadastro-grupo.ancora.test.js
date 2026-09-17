'use strict';
// Âncora de posição no código (mesmo espírito de conversation-audit.ancora.test.js): o atalho de
// cadastro informado do PIX (Tarefa 7) só vale alguma coisa se rodar ANTES da chamada ao LLM —
// senão o turno já gastou o `ai.chat` e o atalho vira só um post extra. Este teste lê o próprio
// código-fonte de group-chat-engine.js e prova a ORDEM: um mutante que mova a chamada de
// `tratarCadastroInformadoNoGrupo` pra depois de `ai.chat(` tem que quebrar este teste.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, 'group-chat-engine.js'), 'utf8');

test('group-chat-engine.js chama tratarCadastroInformadoNoGrupo ANTES de qualquer chamada ao LLM (ai.chat)', () => {
  const idxAtalho = src.indexOf('tratarCadastroInformadoNoGrupo');
  const idxLLM = src.indexOf('ai.chat(');
  assert.ok(idxAtalho >= 0, 'group-chat-engine.js precisa chamar tratarCadastroInformadoNoGrupo');
  assert.ok(idxLLM >= 0, 'group-chat-engine.js precisa chamar ai.chat(...)');
  assert.ok(idxAtalho < idxLLM, 'o atalho de cadastro informado tem que rodar antes da chamada ao LLM');
});
