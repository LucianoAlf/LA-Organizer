// src/prompts/finding-triage-prompt.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const { SYSTEM, buildMatchMessages } = require('./finding-triage-prompt');

test('SYSTEM: exige JSON, proíbe inventar código e foca em causa-raiz', () => {
  assert.match(SYSTEM, /JSON/);
  assert.match(SYSTEM, /matched_code/);
  assert.match(SYSTEM, /causa-raiz|mesmo problema/i);
});
test('buildMatchMessages: injeta findings (id) e known-issues (codigo)', () => {
  const { system, messages } = buildMatchMessages(
    [{ id: 'f1', category: 'confabulation', summary: 'negou salvar', evidence: 'TOM: não salvei' }],
    [{ codigo: 'BUG-1', titulo: 'salvar falhava', area: 'marker', causa_raiz: 'x', fix_resumo: 'y', corrigido_em: '2026-06-10T00:00:00Z' }],
  );
  assert.ok(system.length > 0);
  const userText = messages.map(m => m.content).join('\n');
  assert.match(userText, /f1/);
  assert.match(userText, /BUG-1/);
});
