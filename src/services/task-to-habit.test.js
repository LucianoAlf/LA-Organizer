'use strict';
// Conversão tarefa recorrente → hábito (Arthur, 02/08). Mock encadeável do supabase-js
// cobrindo tasks + habits + habit_reminders, porque a conversão é atômica-por-efeito:
// ou cria o lembrete E encerra a série, ou não mexe em NADA (falha honesta).
const assert = require('node:assert');
const { test } = require('node:test');

// O encerramento da série é o endSeries1on1 REAL (recurrence-engine), rodando sobre o
// mock — é o efeito que mais importa provar. Esse módulo arrasta o client global, que
// só valida env na carga (createClient não conecta). Env de fachada mantém o teste
// rodando em qualquer máquina, inclusive na VPS.
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';
process.env.UAZAPI_URL = process.env.UAZAPI_URL || 'http://localhost:9999';
process.env.UAZAPI_TOKEN = process.env.UAZAPI_TOKEN || 'test-token';

const { convertTaskToHabit, normalizeHabitTime, describeSchedule, renderConversionResult } = require('./task-to-habit');

// ---------- rodapé factual ----------
test('rodapé de sucesso carrega dias, horário e o que foi encerrado', () => {
  const s = renderConversionResult({
    ok: true, cancelled: 3,
    habit: { name: 'Verificar presenças do dia anterior', frequency: 'custom_days', custom_days: [1, 2, 3, 4, 5, 6], time: '08:30' },
  });
  assert.ok(s.includes('de seg a sáb'));
  assert.ok(s.includes('08:30'));
  assert.ok(s.includes('Não te cobro mais essa'));
  assert.ok(s.includes('Encerrei as 3 tarefas'));
});

test('rodapé avisa quando o horário foi assumido por padrão', () => {
  const s = renderConversionResult({ ok: true, cancelled: 0, timeWasDefaulted: true, habit: { name: 'X', frequency: 'daily', custom_days: null, time: '09:00' } });
  assert.ok(s.includes('horário padrão'));
  assert.ok(!s.includes('Encerrei as'));
});

test('falha vira recado honesto, um por motivo', () => {
  assert.ok(renderConversionResult({ ok: false, reason: 'not_found' }).includes('não achei'));
  assert.ok(renderConversionResult({ ok: false, reason: 'ambiguous', candidates: [{ title: 'A' }, { title: 'B' }] }).includes('*A* / *B*'));
  assert.ok(renderConversionResult({ ok: false, reason: 'unsupported_recurrence' }).includes('não consigo converter'));
  assert.ok(renderConversionResult({ ok: false, reason: 'db_error' }).includes('tenta de novo'));
  assert.strictEqual(renderConversionResult(null), '');
});

// ---------- descrição do calendário (o que o TOM fala tem que ser o que foi gravado) ----------
test('describeSchedule traduz o que está no banco', () => {
  assert.strictEqual(describeSchedule('daily', null), 'todo dia');
  assert.strictEqual(describeSchedule('weekdays', null), 'de segunda a sexta');
  assert.strictEqual(describeSchedule('custom_days', [1, 2, 3, 4, 5, 6]), 'de seg a sáb');
  assert.strictEqual(describeSchedule('custom_days', [6]), 'todo sábado');
  assert.strictEqual(describeSchedule('custom_days', [1]), 'toda segunda');
  assert.strictEqual(describeSchedule('custom_days', [1, 3, 5]), 'seg, qua e sex');
  assert.strictEqual(describeSchedule('custom_days', [6, 7]), 'de sáb a dom');
  assert.strictEqual(describeSchedule('custom_days', []), '');
  assert.strictEqual(describeSchedule('custom_days', null), '');
});

