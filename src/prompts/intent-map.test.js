// Rodar: node --test src/prompts/intent-map.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const { classifyIntent, LOADOUTS } = require('./intent-map');

test('saudação pura → conversational', () => {
  for (const s of ['fala Tom', 'bom dia', 'oi', 'e aí', 'Coe, Tom! Tudo bem?', 'opa']) {
    assert.strictEqual(classifyIntent(s, []).intent, 'conversational', s);
  }
});

test('agradecimento/reação curta → conversational', () => {
  for (const s of ['valeu', 'vlw Tom', 'show', 'perfeito', 'entendi', 'ok', 'fechou 👍']) {
    assert.strictEqual(classifyIntent(s, []).intent, 'conversational', s);
  }
});

test('vocativo puro / reação pura (núcleo vazio) → conversational', () => {
  // MAPA-VOCATIVE-BARE-MISROUTE: só o nome do bot ("Tom") ou só emoji esvazia o coreText.
  // Sem verbo (ACTION_RE) nem pergunta de dado (DATA_Q_RE), já garantidos antes → é abertura/reação.
  for (const s of ['Tom', 'Tom!', 'Tom?', 'Tom...', '👍', '❤️', 'Tom 👋']) {
    assert.strictEqual(classifyIntent(s, []).intent, 'conversational', s);
  }
});

test('verbo de ação → operational', () => {
  for (const s of ['cria uma tarefa pra amanhã', 'fecha o projeto X', 'me lembra às 15h',
    'reagenda pra sexta', 'delega isso pro Yuri', 'manda pro grupo', 'lista os nomes numerados']) {
    assert.strictEqual(classifyIntent(s, []).intent, 'operational', s);
  }
});

test('pergunta sobre dado → operational', () => {
  for (const s of ['quantas tarefas tenho hoje?', 'cadê meu projeto?', 'qual meu prazo?', 'meus gastos do mês']) {
    assert.strictEqual(classifyIntent(s, []).intent, 'operational', s);
  }
});

test('reply-quote presente → operational (contexto do quote importa)', () => {
  const raw = '[O usuário está RESPONDENDO a esta mensagem anterior: "lista de nomes"]\nfaz isso';
  assert.strictEqual(classifyIntent(raw, []).intent, 'operational');
});

test('texto vazio (mídia/áudio puro) → operational', () => {
  assert.strictEqual(classifyIntent('', []).intent, 'operational');
  assert.strictEqual(classifyIntent(null, []).intent, 'operational');
});

test('afirmação longa/ambígua → operational (conservador)', () => {
  // "essa lista é X" cai em operational por conter sinal ambíguo — MISS SEGURO (sem dano)
  assert.strictEqual(classifyIntent('essa lista aqui é de ciência de dados e tal', []).intent, 'operational');
});

test('loadout casa com a intenção', () => {
  assert.deepStrictEqual(classifyIntent('valeu', []).loadout, LOADOUTS.conversational);
  assert.deepStrictEqual(classifyIntent('cria tarefa', []).loadout, LOADOUTS.operational);
  assert.strictEqual(LOADOUTS.conversational.contextBlocks, 'minimal');
  assert.strictEqual(LOADOUTS.conversational.skill, null);
  assert.strictEqual(LOADOUTS.conversational.decompose, false);
  assert.strictEqual(LOADOUTS.operational.contextBlocks, 'full');
});
