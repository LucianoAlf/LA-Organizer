const { test } = require('node:test');
const assert = require('node:assert');
const { judgeShadow, parseVeredito, buildJudgePrompt, ehPedidoDeConfirmacao } = require('./shadow-judge');

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
  const chat = async () => ({ text: '{"verdict":"reprovado","reason":"disse lembrete ativado sem persistir"}', provider: 'openai' });
  const r = await judgeShadow({ finding: { summary: 'x' }, fixIntent: 'y', transcript }, { chat });
  assert.strictEqual(r.verdict, 'reprovado');
});
test('erro no chat → inconclusivo (freio-mestre)', async () => {
  const chat = async () => { throw new Error('codex down'); };
  const r = await judgeShadow({ finding: { summary: 'x' }, fixIntent: 'y', transcript }, { chat });
  assert.strictEqual(r.verdict, 'inconclusivo');
});

// REGRESSÃO (prova viva 22/08): ai/openai.chat devolve { text, provider }, não string. O judge
// tem que ler .text — senão vira "[object Object]" → inconclusivo sempre (judge inútil).
test('judgeShadow lê o .text do retorno do chat (shape real do openai/provider)', async () => {
  const chat = async () => ({ text: '{"verdict":"aprovado","reason":"cordial, sem ação falsa"}', provider: 'openai' });
  const r = await judgeShadow({ finding: { summary: 'x' }, fixIntent: 'y', transcript: { turns: [] } }, { chat });
  assert.strictEqual(r.verdict, 'aprovado');
});

// GUARDA (prova viva 23/08): a sombra roda 1 turno e nunca manda o "sim". Ação confirmável
// morre no "Vou criar… Confirma?" sem persistir → judge reprova → reabre finding CORRETO.
// reprovado só sobrevive se NÃO for mero pedido de confirmação.
test('reprovado vira inconclusivo quando o turno é só pedido de confirmação (proposta)', async () => {
  const chat = async () => ({ text: '{"verdict":"reprovado","reason":"disse que ia criar"}', provider: 'openai' });
  const t = { turns: [{ userText: 'cria tarefa X e me lembra todo dia', reply: 'Vou criar UMA tarefa recorrente X, todo dia. Confirma?', markers: [], persisted: {} }] };
  const r = await judgeShadow({ finding: { summary: 'x' }, fixIntent: 'y', transcript: t }, { chat });
  assert.strictEqual(r.verdict, 'inconclusivo');
});
test('claim de ação EXECUTADA (sem pergunta) permanece reprovado', async () => {
  const chat = async () => ({ text: '{"verdict":"reprovado","reason":"disse que criou sem persistir"}', provider: 'openai' });
  const t = { turns: [{ userText: 'cria tarefa X', reply: '✅ Criei a tarefa X e ativei o lembrete diário!', markers: [], persisted: {} }] };
  const r = await judgeShadow({ finding: { summary: 'x' }, fixIntent: 'y', transcript: t }, { chat });
  assert.strictEqual(r.verdict, 'reprovado');
});
test('a guarda NÃO afrouxa aprovado (só desarma reprovado)', async () => {
  const chat = async () => ({ text: '{"verdict":"aprovado","reason":"ok"}', provider: 'openai' });
  const t = { turns: [{ userText: 'x', reply: 'Posso criar a tarefa? Confirma?', markers: [], persisted: {} }] };
  const r = await judgeShadow({ finding: { summary: 'x' }, fixIntent: 'y', transcript: t }, { chat });
  assert.strictEqual(r.verdict, 'aprovado');
});
test('ehPedidoDeConfirmacao só bate em pergunta de permissão, não em claim executado', () => {
  assert.ok(ehPedidoDeConfirmacao('Vou criar X. Confirma?'));
  assert.ok(ehPedidoDeConfirmacao('Posso agendar a reunião?'));
  assert.ok(!ehPedidoDeConfirmacao('✅ Criei a tarefa X!'));
  assert.ok(!ehPedidoDeConfirmacao('lembrete diário ativado'));
});
