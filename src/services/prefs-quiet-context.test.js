const { test } = require('node:test');
const assert = require('node:assert');
const { isContextQuietField, validateContextQuietField, CONTEXT_QUIET_FIELDS } = require('./prefs-quiet-context');

test('isContextQuietField: só reconhece colunas de contexto (_work/_personal)', () => {
  assert.strictEqual(isContextQuietField('quiet_start_time_work'), true);
  assert.strictEqual(isContextQuietField('quiet_end_time_personal'), true);
  assert.strictEqual(isContextQuietField('quiet_days_work'), true);
  assert.strictEqual(isContextQuietField('quiet_weekends_personal'), true);
  // globais e outros campos NÃO são de contexto
  assert.strictEqual(isContextQuietField('quiet_start_time'), false);
  assert.strictEqual(isContextQuietField('quiet_days'), false);
  assert.strictEqual(isContextQuietField('briefing_time'), false);
});

test('CONTEXT_QUIET_FIELDS cobre os 8 campos (work+personal × start/end/days/weekends)', () => {
  for (const c of [
    'quiet_start_time_work', 'quiet_end_time_work', 'quiet_days_work', 'quiet_weekends_work',
    'quiet_start_time_personal', 'quiet_end_time_personal', 'quiet_days_personal', 'quiet_weekends_personal',
  ]) {
    assert.ok(CONTEXT_QUIET_FIELDS.has(c), `faltou: ${c}`);
  }
});

test('time: HH:MM válido normaliza pra HH:MM:SS', () => {
  assert.deepStrictEqual(validateContextQuietField('quiet_start_time_work', '11:00'), { ok: true, value: '11:00:00' });
  assert.deepStrictEqual(validateContextQuietField('quiet_end_time_personal', '08:30:00'), { ok: true, value: '08:30:00' });
});

test('time: null limpa o silêncio daquele contexto', () => {
  assert.deepStrictEqual(validateContextQuietField('quiet_start_time_work', null), { ok: true, value: null });
});

test('time: valor inválido é rejeitado', () => {
  assert.strictEqual(validateContextQuietField('quiet_start_time_work', '25:00').ok, false);
  assert.strictEqual(validateContextQuietField('quiet_start_time_work', 'manhã').ok, false);
});

test('days: array de dow 0-6 com dedup', () => {
  assert.deepStrictEqual(validateContextQuietField('quiet_days_work', [0, 6, 6]), { ok: true, value: [0, 6] });
  assert.deepStrictEqual(validateContextQuietField('quiet_days_personal', []), { ok: true, value: [] });
});

test('days: dow fora de 0-6 ou não-array rejeitado', () => {
  assert.strictEqual(validateContextQuietField('quiet_days_work', [7]).ok, false);
  assert.strictEqual(validateContextQuietField('quiet_days_work', 'seg').ok, false);
});

test('weekends: só boolean', () => {
  assert.deepStrictEqual(validateContextQuietField('quiet_weekends_work', true), { ok: true, value: true });
  assert.strictEqual(validateContextQuietField('quiet_weekends_work', 'sim').ok, false);
});