// `fail` injeta falha por (tabela, operação):
//   {tasks: 'update'}        → update em tasks não tem efeito e devolve erro
//   {tasks: 'update_silent'} → update NÃO tem efeito mas devolve sucesso (o caso REAL:
//                              endSeries1on1 não checa erro, então falha silenciosa é
//                              indistinguível de sucesso pra quem confia no retorno)
function makeDb({ tasks = [], habits = [], reminders = [], events = [], fail = {}, selectFailsAfterEnd = false } = {}) {
  const store = { tasks, habits, habit_reminders: reminders };
  const ctl = { selectFailsAfterEnd, ended: false };
  let seq = 0;
  function builder(tableName) {
    const st = { f: {}, op: 'select' };
    const rowsOf = () => store[tableName] || [];
    function match(r) {
      for (const [k, v] of Object.entries(st.f)) {
        if (k.startsWith('__')) continue;
        if (r[k] !== v) return false;
      }
      if (st.f.__notnull) for (const c of st.f.__notnull) if (r[c] === null || r[c] === undefined) return false;
      if (st.f.__isnull) for (const c of st.f.__isnull) if (r[c] !== null && r[c] !== undefined) return false;
      if (st.f.__notin) for (const [c, vals] of st.f.__notin) if (vals.includes(r[c])) return false;
      return true;
    }
    function resolve() {
      const rows = rowsOf().filter(match);
      // A1: falha de LEITURA que só começa DEPOIS do encerramento gravar. Reproduz o caso
      // real "o update foi, a releitura caiu" — o único em que rollback destrói de verdade.
      if (ctl.selectFailsAfterEnd && ctl.ended && tableName === 'tasks' && st.op === 'select') {
        return Promise.resolve({ data: null, error: { message: 'leitura indisponível (simulada)' } });
      }
      const modo = fail[tableName];
      if (modo && (modo === st.op || modo === `${st.op}_silent`)) {
        events.push({ kind: 'blocked', table: tableName, op: st.op });
        return Promise.resolve(modo.endsWith('_silent')
          ? { data: [], error: null }                                   // mente: diz que foi
          : { data: null, error: { message: `falha simulada em ${tableName}.${st.op}` } });
      }
      if (st.op === 'update') {
        if (tableName === 'tasks' && 'series_ended_at' in st.patch) ctl.ended = true;
        rows.forEach((r) => { Object.assign(r, st.patch); events.push({ kind: 'update', table: tableName, id: r.id, patch: st.patch }); });
        return Promise.resolve({ data: rows.map((r) => ({ id: r.id })), error: null });
      }
      if (st.op === 'delete') {
        const ids = new Set(rows.map((r) => r.id));
        const arr = rowsOf();
        for (let i = arr.length - 1; i >= 0; i--) if (ids.has(arr[i].id)) arr.splice(i, 1);
        events.push({ kind: 'delete', table: tableName, ids: [...ids] });
        return Promise.resolve({ data: rows.map((r) => ({ id: r.id })), error: null });
      }
      if (st.op === 'insert') {
        const list = Array.isArray(st.row) ? st.row : [st.row];
        const made = list.map((row) => {
          const r = { id: `${tableName}-new-${++seq}`, ...row };
          rowsOf().push(r); events.push({ kind: 'insert', table: tableName, row: r });
          return r;
        });
        return Promise.resolve({ data: made, error: null });
      }
      return Promise.resolve({ data: rows, error: null });
    }
    const b = {
      select() { return b; },
      eq(c, v) { st.f[c] = v; return b; },
      is(c, v) { if (v === null) (st.f.__isnull = st.f.__isnull || []).push(c); return b; },
      not(c, op, v) {
        if (op === 'is' && v === null) (st.f.__notnull = st.f.__notnull || []).push(c);
        if (op === 'in') {
          const vals = String(v).replace(/[()"']/g, '').split(',').map((s) => s.trim());
          (st.f.__notin = st.f.__notin || []).push([c, vals]);
        }
        return b;
      },
      order() { return b; },
      limit() { return b; },
      update(patch) { st.op = 'update'; st.patch = patch; return b; },
      insert(row) { st.op = 'insert'; st.row = row; return b; },
      delete() { st.op = 'delete'; return b; },
      maybeSingle() { return resolve().then((r) => ({ data: (r.data || [])[0] || null, error: r.error || null })); },
      single() { return resolve().then((r) => ({ data: (r.data || [])[0] || null, error: r.error || null })); },
      then(res, rej) { return resolve().then(res, rej); },
    };
    return b;
  }
  return { from: (t) => builder(t) };
}

const OWNER = 'collab-arthur';
const T = (extra) => ({
  assigned_to: OWNER, status: 'pending', recurrence_rule: null, recurrence_parent_id: null,
  series_ended_at: null, due_time: null, due_date: '2026-08-03', ...extra,
});

// ---------- horário ----------
test('normalizeHabitTime respeita o CHECK do banco (HH:MM com zero à esquerda)', () => {
  assert.strictEqual(normalizeHabitTime('9:00'), '09:00');   // "9:00" viola o CHECK → precisa virar 09:00
  assert.strictEqual(normalizeHabitTime('09:00'), '09:00');
  assert.strictEqual(normalizeHabitTime('10:00:00'), '10:00');
  assert.strictEqual(normalizeHabitTime('23:59'), '23:59');
  assert.strictEqual(normalizeHabitTime('24:00'), null);
  assert.strictEqual(normalizeHabitTime('abc'), null);
  assert.strictEqual(normalizeHabitTime(null), null);
});

// ---------- caminho feliz ----------
test('caso REAL do Arthur: seg-sáb vira hábito custom_days e a série morre', async () => {
  const events = [];
  const tasks = [
    T({ id: 'tpl', title: 'Verificar presenças do dia anterior', recurrence_rule: 'FREQ=WEEKLY;BYDAY=MO,TU,TH,WE,FR,SA' }),
    T({ id: 'i1', title: 'Verificar presenças do dia anterior', recurrence_parent_id: 'tpl' }),
    T({ id: 'i2', title: 'Verificar presenças do dia anterior', recurrence_parent_id: 'tpl' }),
    T({ id: 'i3', title: 'Verificar presenças do dia anterior', recurrence_parent_id: 'tpl', status: 'done' }),
  ];
  const db = makeDb({ tasks, events });
  const r = await convertTaskToHabit({
    supabase: db, collaboratorId: OWNER, taskTitle: 'verificar presenças do dia anterior', reminderTime: '08:30',
  });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.habit.frequency, 'custom_days');
  assert.deepStrictEqual(r.habit.custom_days, [1, 2, 3, 4, 5, 6]);
  assert.strictEqual(r.habit.time, '08:30');
  assert.strictEqual(r.reusedHabit, false);
  // série encerrada + instâncias abertas canceladas; a done fica intocada
  assert.strictEqual(tasks.find((t) => t.id === 'tpl').series_ended_at != null, true);
  assert.strictEqual(tasks.find((t) => t.id === 'i1').status, 'cancelled');
  assert.strictEqual(tasks.find((t) => t.id === 'i3').status, 'done');
  assert.strictEqual(r.cancelled, 3); // molde + i1 + i2
  // o lembrete existe de fato
  const rem = events.filter((e) => e.kind === 'insert' && e.table === 'habit_reminders');
  assert.strictEqual(rem.length, 1);
  assert.strictEqual(rem[0].row.time, '08:30');
});

test('sem horário informado usa o due_time da tarefa', async () => {
  const tasks = [T({ id: 'tpl', title: 'Conferir caixa', recurrence_rule: 'FREQ=DAILY', due_time: '7:15:00' })];
  const r = await convertTaskToHabit({ supabase: makeDb({ tasks }), collaboratorId: OWNER, taskTitle: 'Conferir caixa' });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.habit.frequency, 'daily');
  assert.strictEqual(r.habit.time, '07:15');
});

