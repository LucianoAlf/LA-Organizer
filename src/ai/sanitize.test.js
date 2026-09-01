const { test } = require('node:test');
const assert = require('node:assert');
const { sanitizeOutput } = require('./sanitize');
const golden = require('./__fixtures__/sanitize.golden.json');

test('remove cerca de código inteira', () => {
  assert.strictEqual(sanitizeOutput('antes\n```\nssh tom x\n```\ndepois'), 'antes\n\ndepois');
});

test('remove linha de comando de infra (ssh tom)', () => {
  assert.strictEqual(sanitizeOutput('a\nrode ssh tom "pm2 restart"\nb'), 'a\n\nb');
});

test('remove narração em inglês', () => {
  assert.strictEqual(sanitizeOutput('Now let me update the task\nTarefa criada!'), 'Tarefa criada!');
});

test('preserva texto legítimo do TOM E markers', () => {
  const ok = '✅ Fechado, Fabi! 👽\n\n<<TASK_UPDATE>>\n[{"action":"complete","id":"abc"}]\n<<END>>';
  assert.strictEqual(sanitizeOutput(ok), ok);
});

test('aplica trim no fim', () => {
  assert.strictEqual(sanitizeOutput('  oi  \n\n'), 'oi');
});

test('golden-master: reproduz a cadeia atual do claude.js', () => {
  for (const { input, output } of golden) {
    assert.strictEqual(sanitizeOutput(input), output);
  }
});

// CERCA COMEU A RESPOSTA (01/09) -------------------------------------------
// A regra que apaga blocos de cerca INTEIROS existe pra tirar codigo da resposta ao
// USUARIO. So que o prompt da auditoria pede 'Responda SOMENTE com JSON valido' -- e
// quando o modelo devolve o JSON cercado, o sanitizador apagava a resposta inteira.
// Virava 'result vazio' com subtype=success: o Claude respondia certo e a gente jogava
// fora. Cegou a auditoria por 4 dias (29/08 a 01/09) -- 20 pessoas na ultima noite -- e o
// ciclo relatava 'nada novo' de boa fe, porque zero achado por FALHA e identico a zero
// achado por SAUDE.
// O resgate e ESTREITO de proposito: so dispara quando sanitizar zerou tudo E o conteudo
// desembrulhado tem cara de JSON. Prosa do TOM nunca e JSON, entao a voz dele nao muda.
const BT = String.fromCharCode(96, 96, 96);
const NL = String.fromCharCode(10);

test('JSON cercado sobrevive ao sanitizador (o bug que cegou a auditoria)', () => {
  const cercado = BT + 'json' + NL + '{"findings":[{"category":"dropped_request"}]}' + NL + BT;
  const out = sanitizeOutput(cercado);
  assert.ok(out.startsWith('{'), 'esperava JSON, veio ' + JSON.stringify(out));
  assert.strictEqual(JSON.parse(out).findings[0].category, 'dropped_request');
});

test('array JSON cercado tambem sobrevive', () => {
  const cercado = BT + NL + '[{"a":1}]' + NL + BT;
  assert.deepStrictEqual(JSON.parse(sanitizeOutput(cercado)), [{ a: 1 }]);
});

test('CONTROLE: cerca com CODIGO (nao-JSON) continua apagada -- voz do TOM intacta', () => {
  const cercado = BT + 'bash' + NL + 'pm2 restart tom' + NL + BT;
  assert.strictEqual(sanitizeOutput(cercado), '');
});

test('CONTROLE: prosa com cerca no meio perde so a cerca', () => {
  const t = 'Bora, Alf! Segue:' + NL + NL + BT + 'js' + NL + 'console.log(1)' + NL + BT + NL + NL + 'Qualquer coisa me chama.';
  const out = sanitizeOutput(t);
  assert.ok(out.includes('Bora, Alf!') && out.includes('Qualquer coisa me chama.'));
  assert.ok(!out.includes('console.log'), 'a cerca de codigo tem que sair');
});

test('CONTROLE: tool tags DENTRO da cerca JSON continuam caindo', () => {
  const cercado = BT + 'json' + NL + '{"a":1}<tool_use>x</tool_use>' + NL + BT;
  assert.ok(!sanitizeOutput(cercado).includes('tool_use'));
});

test('CONTROLE: JSON cru (sem cerca) segue passando igual', () => {
  assert.strictEqual(sanitizeOutput('{"a":1}'), '{"a":1}');
});
