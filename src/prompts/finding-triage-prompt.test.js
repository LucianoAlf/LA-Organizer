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

// AUDIT-TRIAGE-TOPIC-MATCH (audit 15/07): o matcher casava por TÓPICO/PALAVRA sem ver o
// SINAL MECÂNICO do bug. Caso Matheus: "continuou cobrando após pedir pra não lembrar hoje"
// (reschedule-confirm-noop, SEM nenhuma rejeição de snooze) casou com SNOOZE-UNTIL-FIELD-
// ALIAS-REJECT só porque ambos falam de "lembrete" → 6ª [REGRESSÃO] falsa seguida.
// Fix: passar sinal_padrao ao matcher + exigir aterramento no sinal mecânico.
test('SYSTEM: exige aterrar no SINAL MECÂNICO — semelhança de tópico não basta', () => {
  assert.match(SYSTEM, /sinal|mecân/i);
  assert.match(SYSTEM, /tópico|palavra|não basta|sozinh|semelhança/i);
});

test('buildMatchMessages: injeta o sinal_padrao do known-issue (aterramento mecânico)', () => {
  const { messages } = buildMatchMessages(
    [{ id: 'f1', category: 'reminder', summary: 'continuou cobrando após pedir pra não lembrar hoje',
       evidence: 'TOM cobrou 4x às 16h; nenhuma rejeição de snooze no log' }],
    [{ codigo: 'SNZ', titulo: 'snooze rejeitado', area: 'marker', causa_raiz: 'alias',
       sinal_padrao: 'snooze_reminders retorna snooze_needs_not_before_or_clear_all', corrigido_em: '2026-07-08T00:00:00Z' }],
  );
  const userText = messages.map(m => m.content).join('\n');
  assert.match(userText, /snooze_needs_not_before_or_clear_all/);
});

test('buildMatchMessages: known-issue sem sinal_padrao não quebra', () => {
  const { messages } = buildMatchMessages(
    [{ id: 'f1', category: 'x', summary: 's', evidence: 'e' }],
    [{ codigo: 'BUG-1', titulo: 't', area: 'marker', causa_raiz: 'c', corrigido_em: '2026-06-10T00:00:00Z' }],
  );
  const userText = messages.map(m => m.content).join('\n');
  assert.match(userText, /BUG-1/);
});