test('sem horário nenhum cai no default 09:00 (e diz que foi default)', async () => {
  const tasks = [T({ id: 'tpl', title: 'Conferir caixa', recurrence_rule: 'FREQ=DAILY' })];
  const r = await convertTaskToHabit({ supabase: makeDb({ tasks }), collaboratorId: OWNER, taskTitle: 'Conferir caixa' });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.habit.time, '09:00');
  assert.strictEqual(r.timeWasDefaulted, true);
});

test('WEEKLY sem BYDAY ancora no dia da semana do due_date (2026-08-03 = segunda)', async () => {
  const tasks = [T({ id: 'tpl', title: 'Reunião semanal', recurrence_rule: 'FREQ=WEEKLY', due_date: '2026-08-03' })];
  const r = await convertTaskToHabit({ supabase: makeDb({ tasks }), collaboratorId: OWNER, taskTitle: 'Reunião semanal' });
  assert.strictEqual(r.ok, true);
  assert.deepStrictEqual(r.habit.custom_days, [1]);
});

// ---------- idempotência ----------
test('hábito com o mesmo nome é REUSADO, não duplicado', async () => {
  const events = [];
  const tasks = [T({ id: 'tpl', title: 'Mensagem de aniversário', recurrence_rule: 'FREQ=DAILY' })];
  const habits = [{ id: 'h-old', collaborator_id: OWNER, name: 'Mensagem de Aniversário', is_active: true, notify_whatsapp: true, frequency: 'daily', custom_days: null }];
  const r = await convertTaskToHabit({ supabase: makeDb({ tasks, habits, events }), collaboratorId: OWNER, taskTitle: 'Mensagem de aniversário', reminderTime: '10:00' });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.reusedHabit, true);
  assert.strictEqual(r.habit.id, 'h-old');
  assert.strictEqual(events.filter((e) => e.kind === 'insert' && e.table === 'habits').length, 0);
  assert.strictEqual(tasks[0].series_ended_at != null, true); // a série morre do mesmo jeito
});

test('lembrete no mesmo horário não é duplicado', async () => {
  const events = [];
  const tasks = [T({ id: 'tpl', title: 'Alongar', recurrence_rule: 'FREQ=DAILY' })];
  const habits = [{ id: 'h-old', collaborator_id: OWNER, name: 'Alongar', is_active: true, notify_whatsapp: true, frequency: 'daily', custom_days: null }];
  const reminders = [{ id: 'r1', habit_id: 'h-old', time: '10:00' }];
  const r = await convertTaskToHabit({ supabase: makeDb({ tasks, habits, reminders, events }), collaboratorId: OWNER, taskTitle: 'Alongar', reminderTime: '10:00' });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(events.filter((e) => e.kind === 'insert' && e.table === 'habit_reminders').length, 0);
});

// ---------- falhas HONESTAS: nada é criado, nada é cancelado ----------
test('alvo não encontrado → not_found, sem efeito colateral', async () => {
  const events = [];
  const tasks = [T({ id: 'tpl', title: 'Outra coisa', recurrence_rule: 'FREQ=DAILY' })];
  const r = await convertTaskToHabit({ supabase: makeDb({ tasks, events }), collaboratorId: OWNER, taskTitle: 'Verificar presenças' });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.reason, 'not_found');
  assert.strictEqual(events.length, 0);
  assert.strictEqual(tasks[0].series_ended_at, null);
});

test('dois moldes casam → ambiguous com as opções, sem efeito colateral', async () => {
  const events = [];
  const tasks = [
    T({ id: 'a', title: 'Mensagem de aniversário', recurrence_rule: 'FREQ=WEEKLY;BYDAY=SA' }),
    T({ id: 'b', title: 'Mensagem de aniversário', recurrence_rule: 'FREQ=WEEKLY;BYDAY=MO' }),
  ];
  const r = await convertTaskToHabit({ supabase: makeDb({ tasks, events }), collaboratorId: OWNER, taskTitle: 'Mensagem de aniversário' });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.reason, 'ambiguous');
  assert.strictEqual(r.candidates.length, 2);
  assert.strictEqual(events.length, 0);
});

test('recorrência sem equivalente (mensal) → unsupported_recurrence, sem efeito colateral', async () => {
  const events = [];
  const tasks = [T({ id: 'tpl', title: 'Fechar mês', recurrence_rule: 'FREQ=MONTHLY;BYMONTHDAY=5' })];
  const r = await convertTaskToHabit({ supabase: makeDb({ tasks, events }), collaboratorId: OWNER, taskTitle: 'Fechar mês' });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.reason, 'unsupported_recurrence');
  assert.strictEqual(events.length, 0);
  assert.strictEqual(tasks[0].series_ended_at, null);
});

test('tarefa NÃO recorrente não é convertida (lembrete recorrente exige série)', async () => {
  const tasks = [T({ id: 'tpl', title: 'Ligar pro contador' })];
  const r = await convertTaskToHabit({ supabase: makeDb({ tasks }), collaboratorId: OWNER, taskTitle: 'Ligar pro contador' });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.reason, 'not_found');
});

