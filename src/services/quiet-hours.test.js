const { test } = require('node:test');
const assert = require('node:assert');
const { isQuietNow, isPartialQuietPrefs, needsContextRefetch, QUIET_PREF_COLUMNS, nowBrtParts } = require('./quiet-hours');

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

// ---- Regressão domingo 07/06: jobs SEM gate vazavam (retrospectiva, cobrança checklist, filas) ----
// Config REAL do Arthur (68fb3ea0): domingo silencioso SÓ em TRABALHO (quiet_days_work=[0]);
// legado e personal vazios. O fix gateia cada job por isQuietNow(uuid, ..., 'work').
const ARTHUR_WORK_SUNDAY = {
  collaborator_id: '68fb3ea0-af61-4eb4-aade-882d26ad5385',
  quiet_reason: null,
  quiet_start_time: null, quiet_end_time: null, quiet_days: [], quiet_weekends: false,
  quiet_start_time_work: null, quiet_end_time_work: null, quiet_days_work: [0], quiet_weekends_work: false,
  quiet_start_time_personal: null, quiet_end_time_personal: null, quiet_days_personal: [], quiet_weekends_personal: false,
};

test('REGRESSÃO Arthur: domingo 13h TRABALHO = silêncio (quiet_days_work=[0]) — cobrança não vaza', async () => {
  const q = await isQuietNow(ARTHUR_WORK_SUNDAY, { hour: 13, minute: 0, dow: 0 }, 'work');
  assert.strictEqual(q.quiet, true, `esperava silêncio domingo work, veio: ${JSON.stringify(q)}`);
  assert.match(q.reason, /quiet_day_work:0/);
});

test('REGRESSÃO Arthur: domingo 18h TRABALHO = silêncio (retrospectiva semanal não vaza)', async () => {
  const q = await isQuietNow(ARTHUR_WORK_SUNDAY, { hour: 18, minute: 1, dow: 0 }, 'work');
  assert.strictEqual(q.quiet, true);
});

test('ANTI-OVER-SILENCE Arthur: quarta 13h TRABALHO = ENVIA (não silencia dia útil)', async () => {
  const q = await isQuietNow(ARTHUR_WORK_SUNDAY, { hour: 13, minute: 0, dow: 3 }, 'work');
  assert.strictEqual(q.quiet, false, `quarta não pode silenciar, veio: ${JSON.stringify(q)}`);
});

test('CONTEXTO CRUZADO Arthur: domingo 13h PESSOAL = ENVIA (silêncio de trabalho não vaza pro pessoal)', async () => {
  const q = await isQuietNow(ARTHUR_WORK_SUNDAY, { hour: 13, minute: 0, dow: 0 }, 'personal');
  assert.strictEqual(q.quiet, false, `silêncio de trabalho não pode silenciar pessoal, veio: ${JSON.stringify(q)}`);
});

test('nowBrtParts: retorna {hour,minute,dow} em faixa válida (dow 0-6 BRT)', () => {
  const n = nowBrtParts();
  assert.ok(Number.isInteger(n.hour) && n.hour >= 0 && n.hour <= 23, `hour inválido: ${n.hour}`);
  assert.ok(Number.isInteger(n.minute) && n.minute >= 0 && n.minute <= 59, `minute inválido: ${n.minute}`);
  assert.ok(Number.isInteger(n.dow) && n.dow >= 0 && n.dow <= 6, `dow inválido: ${n.dow}`);
});

// ── DND (do_not_disturb_until) NO GATE COMPARTILHADO ───────────────────────────────────────
// Caso do Alf (09/08): "Tom, hoje é feriado, não me manda mensagem" tem que CORTAR na hora.
// O TOM já grava `do_not_disturb_until` (applyDnd, cap 24h) — mas `isQuietNow` não lia o
// campo. Resultado: dos 8 arquivos que gateiam por isQuietNow, 7 NUNCA checavam DND; só o
// dispatcher checava, à mão, em 14 pontos. O pior é que `send-proativo.js` — o CHOKEPOINT
// escrito pra "ser impossível esquecer o gate", com trava de deploy e tudo — também passava
// batido. A pessoa pedia silêncio, o TOM confirmava e gravava, e o lembrete chegava assim
// mesmo por qualquer caminho fora do dispatcher.
// DND é global de propósito: "não me manda NADA hoje" não é por contexto.

