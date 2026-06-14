const { test } = require('node:test');
const assert = require('node:assert');
const { matchSchedule, presetConfig, PRESETS, dispatchGroupReports, buildPresetPreview, sendPresetNow } = require('./group-reports');

// now = { hour, minute, dow (0=dom..6=sab), ymd }
const seg08 = { hour: 8, minute: 2, dow: 1, ymd: '2026-06-15' }; // segunda 08:02 → slot 08:00

test('matchSchedule: daily_morning casa weekday + slot', () => {
  const s = { preset: 'daily_morning', weekdays: [1, 2, 3, 4, 5], time_local: '08:00' };
  assert.strictEqual(matchSchedule(seg08, s), true);
  assert.strictEqual(matchSchedule({ ...seg08, dow: 6 }, s), false); // sábado fora
  assert.strictEqual(matchSchedule({ ...seg08, hour: 9 }, s), false); // hora errada
});

test('matchSchedule: weekly usa weekdays de 1 elemento', () => {
  const s = { preset: 'weekly', weekdays: [1], time_local: '08:00' };
  assert.strictEqual(matchSchedule(seg08, s), true);
  assert.strictEqual(matchSchedule({ ...seg08, dow: 2 }, s), false);
});

test('matchSchedule: domingo (dow=0) vira ISO 7', () => {
  const s = { preset: 'weekly', weekdays: [7], time_local: '08:00' };
  assert.strictEqual(matchSchedule({ hour: 8, minute: 0, dow: 0, ymd: '2026-06-14' }, s), true);
});

test('matchSchedule: monthly casa day_of_month + slot', () => {
  const s = { preset: 'monthly', day_of_month: 15, time_local: '08:00' };
  assert.strictEqual(matchSchedule(seg08, s), true);
  assert.strictEqual(matchSchedule({ ...seg08, ymd: '2026-06-16' }, s), false);
});

test('presetConfig: mapeia os 4 presets', () => {
  assert.deepStrictEqual(presetConfig('daily_morning'), { scope: 'agenda', window: 'hoje', onlyOverdue: false, headingTemplate: '☀️ Bom dia, {grupo}! Hoje vocês têm:' });
  assert.strictEqual(presetConfig('weekly').window, 'semana');
  assert.strictEqual(presetConfig('monthly').window, 'mes');
  assert.strictEqual(presetConfig('overdue').onlyOverdue, true);
});

test('PRESETS na ordem da tela', () => {
  assert.deepStrictEqual(PRESETS, ['daily_morning', 'weekly', 'monthly', 'overdue']);
});

// ── orquestradora (supabase fake + builder fake) ──────────────────────────────
function fakeDb({ settings, claimFails = false, failInsert = false }) {
  const inserted = [];
  const claims = [];
  const rolledBack = [];
  const db = {
    inserted, claims, rolledBack,
    from(tbl) {
      if (tbl === 'group_notification_settings') {
        return { select() { return { eq() { return Promise.resolve({ data: settings }); } }; } };
      }
      if (tbl === 'group_ritual_logs') {
        return {
          insert(row) { claims.push(row); return { select() { return { single() {
            return claimFails ? Promise.resolve({ error: { code: '23505' } }) : Promise.resolve({ data: { id: 'c1' } });
          } }; } }; },
          delete() { return { eq(_col, id) { rolledBack.push(id); return Promise.resolve({ error: null }); } }; },
        };
      }
      if (tbl === 'group_chat_messages') {
        return { insert(row) { inserted.push(row); return Promise.resolve({ error: failInsert ? { message: 'boom transitório' } : null }); } };
      }
      return { select() { return { eq() { return Promise.resolve({ data: [] }); } }; } };
    },
  };
  return db;
}

test('dispatchGroupReports: dispara daily_morning no slot e insere card', async () => {
  const now = { hour: 8, minute: 0, dow: 1, ymd: '2026-06-15' };
  const db = fakeDb({ settings: [
    { group_id: 'g1', preset: 'daily_morning', enabled: true, weekdays: [1, 2, 3, 4, 5], day_of_month: null, time_local: '08:00', group: { name: 'Financeiro' } },
  ] });
  await dispatchGroupReports({ now, supabase: db, deps: { buildGroupReport: async () => ({ html: '<div>card</div>', isEmpty: false }) } });
  assert.strictEqual(db.inserted.length, 1);
  assert.strictEqual(db.inserted[0].kind, 'report');
  assert.strictEqual(db.inserted[0].channel, 'app');
  assert.strictEqual(db.inserted[0].role, 'tom');
});

test('dispatchGroupReports: overdue vazio não claima nem insere', async () => {
  const now = { hour: 9, minute: 0, dow: 1, ymd: '2026-06-15' };
  const db = fakeDb({ settings: [
    { group_id: 'g1', preset: 'overdue', enabled: true, weekdays: [1], day_of_month: null, time_local: '09:00', group: { name: 'Financeiro' } },
  ] });
  await dispatchGroupReports({ now, supabase: db, deps: { buildGroupReport: async () => ({ html: '', isEmpty: true }) } });
  assert.strictEqual(db.inserted.length, 0);
  assert.strictEqual(db.claims.length, 0);
});

