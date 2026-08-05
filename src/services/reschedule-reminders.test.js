// src/services/reschedule-reminders.test.js
// Sprint 31.12 — ao reagendar um evento, os lembretes não-enviados precisam acompanhar
// o novo horário. Encoda o caso REAL Matheus/Bia 03/06 (reschedule deixava o lembrete
// velho disparar no horário antigo).
//
// Rodar: node --test src/services/reschedule-reminders.test.js

const { test } = require('node:test');
const assert = require('node:assert');
const { shiftRemindersByReschedule, shiftTaskRemindAt, planRescheduleReminders } = require('./reschedule-reminders');

test('caso Bia 03/06: reschedule 06-03 13:30 → 06-08 13:00 desloca o lembrete T-15 junto', () => {
  const out = shiftRemindersByReschedule(
    [{ id: 'r1', remind_at: '2026-06-03T13:15:00-03:00' }],
    '2026-06-03T13:30:00-03:00',
    '2026-06-08T13:00:00-03:00'
  );
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].id, 'r1');
  // T-15 do novo horário (13:00 BRT − 15min = 12:45 BRT = 15:45Z)
  assert.strictEqual(out[0].remind_at, '2026-06-08T15:45:00.000Z');
});

test('preserva offsets distintos (T-15 e T-60) ao mover +1 dia', () => {
  const out = shiftRemindersByReschedule(
    [
      { id: 'a', remind_at: '2026-06-03T13:45:00-03:00' }, // T-15
      { id: 'b', remind_at: '2026-06-03T13:00:00-03:00' }, // T-60
    ],
    '2026-06-03T14:00:00-03:00',
    '2026-06-04T14:00:00-03:00' // +1 dia exato
  );
  assert.strictEqual(out.length, 2);
  assert.strictEqual(out[0].remind_at, '2026-06-04T16:45:00.000Z'); // 13:45 BRT +1d
  assert.strictEqual(out[1].remind_at, '2026-06-04T16:00:00.000Z'); // 13:00 BRT +1d
});

test('start antigo/novo inválido → [] (não mexe em nada)', () => {
  assert.deepStrictEqual(shiftRemindersByReschedule([{ id: 'x', remind_at: '2026-06-03T13:00:00-03:00' }], 'lixo', '2026-06-08T13:00:00-03:00'), []);
  assert.deepStrictEqual(shiftRemindersByReschedule([{ id: 'x', remind_at: '2026-06-03T13:00:00-03:00' }], '2026-06-03T13:00:00-03:00', null), []);
});

test('delta zero (mesmo horário) → [] (nada a fazer)', () => {
  const same = '2026-06-03T13:00:00-03:00';
  assert.deepStrictEqual(shiftRemindersByReschedule([{ id: 'x', remind_at: same }], same, same), []);
});

test('reminder com remind_at inválido é ignorado, válidos passam', () => {
  const out = shiftRemindersByReschedule(
    [{ id: 'ok', remind_at: '2026-06-03T13:45:00-03:00' }, { id: 'bad', remind_at: 'nope' }],
    '2026-06-03T14:00:00-03:00',
    '2026-06-04T14:00:00-03:00'
  );
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].id, 'ok');
});

test('lista vazia / nula → []', () => {
  assert.deepStrictEqual(shiftRemindersByReschedule([], '2026-06-03T13:00:00-03:00', '2026-06-04T13:00:00-03:00'), []);
  assert.deepStrictEqual(shiftRemindersByReschedule(null, '2026-06-03T13:00:00-03:00', '2026-06-04T13:00:00-03:00'), []);
});

// ── shiftTaskRemindAt (Sprint 31.13 — caso Kinho/Yuri) ──────────────────────────
test('caso Kinho: due 06-01 → 06-06 (+5d) desloca o remind_at +5 dias, mantendo a hora', () => {
  // remind_at 29/05 15:00 BRT = 18:00Z; +5 dias = 03/06 18:00Z (hora preservada)
  const out = shiftTaskRemindAt('2026-06-01', '2026-06-06', '2026-05-29T18:00:00.000Z');
  assert.strictEqual(out, '2026-06-03T18:00:00.000Z');
});