const AGORA_MS = Date.parse('2026-08-09T15:00:00-03:00');
const dnd = (offsetH) => new Date(AGORA_MS + offsetH * 3600_000).toISOString();
const TER_1500 = { hour: 15, minute: 0, dow: 2 };
// Prefs sem NENHUM silêncio configurado: sem DND, este horário passa (não é madrugada).
const SEM_SILENCIO = {
  quiet_start_time_work: null, quiet_end_time_work: null, quiet_days_work: [], quiet_weekends_work: false,
  quiet_start_time_personal: null, quiet_end_time_personal: null, quiet_days_personal: [], quiet_weekends_personal: false,
};

test('DND ativo silencia mesmo sem nenhum quiet configurado', async () => {
  const prefs = { ...SEM_SILENCIO, do_not_disturb_until: dnd(+5) };
  const q = await isQuietNow(prefs, TER_1500, 'work', { agoraMs: AGORA_MS });
  assert.strictEqual(q.quiet, true, `esperava silêncio por DND, veio: ${JSON.stringify(q)}`);
  assert.match(q.reason, /^dnd/);
});

test('DND vale nos DOIS contextos — "não me manda NADA" não é por contexto', async () => {
  const prefs = { ...SEM_SILENCIO, do_not_disturb_until: dnd(+2) };
  for (const ctx of ['work', 'personal']) {
    const q = await isQuietNow(prefs, TER_1500, ctx, { agoraMs: AGORA_MS });
    assert.strictEqual(q.quiet, true, `contexto ${ctx}: ${JSON.stringify(q)}`);
  }
});

test('DND vencido NÃO silencia — a janela expira sozinha', async () => {
  const prefs = { ...SEM_SILENCIO, do_not_disturb_until: dnd(-1) };
  const q = await isQuietNow(prefs, TER_1500, 'work', { agoraMs: AGORA_MS });
  assert.strictEqual(q.quiet, false, `DND vencido não pode silenciar: ${JSON.stringify(q)}`);
});

test('DND vence até o pedido explícito do próprio usuário (defaultNightGate=false)', async () => {
  // task_reminders desliga a janela noturna porque o horário foi escolhido pela pessoa.
  // Mas DND é pedido explícito MAIS RECENTE — "hoje não me manda nada" inclui o lembrete
  // que ela mesma agendou. Senão o feriado continua chegando.
  const prefs = { ...SEM_SILENCIO, do_not_disturb_until: dnd(+3) };
  const q = await isQuietNow(prefs, TER_1500, 'work', { agoraMs: AGORA_MS, defaultNightGate: false });
  assert.strictEqual(q.quiet, true);
});

test('ZERO-REGRESSÃO: sem DND, tudo se comporta como antes', async () => {
  for (const v of [null, undefined, '', 'lixo']) {
    const prefs = { ...SEM_SILENCIO, do_not_disturb_until: v };
    const q = await isQuietNow(prefs, TER_1500, 'work', { agoraMs: AGORA_MS });
    assert.strictEqual(q.quiet, false, `do_not_disturb_until=${JSON.stringify(v)} não pode silenciar`);
  }
  // E a janela horária normal segue funcionando com o campo presente e nulo.
  const q = await isQuietNow({ ...QUINTELA_FULL, do_not_disturb_until: null }, SAT_0812, 'work');
  assert.strictEqual(q.quiet, true);
  assert.match(q.reason, /quiet_hours_work/);
});

test('a coluna do DND está no SELECT canônico — senão o caminho por UUID não a enxerga', () => {
  assert.ok(QUIET_PREF_COLUMNS.includes('do_not_disturb_until'),
    'sem isso, isQuietNow(uuid) busca prefs sem o DND e o silêncio some sem erro');
});