test('série já encerrada não é alvo', async () => {
  const tasks = [T({ id: 'tpl', title: 'Conferir caixa', recurrence_rule: 'FREQ=DAILY', series_ended_at: '2026-07-01T00:00:00Z' })];
  const r = await convertTaskToHabit({ supabase: makeDb({ tasks }), collaboratorId: OWNER, taskTitle: 'Conferir caixa' });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.reason, 'not_found');
});

test('não converte tarefa de OUTRA pessoa', async () => {
  const tasks = [T({ id: 'tpl', title: 'Conferir caixa', recurrence_rule: 'FREQ=DAILY', assigned_to: 'outra-pessoa' })];
  const r = await convertTaskToHabit({ supabase: makeDb({ tasks }), collaboratorId: OWNER, taskTitle: 'Conferir caixa' });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.reason, 'not_found');
});

test('sem alvo informado → missing_target', async () => {
  const r = await convertTaskToHabit({ supabase: makeDb({}), collaboratorId: OWNER });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.reason, 'missing_target');
});

// ---------- ATOMICIDADE (contraponto do Alfredo, 02/08) ----------
// Sem transação no Supabase REST, a garantia tem que ser: escreve → relê → se não bateu,
// desfaz o que criou. O cenário perigoso não é o erro barulhento: é o encerramento que
// FALHA EM SILÊNCIO (endSeries1on1 devolve {ended:true} sem checar erro nenhum).

test('encerramento falha em SILÊNCIO → desfaz o lembrete e volta ao estado inicial', async () => {
  const events = [];
  const tasks = [
    T({ id: 'tpl', title: 'Conferir caixa', recurrence_rule: 'FREQ=DAILY' }),
    T({ id: 'i1', title: 'Conferir caixa', recurrence_parent_id: 'tpl' }),
  ];
  const r = await convertTaskToHabit({
    supabase: makeDb({ tasks, events, fail: { tasks: 'update_silent' } }),
    collaboratorId: OWNER, taskTitle: 'Conferir caixa', reminderTime: '09:00',
  });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.reason, 'series_end_failed');
  // nada de estado meio convertido: hábito e lembrete que ELE criou não existem mais
  assert.deepStrictEqual(r.rolledBack.residue, []);
  assert.strictEqual(r.rolledBack.undone.includes('hábito'), true);
  // e a rotina segue exatamente como estava — ainda cobrando, nada perdido
  assert.strictEqual(tasks.find((t) => t.id === 'tpl').series_ended_at, null);
  assert.strictEqual(tasks.find((t) => t.id === 'i1').status, 'pending');
});

test('depois do rollback o banco não tem hábito nem lembrete órfão', async () => {
  const events = [];
  const habits = []; const reminders = [];
  const tasks = [T({ id: 'tpl', title: 'Conferir caixa', recurrence_rule: 'FREQ=DAILY' })];
  await convertTaskToHabit({
    supabase: makeDb({ tasks, habits, reminders, events, fail: { tasks: 'update_silent' } }),
    collaboratorId: OWNER, taskTitle: 'Conferir caixa',
  });
  assert.strictEqual(habits.length, 0, 'sobrou hábito órfão');
  assert.strictEqual(reminders.length, 0, 'sobrou lembrete órfão');
});

test('hábito REUSADO não é apagado no rollback — não é meu pra apagar', async () => {
  const events = [];
  const tasks = [T({ id: 'tpl', title: 'Alongar', recurrence_rule: 'FREQ=DAILY' })];
  const habits = [{ id: 'h-old', collaborator_id: OWNER, name: 'Alongar', is_active: true, notify_whatsapp: true, frequency: 'daily', custom_days: null }];
  const reminders = [{ id: 'r-old', habit_id: 'h-old', time: '07:00' }];
  const r = await convertTaskToHabit({
    supabase: makeDb({ tasks, habits, reminders, events, fail: { tasks: 'update_silent' } }),
    collaboratorId: OWNER, taskTitle: 'Alongar', reminderTime: '09:00',
  });
  assert.strictEqual(r.reason, 'series_end_failed');
  assert.strictEqual(habits.length, 1, 'apagou hábito que já existia');
  assert.strictEqual(habits[0].id, 'h-old');
  // o lembrete PREEXISTENTE fica; só o que este serviço criou (09:00) sai
  assert.deepStrictEqual(reminders.map((x) => x.time), ['07:00']);
});

test('lembrete falha → hábito recém-criado é removido e a rotina não é tocada', async () => {
  const events = [];
  const habits = [];
  const tasks = [T({ id: 'tpl', title: 'Conferir caixa', recurrence_rule: 'FREQ=DAILY' })];
  const r = await convertTaskToHabit({
    supabase: makeDb({ tasks, habits, events, fail: { habit_reminders: 'insert' } }),
    collaboratorId: OWNER, taskTitle: 'Conferir caixa',
  });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.reason, 'reminder_failed');
  assert.strictEqual(habits.length, 0, 'hábito mudo ficou no banco');
  assert.strictEqual(tasks[0].series_ended_at, null, 'mexeu na rotina mesmo sem lembrete');
});