test('mover +1 dia preserva o horário do dia', () => {
  assert.strictEqual(
    shiftTaskRemindAt('2026-06-03', '2026-06-04', '2026-06-03T12:30:00.000Z'),
    '2026-06-04T12:30:00.000Z'
  );
});

test('reagendar pra trás (delta negativo) também desloca', () => {
  assert.strictEqual(
    shiftTaskRemindAt('2026-06-10', '2026-06-08', '2026-06-10T09:00:00.000Z'),
    '2026-06-08T09:00:00.000Z'
  );
});

test('sem due antigo, sem due novo ou sem remind_at → null (nada a fazer)', () => {
  assert.strictEqual(shiftTaskRemindAt(null, '2026-06-06', '2026-05-29T18:00:00.000Z'), null);
  assert.strictEqual(shiftTaskRemindAt('2026-06-01', null, '2026-05-29T18:00:00.000Z'), null);
  assert.strictEqual(shiftTaskRemindAt('2026-06-01', '2026-06-06', null), null);
});

test('delta zero (mesmo due) → null', () => {
  assert.strictEqual(shiftTaskRemindAt('2026-06-06', '2026-06-06', '2026-06-06T12:00:00.000Z'), null);
});

test('datas inválidas → null', () => {
  assert.strictEqual(shiftTaskRemindAt('lixo', '2026-06-06', '2026-05-29T18:00:00.000Z'), null);
  assert.strictEqual(shiftTaskRemindAt('2026-06-01', '2026-06-06', 'nope'), null);
});

// ── planRescheduleReminders (EVENT-RESCHED-REMINDER-NOREGEN 28/06) ──────────────
// O reschedule só deslocava rows sent_at IS NULL. Se a única row já tinha DISPARADO
// (ou não havia row), o evento reagendado ficava SEM lembrete pendente (caso ADM:
// row T-15 fired 06-24 → reschedule 07-01 → 0 pendente). O plano garante ≥1 pendente.
test('reschedule COM lembrete pendente → desloca, sem inserir default', () => {
  const out = planRescheduleReminders({
    unsentRows: [{ id: 'r1', remind_at: '2026-06-03T13:15:00-03:00' }],
    oldStartIso: '2026-06-03T13:30:00-03:00',
    newStartIso: '2026-06-08T13:00:00-03:00',
    eventId: 'e1',
  });
  assert.strictEqual(out.shifts.length, 1);
  assert.strictEqual(out.shifts[0].remind_at, '2026-06-08T15:45:00.000Z');
  assert.deepStrictEqual(out.inserts, []);
});

test('caso ADM: 0 pendente (única row já disparou) → 1 default T-15 do novo start', () => {
  const out = planRescheduleReminders({
    unsentRows: [],
    oldStartIso: '2026-06-24T14:00:00-03:00',
    newStartIso: '2026-07-01T14:00:00-03:00',
    eventId: 'adm1',
  });
  assert.deepStrictEqual(out.shifts, []);
  assert.strictEqual(out.inserts.length, 1);
  assert.strictEqual(out.inserts[0].event_id, 'adm1');
  // 14:00 BRT − 15min = 13:45 BRT = 16:45Z
  assert.strictEqual(out.inserts[0].remind_at, '2026-07-01T16:45:00.000Z');
});

test('EDGE: delta-zero COM rows pendentes → NÃO inventa default (hadUnsent manda, não shifts)', () => {
  const same = '2026-07-01T14:00:00-03:00';
  const out = planRescheduleReminders({
    unsentRows: [{ id: 'r1', remind_at: '2026-07-01T13:45:00-03:00' }],
    oldStartIso: same, newStartIso: same, eventId: 'e1',
  });
  assert.deepStrictEqual(out.shifts, []); // delta 0 → shift vazio
  assert.deepStrictEqual(out.inserts, []); // mas tinha pendente → não insere default
});

