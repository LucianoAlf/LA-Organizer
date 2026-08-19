// src/lib/reminder-lead-label.test.js
// Rodar: node --test src/lib/reminder-lead-label.test.js
//
// EVENT-REMINDER-DUPLO-SEM-ETIQUETA (Alf 19/08) — o evento pode ter DOIS lembretes de
// propósito (2h antes e 1h antes; caso "Reunião MKT - NBG!", event_reminders criados juntos
// no reschedule do app). Como o template só usava `label` (null nos dois), as duas mensagens
// saíam BYTE-IDÊNTICAS — pro usuário parece bug/duplicata e corrói a confiança no lembrete.
// A etiqueta de antecedência é computada do próprio par (remind_at, start_at) na hora do envio.
const { test } = require('node:test');
const assert = require('node:assert');
const { leadLabel } = require('./reminder-lead-label');

test('caso real: 2h e 1h antes viram etiquetas distintas', () => {
  assert.strictEqual(leadLabel('2026-08-19T14:00:00Z', '2026-08-19T16:00:00Z'), '2h antes');
  assert.strictEqual(leadLabel('2026-08-19T15:00:00Z', '2026-08-19T16:00:00Z'), '1h antes');
});
test('minutos e combinações', () => {
  assert.strictEqual(leadLabel('2026-08-19T15:30:00Z', '2026-08-19T16:00:00Z'), '30min antes');
  assert.strictEqual(leadLabel('2026-08-19T14:30:00Z', '2026-08-19T16:00:00Z'), '1h30 antes');
});
test('dia(s): 1 dia e 2 dias', () => {
  assert.strictEqual(leadLabel('2026-08-18T16:00:00Z', '2026-08-19T16:00:00Z'), '1 dia antes');
  assert.strictEqual(leadLabel('2026-08-17T16:00:00Z', '2026-08-19T16:00:00Z'), '2 dias antes');
});
test('na hora / lead nulo → "agora" fica sem etiqueta (null)', () => {
  assert.strictEqual(leadLabel('2026-08-19T16:00:00Z', '2026-08-19T16:00:00Z'), null);
  assert.strictEqual(leadLabel('2026-08-19T16:00:30Z', '2026-08-19T16:00:00Z'), null);
});
test('entrada inválida nunca quebra nem inventa', () => {
  assert.strictEqual(leadLabel(null, '2026-08-19T16:00:00Z'), null);
  assert.strictEqual(leadLabel('lixo', 'lixo'), null);
  assert.strictEqual(leadLabel(undefined, undefined), null);
});
test('lead não-canônico arredonda pro minuto (ex.: 59min59s → 1h antes)', () => {
  assert.strictEqual(leadLabel('2026-08-19T15:00:01Z', '2026-08-19T16:00:00Z'), '1h antes');
});
