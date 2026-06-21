const { test } = require('node:test');
const assert = require('node:assert');
const { buildUserPrompt } = require('./prompt');

test('com histórico: embrulha "Conversa recente" + "Mensagem atual"', () => {
  const msgs = [
    { role: 'user', content: 'oi' },
    { role: 'assistant', content: 'Olá! 👽' },
    { role: 'user', content: 'cria tarefa X' },
  ];
  assert.strictEqual(
    buildUserPrompt(msgs),
    'Conversa recente:\nUsuário: oi\nTOM: Olá! 👽\n\nMensagem atual do usuário:\ncria tarefa X'
  );
});

test('sem histórico (1 msg): retorna só a mensagem', () => {
  assert.strictEqual(buildUserPrompt([{ role: 'user', content: 'oi' }]), 'oi');
});

test('array vazio: string vazia', () => {
  assert.strictEqual(buildUserPrompt([]), '');
});
