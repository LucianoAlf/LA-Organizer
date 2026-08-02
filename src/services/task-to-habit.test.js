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

function makeDb({ tasks = [], habits = [], reminders = [], events = [] } = {}) {
  const store = { tasks, habits, habit_reminders: reminders };
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
      if (st.op === 'update') {
        rows.forEach((r) => { Object.assign(r, st.patch); events.push({ kind: 'update', table: tableName, id: r.id, patch: st.patch }); });
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
      maybeSingle() { return resolve().then((r) => ({ data: (r.data || [])[0] || null, error: null })); },
      single() { return resolve().then((r) => ({ data: (r.data || [])[0] || null, error: null })); },
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
  const habits = [{ id: 'h-old', collaborator_id: OWNER, name: 'Mensagem de Aniversário', is_active: true, frequency: 'daily', custom_days: null }];
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
  const habits = [{ id: 'h-old', collaborator_id: OWNER, name: 'Alongar', is_active: true }];
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