test('rollback que também falha reporta RESÍDUO em vez de engolir', async () => {
  const events = [];
  const tasks = [T({ id: 'tpl', title: 'Conferir caixa', recurrence_rule: 'FREQ=DAILY' })];
  const r = await convertTaskToHabit({
    supabase: makeDb({ tasks, events, fail: { tasks: 'update_silent', habits: 'delete' } }),
    collaboratorId: OWNER, taskTitle: 'Conferir caixa',
  });
  assert.strictEqual(r.reason, 'series_end_failed');
  assert.ok(r.rolledBack.residue.length > 0, 'resíduo foi engolido');
  // e o texto avisa a pessoa em vez de dizer que está tudo certo
  assert.ok(renderConversionResult(r).includes('os dois hoje'));
});

test('sucesso carrega a medição antes/depois', async () => {
  const tasks = [
    T({ id: 'tpl', title: 'Conferir caixa', recurrence_rule: 'FREQ=DAILY' }),
    T({ id: 'i1', title: 'Conferir caixa', recurrence_parent_id: 'tpl' }),
    T({ id: 'i2', title: 'Conferir caixa', recurrence_parent_id: 'tpl' }),
    T({ id: 'outra', title: 'Tarefa avulsa de outra coisa' }),
  ];
  const r = await convertTaskToHabit({ supabase: makeDb({ tasks }), collaboratorId: OWNER, taskTitle: 'Conferir caixa' });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.before.serieAberta, 3);   // molde + 2 instâncias
  assert.strictEqual(r.after.serieAberta, 0);
  assert.strictEqual(r.before.totalAberto, 4);
  assert.strictEqual(r.after.totalAberto, 1);    // a avulsa continua, não é escopo
  assert.strictEqual(r.after.seriesEnded, true);
});

test('texto de falha nunca afirma conversão', () => {
  for (const reason of ['series_end_failed', 'reminder_failed', 'habit_not_verified']) {
    const s = renderConversionResult({ ok: false, reason, rolledBack: { undone: [], residue: [] } });
    assert.ok(!/virou lembrete/i.test(s), `"${reason}" afirmou conversão`);
    assert.ok(!/não te cobro mais/i.test(s), `"${reason}" prometeu parar de cobrar`);
  }
});

// ================= AUDITORIA CRUZADA — Alfredo, rodada 1 (03/08) =================
// Os três achados dele, cada um com o teste que faltava. Escritos ANTES da correção.

// ---------- A1: releitura indisponível não pode virar rollback destrutivo ----------
// Cenário: o encerramento GRAVOU, mas a leitura seguinte cai (rede/RLS). Hoje measure()
// devolve a fotografia padrão {seriesEnded:false, serieAberta:0}, o código lê isso como
// "falhou" e apaga o hábito — sem reabrir a série. Fica sem cobrança E sem lembrete:
// pior que o estado inicial, e o oposto do que o texto promete.
test('A1 — releitura cai depois do encerramento: NÃO destrói o lembrete', async () => {
  const events = [];
  const habits = []; const reminders = [];
  const tasks = [
    T({ id: 'tpl', title: 'Conferir caixa', recurrence_rule: 'FREQ=DAILY' }),
    T({ id: 'i1', title: 'Conferir caixa', recurrence_parent_id: 'tpl' }),
  ];
  const r = await convertTaskToHabit({
    supabase: makeDb({ tasks, habits, reminders, events, selectFailsAfterEnd: true }),
    collaboratorId: OWNER, taskTitle: 'Conferir caixa', reminderTime: '09:00',
  });
  // a série FOI encerrada de fato — o mock aplicou os updates antes da leitura cair
  assert.strictEqual(tasks.find((t) => t.id === 'tpl').series_ended_at != null, true);
  // logo, apagar o hábito deixaria a pessoa sem nada. Não pode acontecer.
  assert.strictEqual(habits.length, 1, 'apagou o hábito com a série já encerrada');
  assert.strictEqual(reminders.length, 1, 'apagou o lembrete com a série já encerrada');
  assert.strictEqual(r.reason, 'verification_unavailable');
  assert.strictEqual(r.ok, false);
});

test('A1 — verificação indisponível diz a verdade: não afirma sucesso nem promete desfeito', () => {
  const s = renderConversionResult({ ok: false, reason: 'verification_unavailable' });
  assert.ok(!/virou lembrete/i.test(s), 'afirmou conversão sem saber');
  assert.ok(!/(então|e) desfiz|desfiz pra/i.test(s), 'prometeu rollback que não houve');
  assert.ok(/não desfiz/i.test(s), 'não deixou claro que nada foi desfeito');
  assert.ok(/confirmar|verificar|conferir/i.test(s), 'não avisou que não conseguiu confirmar');
});

// ---------- A2: lembrete inativo não conta como lembrete ----------
// O dispatcher só dispara habit_reminders.is_active = true. Uma linha inativa no mesmo
// horário bloqueava o insert E passava na verificação → série encerrada, ninguém lembrado.
test('A2 — lembrete INATIVO no mesmo horário é reativado (não passa como se valesse)', async () => {
  const events = [];
  const tasks = [T({ id: 'tpl', title: 'Alongar', recurrence_rule: 'FREQ=DAILY' })];
  const habits = [{ id: 'h1', collaborator_id: OWNER, name: 'Alongar', is_active: true, notify_whatsapp: true, frequency: 'daily', custom_days: null }];
  const reminders = [{ id: 'r-morto', habit_id: 'h1', time: '09:00', is_active: false }];
  const r = await convertTaskToHabit({
    supabase: makeDb({ tasks, habits, reminders, events }),
    collaboratorId: OWNER, taskTitle: 'Alongar', reminderTime: '09:00',
  });
  assert.strictEqual(r.ok, true, r.reason);
  const ativos = reminders.filter((x) => x.is_active !== false && String(x.time).slice(0, 5) === '09:00');
  assert.strictEqual(ativos.length, 1, 'ficou sem lembrete ATIVO às 09:00');
});

