'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { normalizeHabitFrequency, dayTokenToInt } = require('./habit-frequency');

// HABIT-CREATE-FREQ-CUSTOM-DAYS (Arthur 15/07): a skill mandava o LLM emitir
// frequency:"weekly" + custom_days:["tuesday","thursday","friday"] (STRINGS inglês)
// e frequency:"weekends" (inexistente no CHECK). O dispatcher faz custom_days.map(Number)
// → NaN → hábito de dias-específicos NUNCA disparava no dia certo. O engine passa a
// canonicalizar TUDO para o dialeto único do dispatcher/PWA:
//   frequency ∈ {daily, weekdays, weekly, custom_days}
//   custom_days = array de inteiros ISO 1=segunda..7=domingo.

test('caso Arthur REAL: weekly + dias em inglês (strings) → custom_days + inteiros', () => {
  const a = { action: 'create', name: 'Academia', frequency: 'weekly',
    custom_days: ['tuesday', 'thursday', 'friday'] };
  normalizeHabitFrequency(a);
  assert.strictEqual(a.frequency, 'custom_days');
  assert.deepStrictEqual(a.custom_days, [2, 4, 5]);
});

test('"seg/qua/sex" em português → custom_days [1,3,5]', () => {
  const a = { action: 'create', name: 'Ler', frequency: 'custom',
    custom_days: ['seg', 'qua', 'sex'] };
  normalizeHabitFrequency(a);
  assert.strictEqual(a.frequency, 'custom_days');
  assert.deepStrictEqual(a.custom_days, [1, 3, 5]);
});

test('frequency:"weekends" (não existe no CHECK) → custom_days [6,7]', () => {
  const a = { action: 'create', name: 'Descanso', frequency: 'weekends' };
  normalizeHabitFrequency(a);
  assert.strictEqual(a.frequency, 'custom_days');
  assert.deepStrictEqual(a.custom_days, [6, 7]);
});

test('idempotente: já canônico (custom_days + inteiros) permanece igual', () => {
  const a = { action: 'create', name: 'X', frequency: 'custom_days', custom_days: [1, 3, 5] };
  normalizeHabitFrequency(a);
  assert.strictEqual(a.frequency, 'custom_days');
  assert.deepStrictEqual(a.custom_days, [1, 3, 5]);
});

test('dedup + ordena dias fora de ordem/repetidos', () => {
  const a = { action: 'create', name: 'X', frequency: 'weekly',
    custom_days: ['sexta', 'segunda', 'sexta', 5, 1] };
  normalizeHabitFrequency(a);
  assert.strictEqual(a.frequency, 'custom_days');
  assert.deepStrictEqual(a.custom_days, [1, 5]);
});

test('daily permanece daily; não injeta custom_days', () => {
  const a = { action: 'create', name: 'Água', frequency: 'daily' };
  normalizeHabitFrequency(a);
  assert.strictEqual(a.frequency, 'daily');
  assert.strictEqual('custom_days' in a, false);
});

test('weekdays permanece weekdays', () => {
  const a = { action: 'create', name: 'Caminhar', frequency: 'weekdays' };
  normalizeHabitFrequency(a);
  assert.strictEqual(a.frequency, 'weekdays');
});

test('weekly SEM dias permanece weekly (back-compat = segunda); guard de honestidade ainda avisa', () => {
  const a = { action: 'create', name: 'Contas', frequency: 'weekly' };
  normalizeHabitFrequency(a);
  assert.strictEqual(a.frequency, 'weekly');
  assert.strictEqual('custom_days' in a, false);
});

test('degradação segura: custom_days sem nenhum dia válido → daily, SEM chave custom_days (senão validateHabitAction dropa por null)', () => {
  const a = { action: 'create', name: 'X', frequency: 'custom_days', custom_days: ['bla', 'xyz'] };
  normalizeHabitFrequency(a);
  assert.strictEqual(a.frequency, 'daily');
  assert.strictEqual('custom_days' in a, false);
});

test('weekly + array vazio → weekly, sem custom_days=null', () => {
  const a = { action: 'create', name: 'X', frequency: 'weekly', custom_days: [] };
  normalizeHabitFrequency(a);
  assert.strictEqual(a.frequency, 'weekly');
  assert.strictEqual('custom_days' in a, false);
});

test('só canoniza action=create; log/query/delete intactos', () => {
  const log = { action: 'log', habit_id: 'ab12cd34', custom_days: ['tuesday'] };
  normalizeHabitFrequency(log);
  assert.deepStrictEqual(log.custom_days, ['tuesday']);
  assert.strictEqual(log.frequency, undefined);
});

test('defensivo: null / não-objeto / frequency ausente não quebram', () => {
  assert.doesNotThrow(() => normalizeHabitFrequency(null));
  assert.doesNotThrow(() => normalizeHabitFrequency('x'));
  const a = { action: 'create', name: 'X' };
  normalizeHabitFrequency(a);
  assert.strictEqual(a.frequency, undefined); // sem frequency → handler aplica default daily
});

test('dayTokenToInt: formas variadas en/pt + inteiros; inválido → null', () => {
  assert.strictEqual(dayTokenToInt('monday'), 1);
  assert.strictEqual(dayTokenToInt('Segunda-feira'), 1);
  assert.strictEqual(dayTokenToInt('TER'), 2);
  assert.strictEqual(dayTokenToInt('sáb'), 6);
  assert.strictEqual(dayTokenToInt('domingo'), 7);
  assert.strictEqual(dayTokenToInt(3), 3);
  assert.strictEqual(dayTokenToInt('5'), 5);
  assert.strictEqual(dayTokenToInt('funday'), null);
  assert.strictEqual(dayTokenToInt(9), null);
  assert.strictEqual(dayTokenToInt(0), null);
});
