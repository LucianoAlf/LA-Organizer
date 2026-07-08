const { test } = require('node:test');
const assert = require('node:assert');
const { isDueForCheckin } = require('./checkin-window');

// Audit 08/07 (Matheus A): o check-in só deve cobrar HOJE + ATRASADAS, não o futuro.
test('vence HOJE → entra', () => {
  assert.strictEqual(isDueForCheckin('2026-07-07', '2026-07-07'), true);
});

test('ATRASADA (ontem) → entra', () => {
  assert.strictEqual(isDueForCheckin('2026-07-06', '2026-07-07'), true);
});

test('FUTURA (caso Matheus: due 13/07 no check de 07/07) → NÃO entra', () => {
  assert.strictEqual(isDueForCheckin('2026-07-13', '2026-07-07'), false);
});

test('amanhã → NÃO entra', () => {
  assert.strictEqual(isDueForCheckin('2026-07-08', '2026-07-07'), false);
});

test('sem due_date → NÃO entra (tarefa sem prazo não é cobrada no check)', () => {
  assert.strictEqual(isDueForCheckin(null, '2026-07-07'), false);
  assert.strictEqual(isDueForCheckin(undefined, '2026-07-07'), false);
  assert.strictEqual(isDueForCheckin('', '2026-07-07'), false);
});

test('vira o ano corretamente (compara cronológico via ISO)', () => {
  assert.strictEqual(isDueForCheckin('2025-12-31', '2026-01-01'), true);  // atrasada
  assert.strictEqual(isDueForCheckin('2026-01-02', '2026-01-01'), false); // futura
});