test('A2 — se o encerramento falhar depois de reativar, o lembrete volta a ficar inativo', async () => {
  const events = [];
  const tasks = [T({ id: 'tpl', title: 'Alongar', recurrence_rule: 'FREQ=DAILY' })];
  const habits = [{ id: 'h1', collaborator_id: OWNER, name: 'Alongar', is_active: true, notify_whatsapp: true, frequency: 'daily', custom_days: null }];
  const reminders = [{ id: 'r-morto', habit_id: 'h1', time: '09:00', is_active: false }];
  const r = await convertTaskToHabit({
    supabase: makeDb({ tasks, habits, reminders, events, fail: { tasks: 'update_silent' } }),
    collaboratorId: OWNER, taskTitle: 'Alongar', reminderTime: '09:00',
  });
  assert.strictEqual(r.reason, 'series_end_failed');
  assert.strictEqual(reminders.find((x) => x.id === 'r-morto').is_active, false, 'deixou o lembrete ligado sem converter');
});

// ---------- A3: reuso por nome não pode herdar calendário divergente em silêncio ----------
// Tarefa semanal (segunda) + hábito prévio de mesmo nome, diário. Hoje reusa o diário,
// encerra a tarefa e anuncia "toda segunda" — calendário que não existe em lugar nenhum.
test('A3 — hábito de mesmo nome com calendário DIFERENTE vira conflito, não reuso mudo', async () => {
  const events = [];
  const tasks = [T({ id: 'tpl', title: 'Revisar agenda', recurrence_rule: 'FREQ=WEEKLY;BYDAY=MO' })];
  const habits = [{ id: 'h1', collaborator_id: OWNER, name: 'Revisar agenda', is_active: true, notify_whatsapp: true, frequency: 'daily', custom_days: null }];
  const r = await convertTaskToHabit({
    supabase: makeDb({ tasks, habits, events }), collaboratorId: OWNER, taskTitle: 'Revisar agenda',
  });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.reason, 'habit_conflict');
  assert.strictEqual(tasks[0].series_ended_at, null, 'encerrou a tarefa apesar do conflito');
  // e o texto mostra os DOIS calendários pra pessoa decidir
  const s = renderConversionResult(r);
  assert.ok(/todo dia/.test(s), 'não mostrou o calendário do lembrete que já existe');
  assert.ok(/toda segunda/.test(s), 'não mostrou o calendário da rotina');
});

