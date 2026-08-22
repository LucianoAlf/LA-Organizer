const { test } = require('node:test');
const assert = require('node:assert');
const { judgeShadow, parseVeredito, buildJudgePrompt } = require('./shadow-judge');

const transcript = { turns: [{ userText: 'me lembra todo dia de X', reply: '✅ lembrete diário ativado', markers: ['PREFS_UPDATE:executed'], persisted: { habito: null } }] };

test('parseVeredito lê o JSON do judge e normaliza', () => {
  assert.deepStrictEqual(parseVeredito('{"verdict":"reprovado","reason":"confabulou"}'), { verdict: 'reprovado', reason: 'confabulou' });
});
test('parseVeredito degrada pra inconclusivo em lixo', () => {
  assert.strictEqual(parseVeredito('bla bla').verdict, 'inconclusivo');
  assert.strictEqual(parseVeredito('{"verdict":"talvez"}').verdict, 'inconclusivo');
});
test('buildJudgePrompt inclui o bug, a intenção do fix e o transcript', () => {
  const p = buildJudgePrompt({ finding: { summary: 'confab X' }, fixIntent: 'não afirmar sem persistir', transcript });
  assert.match(p, /confab X/); assert.match(p, /não afirmar sem persistir/); assert.match(p, /PREFS_UPDATE/);
});
test('judgeShadow devolve o veredito do chat (Codex mockado)', async () => {
  const chat = async () => '{"verdict":"reprovado","reason":"disse lembrete ativado sem persistir"}';
  const r = await judgeShadow({ finding: { summary: 'x' }, fixIntent: 'y', transcript }, { chat });
  assert.strictEqual(r.verdict, 'reprovado');
});
test('erro no chat → inconclusivo (freio-mestre)', async () => {
  const chat = async () => { throw new Error('codex down'); };
  const r = await judgeShadow({ finding: { summary: 'x' }, fixIntent: 'y', transcript }, { chat });
  assert.strictEqual(r.verdict, 'inconclusivo');
});
