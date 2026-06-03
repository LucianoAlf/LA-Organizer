const { test } = require('node:test');
const assert = require('node:assert');
const { isQuietNow, isPartialQuietPrefs, needsContextRefetch, QUIET_PREF_COLUMNS } = require('./quiet-hours');

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

// ---- Item 2: trava defensiva contra SELECT parcial ----

test('QUIET_PREF_COLUMNS é a fonte única e inclui as colunas de horário (global + contexto)', () => {
  for (const col of [
    'quiet_start_time', 'quiet_end_time',
    'quiet_start_time_work', 'quiet_end_time_work',
    'quiet_start_time_personal', 'quiet_end_time_personal',
  ]) {
    assert.ok(QUIET_PREF_COLUMNS.includes(col), `faltou coluna canônica: ${col}`);
  }
});

test('isPartialQuietPrefs: detecta o SELECT incompleto antigo (quiet flags sem nenhuma coluna de horário)', () => {
  assert.strictEqual(isPartialQuietPrefs(QUINTELA_PARTIAL_OLD_SELECT), true);
});

test('isPartialQuietPrefs: objeto completo (*) NÃO é parcial', () => {
  assert.strictEqual(isPartialQuietPrefs(QUINTELA_FULL), false);
});

test('isPartialQuietPrefs: select só-global (com quiet_start_time) NÃO é parcial — evita alarme falso', () => {
  const globalOnly = { quiet_weekends: false, quiet_days: [], quiet_reason: null, quiet_start_time: '00:00:00', quiet_end_time: '10:00:00' };
  assert.strictEqual(isPartialQuietPrefs(globalOnly), false);
});

test('isPartialQuietPrefs: não-objeto e objeto sem marcadores de quiet retornam false (sem falso positivo)', () => {
  assert.strictEqual(isPartialQuietPrefs(null), false);
  assert.strictEqual(isPartialQuietPrefs('uuid-string'), false);
  assert.strictEqual(isPartialQuietPrefs({}), false);
});

// ---- Sprint 31.11: auto-heal do footgun (caso Juliana 03/06) ----

// Config REAL da Juliana (c6067c7d): janela 00:00–11:00 só nas colunas _work; globais
// legados com hora NULL; domingo (0) silencioso em work. É a forma que o briefing/
// checkpoint NÃO enxergavam quando passavam objeto parcial.
const JULIANA_WORK_ONLY = {
  collaborator_id: 'c6067c7d-05f1-4882-a224-3f91d4de5997',
  quiet_reason: 'não quer ser contatada aos domingos',
  quiet_start_time: null, quiet_end_time: null, quiet_days: [0], quiet_weekends: false,
  quiet_start_time_work: '00:00:00', quiet_end_time_work: '11:00:00', quiet_days_work: [0], quiet_weekends_work: false,
  quiet_start_time_personal: null, quiet_end_time_personal: null, quiet_days_personal: [0], quiet_weekends_personal: false,
};

test('needsContextRefetch: objeto parcial (legado-only, sem colunas de contexto) → true', () => {
  assert.strictEqual(needsContextRefetch(QUINTELA_PARTIAL_OLD_SELECT), true);
});

test('needsContextRefetch: objeto completo (com colunas de contexto) → false', () => {
  assert.strictEqual(needsContextRefetch(QUINTELA_FULL), false);
  assert.strictEqual(needsContextRefetch(JULIANA_WORK_ONLY), false);
});

test('needsContextRefetch: sem cara de prefs / null / string → false (não dispara refetch à toa)', () => {
  assert.strictEqual(needsContextRefetch({}), false);
  assert.strictEqual(needsContextRefetch(null), false);
  assert.strictEqual(needsContextRefetch('uuid'), false);
});

test('Juliana (janela só em _work, legado null): 08:00 quarta = silêncio de TRABALHO', async () => {
  const q = await isQuietNow(JULIANA_WORK_ONLY, { hour: 8, minute: 0, dow: 3 }, 'work');
  assert.strictEqual(q.quiet, true, `esperava silêncio 8h work, veio: ${JSON.stringify(q)}`);
  assert.match(q.reason, /quiet_hours_work:00:00-11:00/);
});

test('Juliana: 07:02 segunda (monthly_planning_intro vazou) = silêncio de TRABALHO', async () => {
  const q = await isQuietNow(JULIANA_WORK_ONLY, { hour: 7, minute: 2, dow: 1 }, 'work');
  assert.strictEqual(q.quiet, true);
});

test('Juliana: domingo 18h (retrospectiva vazou) = silêncio de TRABALHO via quiet_days_work', async () => {
  const q = await isQuietNow(JULIANA_WORK_ONLY, { hour: 18, minute: 1, dow: 0 }, 'work');
  assert.strictEqual(q.quiet, true);
  assert.match(q.reason, /quiet_day_work:0/);
});

test('Juliana: 11:01 (depois da janela) NÃO silencia em dia útil — não pode sobre-silenciar', async () => {
  const q = await isQuietNow(JULIANA_WORK_ONLY, { hour: 11, minute: 1, dow: 3 }, 'work');
  assert.strictEqual(q.quiet, false);
});
