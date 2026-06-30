const test = require('node:test');
const assert = require('node:assert');
const { buildWatcherReminderText } = require('./watcher-cobranca');

test('deadline: cobra o executor, sem mandar o observador fazer', () => {
  const m = buildWatcherReminderText('Gabi', 'Aluno faltoso', 'deadline');
  assert.match(m, /Gabi/);
  assert.match(m, /Aluno faltoso/);
  assert.match(m, /cópia/i);
  assert.doesNotMatch(m, /vc precisa fazer|faça você/i);
});

test('overdue1 escala suave', () => {
  const m = buildWatcherReminderText('Gabi', 'X', 'overdue1');
  assert.match(m, /1 dia/);
});

test('kind desconhecido cai no deadline', () => {
  const m = buildWatcherReminderText('Gabi', 'X', 'zzz');
  assert.match(m, /cópia/i);
});