test('A3 — calendário equivalente em dialeto diferente ainda é reuso (não vira conflito à toa)', async () => {
  const tasks = [T({ id: 'tpl', title: 'Alongar', recurrence_rule: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR' })];
  // 'weekly' + dias explícitos é o mesmo que 'weekdays' — dialeto legado do banco
  const habits = [{ id: 'h1', collaborator_id: OWNER, name: 'Alongar', is_active: true, notify_whatsapp: true, frequency: 'weekly', custom_days: [1, 2, 3, 4, 5] }];
  const r = await convertTaskToHabit({ supabase: makeDb({ tasks, habits }), collaboratorId: OWNER, taskTitle: 'Alongar' });
  assert.strictEqual(r.ok, true, r.reason);
  assert.strictEqual(r.reusedHabit, true);
});

test('A3 — no reuso, o texto usa o calendário DO HÁBITO (o que está salvo), não o da tarefa', async () => {
  const tasks = [T({ id: 'tpl', title: 'Alongar', recurrence_rule: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR' })];
  const habits = [{ id: 'h1', collaborator_id: OWNER, name: 'Alongar', is_active: true, notify_whatsapp: true, frequency: 'weekly', custom_days: [1, 2, 3, 4, 5] }];
  const r = await convertTaskToHabit({ supabase: makeDb({ tasks, habits }), collaboratorId: OWNER, taskTitle: 'Alongar' });
  assert.strictEqual(r.ok, true);
  // o hábito está gravado como weekly+[1..5]; o texto tem que descrever ISSO
  assert.strictEqual(r.habit.frequency, 'weekly');
  assert.deepStrictEqual(r.habit.custom_days, [1, 2, 3, 4, 5]);
  assert.ok(/de seg a sex/.test(renderConversionResult(r)));
});

// ================= AUDITORIA CRUZADA — Alfredo, rodada 2 (03/08) =================

// ---------- A3 (reaberto): a pergunta precisa ter execução do outro lado ----------
// "mantenho como está ou ajusto?" sem handler = loop honesto: não estraga dado, mas nunca
// resolve. Mesma armadilha do FIN-MSG-PROMETE-PREVIA: mensagem que ensina comando É
// contrato. Ou a escolha executa, ou a pergunta não pode ser feita.
test('A3.1 — on_conflict "keep_habit": mantém o calendário do lembrete e encerra a série', async () => {
  const tasks = [
    T({ id: 'tpl', title: 'Revisar agenda', recurrence_rule: 'FREQ=WEEKLY;BYDAY=MO' }),
    T({ id: 'i1', title: 'Revisar agenda', recurrence_parent_id: 'tpl' }),
  ];
  const habits = [{ id: 'h1', collaborator_id: OWNER, name: 'Revisar agenda', is_active: true, notify_whatsapp: true, frequency: 'daily', custom_days: null }];
  const r = await convertTaskToHabit({
    supabase: makeDb({ tasks, habits }), collaboratorId: OWNER, taskTitle: 'Revisar agenda', onConflict: 'keep_habit',
  });
  assert.strictEqual(r.ok, true, r.reason);
  assert.strictEqual(habits[0].frequency, 'daily', 'mexeu no hábito que a pessoa mandou manter');
  assert.strictEqual(tasks[0].series_ended_at != null, true, 'não encerrou a série');
  assert.strictEqual(r.habit.frequency, 'daily');
  assert.ok(/todo dia/.test(renderConversionResult(r)), 'texto não descreve o calendário mantido');
});

test('A3.2 — on_conflict "adjust_habit": alinha o lembrete ao calendário da rotina', async () => {
  const tasks = [T({ id: 'tpl', title: 'Revisar agenda', recurrence_rule: 'FREQ=WEEKLY;BYDAY=MO' })];
  const habits = [{ id: 'h1', collaborator_id: OWNER, name: 'Revisar agenda', is_active: true, notify_whatsapp: true, frequency: 'daily', custom_days: null }];
  const r = await convertTaskToHabit({
    supabase: makeDb({ tasks, habits }), collaboratorId: OWNER, taskTitle: 'Revisar agenda', onConflict: 'adjust_habit',
  });
  assert.strictEqual(r.ok, true, r.reason);
  assert.strictEqual(habits[0].frequency, 'custom_days');
  assert.deepStrictEqual(habits[0].custom_days, [1]);
  assert.ok(/toda segunda/.test(renderConversionResult(r)));
});

test('A3.3 — ajuste que aborta depois devolve o calendário original do hábito', async () => {
  const tasks = [T({ id: 'tpl', title: 'Revisar agenda', recurrence_rule: 'FREQ=WEEKLY;BYDAY=MO' })];
  const habits = [{ id: 'h1', collaborator_id: OWNER, name: 'Revisar agenda', is_active: true, notify_whatsapp: true, frequency: 'daily', custom_days: null }];
  const r = await convertTaskToHabit({
    supabase: makeDb({ tasks, habits, fail: { tasks: 'update_silent' } }),
    collaboratorId: OWNER, taskTitle: 'Revisar agenda', onConflict: 'adjust_habit',
  });
  assert.strictEqual(r.reason, 'series_end_failed');
  assert.strictEqual(habits[0].frequency, 'daily', 'deixou o calendário alterado sem converter');
  assert.strictEqual(habits[0].custom_days, null);
});

test('A3.4 — a pergunta do conflito nomeia exatamente as duas saídas que existem', () => {
  const s = renderConversionResult({
    ok: false, reason: 'habit_conflict',
    habit: { name: 'Revisar agenda' },
    habitSchedule: { frequency: 'daily', custom_days: null },
    taskSchedule: { frequency: 'custom_days', custom_days: [1] },
  });
  assert.ok(/mantenho|manter/i.test(s) && /ajusto|ajustar/i.test(s), 'não oferece as duas saídas');
});

// ---------- C1: medição indisponível não pode se passar por 0 ----------
test('C1 — before que não pôde ser medido não vira "0→0"', async () => {
  const tasks = [T({ id: 'tpl', title: 'Conferir caixa', recurrence_rule: 'FREQ=DAILY' })];
  const r = await convertTaskToHabit({ supabase: makeDb({ tasks }), collaboratorId: OWNER, taskTitle: 'Conferir caixa' });
  assert.strictEqual(r.ok, true, r.reason);
  assert.strictEqual(r.before.ok, true, 'medição boa precisa se declarar boa');
  assert.strictEqual(r.after.ok, true);
});

// ---------- C2: erro de leitura do hábito ≠ "não existe" ----------
test('C2 — falha ao ler hábitos NÃO cria hábito novo (evita duplicata sob erro transitório)', async () => {
  const habits = [{ id: 'h1', collaborator_id: OWNER, name: 'Alongar', is_active: true, notify_whatsapp: true, frequency: 'daily', custom_days: null }];
  const tasks = [T({ id: 'tpl', title: 'Alongar', recurrence_rule: 'FREQ=DAILY' })];
  const r = await convertTaskToHabit({
    supabase: makeDb({ tasks, habits, fail: { habits: 'select' } }),
    collaboratorId: OWNER, taskTitle: 'Alongar',
  });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.reason, 'db_error');
  assert.strictEqual(habits.length, 1, 'duplicou o hábito por causa de erro de leitura');
  assert.strictEqual(tasks[0].series_ended_at, null);
});

// ---------- C3: frequência que o dispatcher não dispara ----------
// O CHECK do banco aceita 'custom', mas o inSchedule() do dispatcher só trata
// daily/weekdays/weekly/custom_days — 'custom' cai no return false e NUNCA toca.
test('C3 — não reusa hábito com frequência que o dispatcher ignora', async () => {
  const tasks = [T({ id: 'tpl', title: 'Alongar', recurrence_rule: 'FREQ=DAILY' })];
  const habits = [{ id: 'h1', collaborator_id: OWNER, name: 'Alongar', is_active: true, notify_whatsapp: true, frequency: 'custom', custom_days: [1, 2, 3, 4, 5, 6, 7] }];
  const r = await convertTaskToHabit({ supabase: makeDb({ tasks, habits }), collaboratorId: OWNER, taskTitle: 'Alongar' });
  assert.strictEqual(r.ok, false, 'reusou um lembrete que nunca dispara');
  assert.strictEqual(r.reason, 'habit_conflict');
  assert.strictEqual(tasks[0].series_ended_at, null);
});

test('C3 — adjust_habit conserta a frequência morta em vez de deixá-la lá', async () => {
  const tasks = [T({ id: 'tpl', title: 'Alongar', recurrence_rule: 'FREQ=DAILY' })];
  const habits = [{ id: 'h1', collaborator_id: OWNER, name: 'Alongar', is_active: true, notify_whatsapp: true, frequency: 'custom', custom_days: [1, 2, 3, 4, 5, 6, 7] }];
  const r = await convertTaskToHabit({
    supabase: makeDb({ tasks, habits }), collaboratorId: OWNER, taskTitle: 'Alongar', onConflict: 'adjust_habit',
  });
  assert.strictEqual(r.ok, true, r.reason);
  assert.strictEqual(habits[0].frequency, 'daily', 'deixou frequência que o dispatcher ignora');
});

test('C3 — nunca cria hábito com frequência fora do que o dispatcher dispara', async () => {
  const habits = [];
  const tasks = [T({ id: 'tpl', title: 'Nova rotina', recurrence_rule: 'FREQ=WEEKLY;BYDAY=SA' })];
  const r = await convertTaskToHabit({ supabase: makeDb({ tasks, habits }), collaboratorId: OWNER, taskTitle: 'Nova rotina' });
  assert.strictEqual(r.ok, true, r.reason);
  assert.ok(['daily', 'weekdays', 'weekly', 'custom_days'].includes(habits[0].frequency), habits[0].frequency);
});

// ---------- resolução por id e por título aproximado ----------
test('resolve por task_id quando o título vem diferente', async () => {
  const tasks = [T({ id: 'tpl-123', title: 'Verificar presenças do dia anterior', recurrence_rule: 'FREQ=DAILY' })];
  const r = await convertTaskToHabit({ supabase: makeDb({ tasks }), collaboratorId: OWNER, taskId: 'tpl-123', taskTitle: 'qualquer coisa' });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.template.id, 'tpl-123');
});

test('título parcial casa quando é o único candidato', async () => {
  const tasks = [T({ id: 'tpl', title: 'Verificar presenças do dia anterior', recurrence_rule: 'FREQ=DAILY' })];
  const r = await convertTaskToHabit({ supabase: makeDb({ tasks }), collaboratorId: OWNER, taskTitle: 'verificar presenças' });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.template.id, 'tpl');
});

test('título exato ganha do parcial (não vira ambíguo à toa)', async () => {
  const tasks = [
    T({ id: 'exato', title: 'Mensagem de aniversário', recurrence_rule: 'FREQ=DAILY' }),
    T({ id: 'longo', title: 'Mensagem de aniversário para alunos novos', recurrence_rule: 'FREQ=DAILY' }),
  ];
  const r = await convertTaskToHabit({ supabase: makeDb({ tasks }), collaboratorId: OWNER, taskTitle: 'Mensagem de aniversário' });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.template.id, 'exato');
});

// ---------- CONFAB-T2H-WEAK-CONFIRM (Dudu 21/08 18:31 BRT, finding fbb856ef) ----------
// "Quer que me lembre todos os dias" → o LLM emitiu <<TASK_TO_HABIT>>, a conversão devolveu
// not_found, e o engine appendou o rodapé honesto EMBAIXO da confirmação otimista. A pessoa
// leu as duas coisas na mesma mensagem e perguntou "Nome exato do que ?".
// O ramo de falha já chamava sanitizeOptimisticConfirm(x,'failed') — mas sem includeWeak, e
// "Fechou" é 3ª pessoa (WEAK_COMPLETION_RE), fora do COMPLETION_CORE. Mesma decisão que o
// respostaSemEdicaoDeHabito tomou em 10/08 (Bianca): quando o engine JÁ SABE que nada
// persistiu, confirmação fraca é tão falsa quanto verbo forte.
const { baseDeFalhaT2H } = require('./task-to-habit');

const FALA_DUDU = 'Fechou, Dudu! Viro em lembrete diário — te chamo todo dia. Não vai precisar ficar me pedindo.';

test('T2H que não persistiu nada não deixa confirmação fraca acima do rodapé honesto (Dudu 21/08)', () => {
  const out = baseDeFalhaT2H(FALA_DUDU);
  assert.ok(!/Fechou/i.test(out), `confirmação fraca sobreviveu: ${JSON.stringify(out)}`);
  assert.ok(!/Viro em lembrete/i.test(out), `promessa de conversão sobreviveu: ${JSON.stringify(out)}`);
});

test('T2H: fala sem confirmação nenhuma sobrevive inteira', () => {
  assert.strictEqual(baseDeFalhaT2H('Qual rotina exatamente?'), 'Qual rotina exatamente?');
  assert.strictEqual(baseDeFalhaT2H(''), '');
  assert.strictEqual(baseDeFalhaT2H(null), '');
});

// Caracterização da RAIZ: o sanitizador sem includeWeak devolve a mentira intacta. Fica
// pinado pra não confundir "o guard não tem o vocabulário" com "o caller não liga o gate".
test('T2H: a raiz é o gate desligado, não vocabulário ausente', () => {
  const { sanitizeOptimisticConfirm } = require('../lib/optimistic-confirm');
  assert.strictEqual(sanitizeOptimisticConfirm(FALA_DUDU, 'failed'), FALA_DUDU);
  assert.strictEqual(sanitizeOptimisticConfirm(FALA_DUDU, 'failed', { includeWeak: true }), '');
});
