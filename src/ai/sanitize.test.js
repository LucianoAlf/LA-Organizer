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