test('0 pendente + newStart inválido → sem insert (defensivo)', () => {
  const out = planRescheduleReminders({ unsentRows: [], oldStartIso: '2026-06-24T14:00:00-03:00', newStartIso: 'lixo', eventId: 'e1' });
  assert.deepStrictEqual(out.inserts, []);
});

test('0 pendente + defaultMin custom (60) → T-60 do novo start', () => {
  const out = planRescheduleReminders({
    unsentRows: [], oldStartIso: '2026-06-24T14:00:00-03:00', newStartIso: '2026-07-01T14:00:00-03:00', eventId: 'e1', defaultMin: 60,
  });
  assert.strictEqual(out.inserts[0].remind_at, '2026-07-01T16:00:00.000Z'); // 14:00 BRT − 60 = 13:00 BRT = 16:00Z
});

// ── PISO no reagendamento (caso Matheus, 04/08/2026) ───────────────────────────
// A tarefa do Inventário tinha remind_at de 20/06 preso no passado. Reagendada para
// quinta (06/08), o deslocamento por delta manteve o lembrete 42 dias atrás — e o cron,
// que só pergunta "remind_at <= agora?", cobrou na mesma varredura. O usuário foi cobrado
// ANTES da data que ele mesmo combinou, três vezes, e se irritou com razão.
//
// planReminderFloor já resolvia isso, mas só era usada no ramo de SNOOZE. A regra existia
// e não tinha sido levada para o ramo irmão.
const AGORA = Date.parse('2026-08-04T10:00:00-03:00');

test('lembrete LEGADO vencido + reagendamento pro futuro → NÃO pode ficar no passado', () => {
  const out = planRescheduleReminders({
    unsentRows: [{ id: 'r_legado', remind_at: '2026-06-20T09:00:00-03:00' }], // 45 dias atrás
    oldStartIso: '2026-08-04T09:00:00-03:00',
    newStartIso: '2026-08-06T09:00:00-03:00',   // quinta
    eventId: 'inv1',
    nowMs: AGORA,
  });
  assert.strictEqual(out.shifts.length, 1);
  const quando = Date.parse(out.shifts[0].remind_at);
  assert.ok(quando > AGORA, `lembrete ficou no passado: ${out.shifts[0].remind_at}`);
  // e cai perto da NOVA data, não num ponto arbitrário
  assert.ok(quando <= Date.parse('2026-08-06T09:00:00-03:00'), 'lembrete depois do próprio prazo');
});

test('lembrete normal (futuro) segue o delta, sem recalcular', () => {
  const out = planRescheduleReminders({
    unsentRows: [{ id: 'r1', remind_at: '2026-08-05T08:45:00-03:00' }],
    oldStartIso: '2026-08-05T09:00:00-03:00',
    newStartIso: '2026-08-07T09:00:00-03:00',
    eventId: 'e1',
    nowMs: AGORA,
  });
  // +2 dias exatos: preserva a antecedência de 15min que o usuário tinha
  assert.strictEqual(out.shifts[0].remind_at, '2026-08-07T11:45:00.000Z');
});

test('vários lembretes: só os vencidos são recalculados', () => {
  const out = planRescheduleReminders({
    unsentRows: [
      { id: 'velho', remind_at: '2026-06-20T09:00:00-03:00' },
      { id: 'ok',    remind_at: '2026-08-05T08:45:00-03:00' },
    ],
    oldStartIso: '2026-08-05T09:00:00-03:00',
    newStartIso: '2026-08-07T09:00:00-03:00',
    eventId: 'e1',
    nowMs: AGORA,
  });
  assert.strictEqual(out.shifts.length, 2);
  for (const s of out.shifts) assert.ok(Date.parse(s.remind_at) > AGORA, `${s.id} no passado`);
  assert.strictEqual(out.shifts.find(s => s.id === 'ok').remind_at, '2026-08-07T11:45:00.000Z');
});