test('dispatchGroupReports: insert transitório reverte o claim p/ retry (RITUAL-NO-RETRY)', async () => {
  const now = { hour: 8, minute: 0, dow: 1, ymd: '2026-06-15' };
  const db = fakeDb({ failInsert: true, settings: [
    { group_id: 'g1', preset: 'daily_morning', enabled: true, weekdays: [1, 2, 3, 4, 5], day_of_month: null, time_local: '08:00', group: { name: 'Financeiro' } },
  ] });
  await dispatchGroupReports({ now, supabase: db, deps: { buildGroupReport: async () => ({ html: '<div>x</div>', isEmpty: false }) } });
  assert.strictEqual(db.claims.length, 1);        // venceu o claim
  assert.deepStrictEqual(db.rolledBack, ['c1']);  // mas reverteu pra re-tentar no próximo tick
});

test('dispatchGroupReports: fora do slot não faz nada', async () => {
  const now = { hour: 10, minute: 0, dow: 1, ymd: '2026-06-15' };
  const db = fakeDb({ settings: [
    { group_id: 'g1', preset: 'daily_morning', enabled: true, weekdays: [1], day_of_month: null, time_local: '08:00', group: { name: 'Financeiro' } },
  ] });
  await dispatchGroupReports({ now, supabase: db, deps: { buildGroupReport: async () => ({ html: '<div>x</div>', isEmpty: false }) } });
  assert.strictEqual(db.inserted.length, 0);
});

// ── buildPresetPreview (read-only, usado pelo "Pré-visualizar") ────────────────
function fakeGroupDb(name) {
  return {
    from(tbl) {
      if (tbl === 'work_groups') {
        return { select() { return { eq() { return { maybeSingle() { return Promise.resolve({ data: name == null ? null : { name } }); } }; } }; } };
      }
      return { select() { return { eq() { return Promise.resolve({ data: [] }); } }; } };
    },
  };
}

test('buildPresetPreview: monta heading do preset e devolve html sem enviar', async () => {
  let captured = null;
  const r = await buildPresetPreview({
    supabase: fakeGroupDb('Financeiro'), groupId: 'g1', preset: 'daily_morning', now: new Date('2026-06-15T11:00:00Z'),
    deps: { buildGroupReport: async (args) => { captured = args; return { html: '<div>card</div>', isEmpty: false }; } },
  });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.html, '<div>card</div>');
  assert.strictEqual(r.isEmpty, false);
  assert.strictEqual(r.heading, '☀️ Bom dia, Financeiro! Hoje vocês têm:');
  assert.strictEqual(captured.scope, 'agenda');   // herdou do presetConfig
  assert.strictEqual(captured.window, 'hoje');
});

test('buildPresetPreview: preset inválido → ok:false', async () => {
  const r = await buildPresetPreview({ supabase: fakeGroupDb('X'), groupId: 'g1', preset: 'nope' });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.error, 'invalid_preset');
});

test('buildPresetPreview: grupo inexistente → ok:false', async () => {
  const r = await buildPresetPreview({
    supabase: fakeGroupDb(null), groupId: 'gX', preset: 'weekly',
    deps: { buildGroupReport: async () => ({ html: '', isEmpty: true }) },
  });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.error, 'group_not_found');
});

// ── sendPresetNow (disparo manual "Enviar agora") ─────────────────────────────
test('sendPresetNow: monta e INSERE o card (envia de verdade)', async () => {
  const inserted = [];
  const r = await sendPresetNow({
    supabase: fakeGroupDb('Financeiro'), groupId: 'g1', preset: 'daily_morning', now: new Date('2026-06-15T11:00:00Z'),
    deps: {
      buildGroupReport: async () => ({ html: '<div>card</div>', isEmpty: false }),
      insertReportCard: async (_s, gid, html) => { inserted.push({ gid, html }); },
    },
  });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.sent, true);
  assert.strictEqual(inserted.length, 1);
  assert.strictEqual(inserted[0].html, '<div>card</div>');
});

test('sendPresetNow: overdue vazio NÃO insere (sent:false)', async () => {
  const inserted = [];
  const r = await sendPresetNow({
    supabase: fakeGroupDb('Financeiro'), groupId: 'g1', preset: 'overdue', now: new Date('2026-06-15T11:00:00Z'),
    deps: {
      buildGroupReport: async () => ({ html: '<div></div>', isEmpty: true }),
      insertReportCard: async () => { inserted.push(1); },
    },
  });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.sent, false);
  assert.strictEqual(r.isEmpty, true);
  assert.strictEqual(inserted.length, 0);
});
