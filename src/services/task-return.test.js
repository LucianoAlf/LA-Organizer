const test = require('node:test');
const assert = require('node:assert');
const { resolveCircleRecipients, buildReturnMessage } = require('./task-return');

test('circle: dedup + remove author + drop null', () => {
  const r = resolveCircleRecipients({ delegatorId: 'D', executorId: 'E', watcherIds: ['W1', 'W2', 'D', null], authorId: 'E' });
  assert.deepEqual([...r].sort(), ['D', 'W1', 'W2']);
});

test('circle: watcher author removed, delegator+executor stay', () => {
  const r = resolveCircleRecipients({ delegatorId: 'D', executorId: 'E', watcherIds: ['W1'], authorId: 'W1' });
  assert.deepEqual([...r].sort(), ['D', 'E']);
});

test('completion msg to delegator with note', () => {
  const m = buildReturnMessage({ kind: 'completion', recipientRole: 'delegator', recipientName: 'Fabi', actorName: 'Gabi', title: 'Aluno novo faltoso', note: 'falei com a mãe' });
  assert.match(m, /Gabi concluiu/);
  assert.match(m, /Aluno novo faltoso/);
  assert.match(m, /você pediu/);
  assert.match(m, /falei com a mãe/);
});

test('completion msg to watcher: "que você acompanha", sem devolutiva quando sem nota', () => {
  const m = buildReturnMessage({ kind: 'completion', recipientRole: 'watcher', recipientName: 'Jereh', actorName: 'Gabi', title: 'X', note: null });
  assert.match(m, /que você acompanha/);
  assert.doesNotMatch(m, /Devolutiva/);
});

test('return (avulsa) msg carrega a nota', () => {
  const m = buildReturnMessage({ kind: 'return', recipientRole: 'delegator', recipientName: 'Fabi', actorName: 'Jereh', title: 'Aluno novo faltoso', note: 'já resolvi, falei com a mãe' });
  assert.match(m, /Jereh deixou um retorno/);
  assert.match(m, /já resolvi/);
});