test('reagendou pra daqui a pouco: lembrete colado no prazo é legítimo, não vira futuro artificial', () => {
  const out = planRescheduleReminders({
    unsentRows: [{ id: 'velho', remind_at: '2026-06-20T09:00:00-03:00' }],
    oldStartIso: '2026-08-01T09:00:00-03:00',
    newStartIso: '2026-08-04T10:05:00-03:00',   // 5 min depois de AGORA
    eventId: 'e1',
    nowMs: AGORA,
  });
  // T-15 do novo start cairia ANTES de agora; aceita-se, porque o prazo é já —
  // o que não se aceita é o lembrete de 45 dias atrás sobreviver.
  const quando = Date.parse(out.shifts[0].remind_at);
  assert.ok(quando >= Date.parse('2026-08-04T09:50:00-03:00'), 'recalculou pro passado remoto de novo');
});

// ── PISO no caminho de TAREFA (o que de fato cobrou o Matheus) ─────────────────
// Prova no banco: "Finalizar inventário de musicalização" ficou com due=2026-08-06
// (quinta, correto) e remind_at=20/06 09:00 — 45 dias no passado. reminded_at=04/08 09:35:
// cobrado dois dias ANTES do prazo combinado.
// planRescheduleReminders (acima) só atende EVENTOS; tarefa vai por shiftTaskRemindAt.
// Corrigir só um dos irmãos deixaria o caso real de pé.
test('TAREFA: remind_at legado vencido vai para a NOVA data, preservando a hora', () => {
  const novo = shiftTaskRemindAt('2026-08-04', '2026-08-06', '2026-06-20T12:00:00Z', AGORA);
  assert.ok(novo, 'devolveu null — o lembrete vencido ficaria como está');
  assert.ok(Date.parse(novo) > AGORA, `continuou no passado: ${novo}`);
  // 09:00 BRT (12:00Z) preservado, agora no dia 06/08
  assert.strictEqual(novo, '2026-08-06T12:00:00.000Z');
});

test('TAREFA: remind_at futuro segue o delta em dias, sem recalcular', () => {
  const novo = shiftTaskRemindAt('2026-08-05', '2026-08-07', '2026-08-05T12:00:00Z', AGORA);
  assert.strictEqual(novo, '2026-08-07T12:00:00.000Z');
});

test('TAREFA: delta zero continua sendo no-op', () => {
  assert.strictEqual(shiftTaskRemindAt('2026-08-06', '2026-08-06', '2026-06-20T12:00:00Z', AGORA), null);
});

// ── Crivo do Alfredo (05/08): tarefa SEM remind_at não pode ganhar lembrete ────
// O piso corrige quem existe e está vencido. Não pode INVENTAR lembrete pra tarefa que
// nunca teve — isso viraria cobrança nova onde a pessoa não pediu nenhuma.
test('tarefa SEM remind_at: reagendar não cria lembrete nenhum', () => {
  assert.strictEqual(shiftTaskRemindAt('2026-08-04', '2026-08-06', null, AGORA), null);
  assert.strictEqual(shiftTaskRemindAt('2026-08-04', '2026-08-06', undefined, AGORA), null);
  assert.strictEqual(shiftTaskRemindAt('2026-08-04', '2026-08-06', '', AGORA), null);
});

test('tarefa sem due ANTIGO: sem delta calculável, não inventa horário', () => {
  assert.strictEqual(shiftTaskRemindAt(null, '2026-08-06', '2026-06-20T12:00:00Z', AGORA), null);
});

// O piso é sobre a NOVA DATA ser futura — e não sobre "agora". Este par prova a
// diferença: mesmo lembrete vencido, mesma hora de referência, novas datas opostas.
test('piso olha a NOVA DATA: futura → recalcula; passada → mantém o delta', () => {
  const vencido = '2026-06-20T12:00:00Z';
  const paraFrente = shiftTaskRemindAt('2026-08-04', '2026-08-06', vencido, AGORA);
  const paraTras   = shiftTaskRemindAt('2026-08-04', '2026-06-25', vencido, AGORA);
  assert.strictEqual(paraFrente, '2026-08-06T12:00:00.000Z');   // protegido
  assert.ok(Date.parse(paraTras) < AGORA, 'retroativo não pode virar lembrete futuro');
});
