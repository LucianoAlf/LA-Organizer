'use strict';
// LISTA-TRABALHO-ROUTING (Rafinha, 17/08 12:44 BRT — áudio transcrito).
//
// "Então, coloca no checklist aí, telão de LED finalizado, ok? Tudo certo pra sexta-feira."
// A capacidade de lista pessoal EXISTE e é muito usada (18 listas, 12 de trabalho; Rafinha tem 6).
// Mas o gatilho do roteador (pickSkill priority 4.9) só disparava em tópico de vida PESSOAL
// (mercado/viagem/remédios). Checklist de TRABALHO — "telão de LED", "manutenção", "contrabaixo" —
// não casava nada → a skill `listas-pessoais` nunca carregava → o LLM improvisava → chokepoint
// "não consegui registrar isso agora — me manda de novo" (beco).
//
// Fix: gatilho de ADIÇÃO EXPLÍCITA (verbo de acréscimo + direcional + "lista/checklist/listagem"),
// independente de tópico. Medido: 8 rotas net-new em 2,5 meses de produção, todas adição real;
// nenhuma é retrieve ("manda a lista"), nenhuma perde skill.

const test = require('node:test');
const assert = require('node:assert');
const { pickSkill } = require('./system');

const RAFINHA = { id: '00000000-0000-0000-0000-000000000002', full_name: 'Rafinha', role: 'collaborator' };

test('coloca no checklist de TRABALHO (telão de LED) carrega listas-pessoais — caso Rafinha 17/08', async () => {
  const skill = await pickSkill(RAFINHA, 'Então, coloca no checklist aí, telão de LED finalizado, ok? Tudo certo pra sexta-feira.', []);
  assert.strictEqual(skill && skill.name, 'listas-pessoais');
});

test('adiciona na minha lista (consertar contrabaixo) → listas-pessoais', async () => {
  const skill = await pickSkill(RAFINHA, 'coloca na minha lista aí, consertar a caixa de contrabaixo do estúdio', []);
  assert.strictEqual(skill && skill.name, 'listas-pessoais');
});

test('acrescenta na lista → listas-pessoais', async () => {
  const skill = await pickSkill(RAFINHA, 'Isso. Coloca o Merodaque na lista por favor', []);
  assert.strictEqual(skill && skill.name, 'listas-pessoais');
});

// ANTI-OVERFIT: "manda/reenvia a lista" é RETRIEVE (consulta de agenda), verbo de ENVIO, não de
// adição — NÃO pode ser roubado pelo listas-pessoais.
test('retrieve "me manda a lista das tarefas" NÃO vira listas-pessoais', async () => {
  const skill = await pickSkill(RAFINHA, 'Me manda a lista das tarefas de amanhã', []);
  assert.notStrictEqual(skill && skill.name, 'listas-pessoais');
});

test('retrieve "me reenvia como ficou a lista" NÃO vira listas-pessoais', async () => {
  const skill = await pickSkill(RAFINHA, 'me reenvia como ficou a lista, não esquece dos emojis', []);
  assert.notStrictEqual(skill && skill.name, 'listas-pessoais');
});

// LISTA-TRABALHO-ROUTING-AUDIO (re-audit 20/08). O fix de 18/08 passava com a frase LIMPA,
// mas a mensagem REAL chega com "[áudio transcrito]" e o short-circuit tratamento-audio
// (pickSkill priority 1.4) roubava o turno ANTES do roteador de listas (4.9). Estes casos
// rodam pickSkill de ponta a ponta com o prefixo real — a prova que faltava em 18/08.
test('AUDIO REAL: "[áudio transcrito] coloca no checklist telão de LED" → listas-pessoais', async () => {
  const real = '[áudio transcrito] Então, coloca no checklist aí, telão de LED finalizado, ok? Tudo certo pra sexta-feira.';
  const skill = await pickSkill(RAFINHA, real, []);
  assert.strictEqual(skill && skill.name, 'listas-pessoais');
});

test('AUDIO: "[áudio transcrito] coloca na minha lista consertar contrabaixo" → listas-pessoais', async () => {
  const skill = await pickSkill(RAFINHA, '[áudio transcrito] coloca na minha lista aí, consertar a caixa de contrabaixo do estúdio', []);
  assert.strictEqual(skill && skill.name, 'listas-pessoais');
});

test('AUDIO anti-overfit: "[áudio transcrito] me reenvia a lista" NÃO vira listas-pessoais (retrieve)', async () => {
  const skill = await pickSkill(RAFINHA, '[áudio transcrito] me reenvia como ficou a lista, não esquece dos emojis', []);
  assert.notStrictEqual(skill && skill.name, 'listas-pessoais');
});

test('AUDIO sem adição de lista continua indo pro tratamento-audio', async () => {
  const skill = await pickSkill(RAFINHA, '[áudio transcrito] terminei a manutenção do palco, tudo certo', []);
  assert.strictEqual(skill && skill.name, 'tratamento-audio');
});
