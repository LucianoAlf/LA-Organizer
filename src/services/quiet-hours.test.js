const { test } = require('node:test');
const assert = require('node:assert');
const { isQuietNow } = require('./quiet-hours');

// Preferências REAIS do Quintela (bfd77b2c), como o SELECT user_preferences(*)
// devolve: silêncio diário 00:00–11:00 em work e personal; quiet_days=[0] (dom);
// quiet_weekends=false. Sábado = dow 6.
const QUINTELA_FULL = {
  quiet_reason: null,
  quiet_start_time: '00:00:00', quiet_end_time: '11:00:00', quiet_days: [0], quiet_weekends: false,
  quiet_start_time_work: '00:00:00', quiet_end_time_work: '11:00:00', quiet_days_work: [0], quiet_weekends_work: false,
  quiet_start_time_personal: '00:00:00', quiet_end_time_personal: '11:00:00', quiet_days_personal: [0], quiet_weekends_personal: false,
};

// O que os jobs de alerta buscavam ANTES do fix (SELECT incompleto): sem nenhuma
// coluna de horário. É a forma exata que causava o bug.
const QUINTELA_PARTIAL_OLD_SELECT = {
  quiet_reason: null,
  quiet_weekends: false,
  quiet_days: [0],
};

const SAT_0812 = { hour: 8, minute: 12, dow: 6 };

test('Quintela NÃO deve ser cobrado às 08:12 de sábado (janela 00:00–11:00, contexto work)', async () => {
  const q = await isQuietNow(QUINTELA_FULL, SAT_0812, 'work');
  assert.strictEqual(q.quiet, true, `esperava silêncio, veio: ${JSON.stringify(q)}`);
  assert.match(q.reason, /quiet_hours_work:00:00-11:00/);
});

test('mesmo cenário no contexto personal também silencia', async () => {
  const q = await isQuietNow(QUINTELA_FULL, SAT_0812, 'personal');
  assert.strictEqual(q.quiet, true);
  assert.match(q.reason, /quiet_hours_personal:00:00-11:00/);
});

test('boundary: 10:59 ainda é silêncio; 11:00 já libera (end exclusivo)', async () => {
  const at1059 = await isQuietNow(QUINTELA_FULL, { hour: 10, minute: 59, dow: 6 }, 'work');
  const at1100 = await isQuietNow(QUINTELA_FULL, { hour: 11, minute: 0, dow: 6 }, 'work');
  assert.strictEqual(at1059.quiet, true, 'tô as 10:59 → ainda silêncio');
  assert.strictEqual(at1100.quiet, false, 'tô as 11:00 → já pode');
});

test('CARACTERIZAÇÃO DO BUG: com o SELECT incompleto antigo, a janela horária some e o silêncio é desligado', async () => {
  const q = await isQuietNow(QUINTELA_PARTIAL_OLD_SELECT, SAT_0812, 'work');
  // Sem as colunas de horário no objeto, windowFor não enxerga 00:00–11:00 →
  // sábado (weekends=false, days=[0]) não bate em nada → libera. É o bug.
  assert.strictEqual(q.quiet, false);
});

test('domingo continua silencioso via quiet_days mesmo fora da janela horária (regressão)', async () => {
  const sun_1500 = { hour: 15, minute: 0, dow: 0 };
  const q = await isQuietNow(QUINTELA_FULL, sun_1500, 'work');
  assert.strictEqual(q.quiet, true);
  assert.match(q.reason, /quiet_day_work:0/);
});
