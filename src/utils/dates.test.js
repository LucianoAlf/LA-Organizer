const { test } = require('node:test');
const assert = require('node:assert');
const { withinConfirmWindow, todayYmdSP } = require('./dates');

// todayYmdSP (staged-reschedule i) — YMD de SP via Intl, robusto ao shift UTC pós-21h.
test('todayYmdSP: sem shift UTC pós-21h (16 UTC 01:00 = 15 SP 22:00 → dia 15)', () => {
  assert.strictEqual(todayYmdSP(new Date('2026-07-16T01:00:00Z')), '2026-07-15');
});
test('todayYmdSP: meio-dia SP trivial', () => {
  assert.strictEqual(todayYmdSP(new Date('2026-07-15T15:00:00Z')), '2026-07-15');
});
test('todayYmdSP: virada de mês respeita fuso', () => {
  // 2026-08-01 02:00 UTC = 2026-07-31 23:00 SP → ainda julho
  assert.strictEqual(todayYmdSP(new Date('2026-08-01T02:00:00Z')), '2026-07-31');
});

test('withinConfirmWindow: 5 min atras dentro de 20 → true', () => {
  const asked = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  assert.strictEqual(withinConfirmWindow(asked, 20), true);
});
test('withinConfirmWindow: 5h atras fora de 20 → false (caso do bug Rafinha)', () => {
  const asked = new Date(Date.now() - 5 * 3600 * 1000).toISOString();
  assert.strictEqual(withinConfirmWindow(asked, 20), false);
});
test('withinConfirmWindow: 19 min dentro de 20 → true', () => {
  const asked = new Date(Date.now() - 19 * 60 * 1000).toISOString();
  assert.strictEqual(withinConfirmWindow(asked, 20), true);
});
test('withinConfirmWindow: asked_at ausente/invalido → false (conservador)', () => {
  assert.strictEqual(withinConfirmWindow(null, 20), false);
  assert.strictEqual(withinConfirmWindow(undefined, 20), false);
  assert.strictEqual(withinConfirmWindow('lixo', 20), false);
});

// ── businessDaysOverdue (§7/§9) — dias ÚTEIS de atraso, domingo não conta ────
const { businessDaysOverdue } = require('./dates');

test('businessDaysOverdue: não atrasada → 0', () => {
  assert.strictEqual(businessDaysOverdue('2026-07-17', '2026-07-17'), 0); // hoje == vencimento
  assert.strictEqual(businessDaysOverdue('2026-07-17', '2026-07-16'), 0); // hoje ANTES do vencimento
});

test('businessDaysOverdue: vence sexta → sáb=1, dom=1, seg=2, ter=3, qua=4', () => {
  const sex = '2026-07-17';
  assert.strictEqual(businessDaysOverdue(sex, '2026-07-18'), 1); // sábado CONTA
  assert.strictEqual(businessDaysOverdue(sex, '2026-07-19'), 1); // domingo NÃO conta (segue 1)
  assert.strictEqual(businessDaysOverdue(sex, '2026-07-20'), 2); // segunda
  assert.strictEqual(businessDaysOverdue(sex, '2026-07-21'), 3); // terça → entra no líder
  assert.strictEqual(businessDaysOverdue(sex, '2026-07-22'), 4); // quarta
});

test('businessDaysOverdue: vence sábado, hoje domingo → 0 (§9 caso 4)', () => {
  // o único dia decorrido é domingo, que não é útil. Segunda vira 1.
  assert.strictEqual(businessDaysOverdue('2026-07-18', '2026-07-19'), 0); // sáb→dom
  assert.strictEqual(businessDaysOverdue('2026-07-18', '2026-07-20'), 1); // sáb→seg
});

test('businessDaysOverdue: intervalo com 2 domingos = corridos − 2', () => {
  // sex 17/07 → sex 31/07 = 14 dias corridos, 2 domingos (19 e 26) no meio → 12 úteis
  assert.strictEqual(businessDaysOverdue('2026-07-17', '2026-07-31'), 12);
});

test('businessDaysOverdue: limiar 6 úteis — vence sexta cai no CEO 8 dias corridos depois', () => {
  // sex 17 → seg 27 = 10 corridos, domingos 19+26 = 2 → 8 úteis (>= 6, entra no CEO)
  assert.strictEqual(businessDaysOverdue('2026-07-17', '2026-07-27'), 8);
});
