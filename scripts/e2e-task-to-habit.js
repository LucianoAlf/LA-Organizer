#!/usr/bin/env node
// E2E de <<TASK_TO_HABIT>> contra o banco REAL — versionado a pedido da auditoria cruzada
// (Alfredo, B3: "a prova precisa ser repetível a partir do repositório").
//
// Uso, no host que tem o .env do TOM:
//   node scripts/e2e-task-to-habit.js
//
// Segurança: opera SOMENTE no colaborador de fachada "Admin" (telefone 00000000000, não
// recebe WhatsApp) e em linhas com título prefixado ZZ-E2E-, criadas e removidas por este
// script. Não toca em dado de pessoa real. O cleanup roda mesmo se um cenário explodir.
//
// Cenários:
//   1. caminho feliz — converte, encerra a série, mede antes/depois
//   2. A1 — encerramento GRAVA e a releitura cai: não pode destruir o lembrete
//   3. A2 — lembrete inativo no mesmo horário: precisa ficar ATIVO no fim
//   4. A3 — hábito de mesmo nome com calendário diferente: conflito, sem tocar em nada
'use strict';
const fs = require('fs');

const ROOT = '/opt/LA-Organizer';
if (!process.env.SUPABASE_URL) {
  for (const line of fs.readFileSync(`${ROOT}/.env`, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
const sb = require(`${ROOT}/src/supabase/client`);
const { convertTaskToHabit, renderConversionResult } = require(`${ROOT}/src/services/task-to-habit`);

const ADMIN = '345c84cd-957d-4ca7-b49f-c799e094f62b';
const PREFIX = `ZZ-E2E-${Date.now()}`;
const criadas = { tasks: [], habits: [] };
let falhas = 0;

const check = (label, cond, detail) => {
  if (!cond) falhas++;
  console.log(`  ${cond ? 'OK  ' : 'FALHOU'} ${label}${detail !== undefined ? ` — ${detail}` : ''}`);
};

async function novaSerie(titulo, rrule) {
  const { data: tpl, error } = await sb.from('tasks').insert({
    title: titulo, assigned_to: ADMIN, created_by: ADMIN, status: 'pending',
    recurrence_rule: rrule, due_date: '2026-08-03', data_classification: 'test',
  }).select('id').single();
  if (error) throw new Error(`criar molde: ${error.message}`);
  criadas.tasks.push(tpl.id);
  for (let i = 0; i < 2; i++) {
    const { data: inst } = await sb.from('tasks').insert({
      title: titulo, assigned_to: ADMIN, created_by: ADMIN, status: 'pending',
      recurrence_parent_id: tpl.id, due_date: '2026-08-04', data_classification: 'test',
    }).select('id').single();
    if (inst) criadas.tasks.push(inst.id);
  }
  return tpl.id;
}

async function novoHabito(nome, frequency, customDays, reminder) {
  const { data: h, error } = await sb.from('habits').insert({
    collaborator_id: ADMIN, name: nome, icon: '⏰', color: '#3B82F6',
    frequency, custom_days: customDays, notify_whatsapp: true, is_active: true,
    current_streak: 0, best_streak: 0, habit_type: 'binary',
  }).select('id').single();
  if (error) throw new Error(`criar hábito: ${error.message}`);
  criadas.habits.push(h.id);
  if (reminder) {
    await sb.from('habit_reminders').insert([{ habit_id: h.id, time: reminder.time, is_active: reminder.is_active }]);
  }
  return h.id;
}

const estadoSerie = async (tplId) => {
  const { data: t } = await sb.from('tasks')
    .select('id, status, series_ended_at').or(`id.eq.${tplId},recurrence_parent_id.eq.${tplId}`);
  return {
    abertas: (t || []).filter((x) => !['done', 'cancelled'].includes(x.status)).length,
    encerrada: (t || []).some((x) => x.id === tplId && x.series_ended_at),
  };
};

const lembretes = async (habitId) => {
  const { data } = await sb.from('habit_reminders').select('id, time, is_active').eq('habit_id', habitId);
  return data || [];
};

/** supabase com o encerramento sabotado: responde sucesso e não escreve (falha silenciosa). */
const semEncerrar = (base) => ({
  from(table) {
    const b = base.from(table);
    if (table !== 'tasks') return b;
    const orig = b.update.bind(b);
    b.update = (patch) => {
      if (!('series_ended_at' in patch) && patch.status !== 'cancelled') return orig(patch);
      const noop = { eq: () => noop, is: () => noop, not: () => noop, in: () => noop,
        select: () => Promise.resolve({ data: [], error: null }),
        then: (res) => Promise.resolve({ data: [], error: null }).then(res) };
      return noop;
    };
    return b;
  },
});

/** supabase que ENCERRA de verdade, mas derruba toda leitura de tasks depois disso (A1). */
const leituraCaiDepois = (base) => {
  let encerrou = false;
  return {
    from(table) {
      const b = base.from(table);
      if (table !== 'tasks') return b;
      const origUpdate = b.update.bind(b);
      const origSelect = b.select.bind(b);
      b.update = (patch) => { if ('series_ended_at' in patch) encerrou = true; return origUpdate(patch); };
      b.select = (cols) => {
        if (!encerrou) return origSelect(cols);
        const err = { data: null, error: { message: 'leitura indisponível (simulada)' } };
        const noop = { eq: () => noop, is: () => noop, not: () => noop, in: () => noop, or: () => noop,
          order: () => noop, limit: () => noop,
          maybeSingle: () => Promise.resolve(err), single: () => Promise.resolve(err),
          then: (res) => Promise.resolve(err).then(res) };
        return noop;
      };
      return b;
    },
  };
};

async function cenario1() {
  console.log('\n[1] caminho feliz');
  const titulo = `${PREFIX} feliz`;
  const tpl = await novaSerie(titulo, 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR');
  const antes = await estadoSerie(tpl);
  const r = await convertTaskToHabit({ supabase: sb, collaboratorId: ADMIN, taskTitle: titulo, reminderTime: '8:30' });
  if (r.habit) criadas.habits.push(r.habit.id);
  const depois = await estadoSerie(tpl);
  const rem = r.habit ? await lembretes(r.habit.id) : [];
  console.log('  ' + renderConversionResult(r));
  check('converteu', r.ok === true, r.reason);
  check('calendário = seg-sex', r.ok && r.habit.frequency === 'weekdays');
  check('horário normalizado 08:30 e ATIVO', rem.length === 1 && rem[0].time.slice(0, 5) === '08:30' && rem[0].is_active === true);
  check('série encerrada', depois.encerrada === true);
  check('0 tarefas cobráveis', depois.abertas === 0, `${antes.abertas} → ${depois.abertas}`);
  check('medição bate com o banco', r.ok && r.before.serieAberta === antes.abertas && r.after.serieAberta === 0);
}

async function cenario2() {
  console.log('\n[2] A1 — encerramento grava, releitura cai');
  const titulo = `${PREFIX} a1`;
  const tpl = await novaSerie(titulo, 'FREQ=DAILY');
  const r = await convertTaskToHabit({
    supabase: leituraCaiDepois(sb), collaboratorId: ADMIN, taskTitle: titulo, reminderTime: '09:00',
  });
  if (r.habit) criadas.habits.push(r.habit.id);
  const depois = await estadoSerie(tpl);
  const rem = r.habit ? await lembretes(r.habit.id) : [];
  console.log('  ' + renderConversionResult(r));
  check('não declarou sucesso', r.ok === false, r.reason);
  check('motivo = verification_unavailable', r.reason === 'verification_unavailable');
  check('série FOI encerrada de fato', depois.encerrada === true);
  check('lembrete PRESERVADO (não destruiu com série já encerrada)', rem.filter((x) => x.is_active).length === 1);
  check('não afirmou conversão nem prometeu desfeito',
    !/virou lembrete/i.test(renderConversionResult(r)) && /não desfiz/i.test(renderConversionResult(r)));
}

async function cenario3() {
  console.log('\n[3] A2 — lembrete inativo no mesmo horário');
  const titulo = `${PREFIX} a2`;
  const tpl = await novaSerie(titulo, 'FREQ=DAILY');
  const hid = await novoHabito(titulo, 'daily', null, { time: '09:00', is_active: false });
  const r = await convertTaskToHabit({ supabase: sb, collaboratorId: ADMIN, taskTitle: titulo, reminderTime: '09:00' });
  const rem = await lembretes(hid);
  const depois = await estadoSerie(tpl);
  console.log('  ' + renderConversionResult(r));
  check('converteu reusando o hábito', r.ok === true && r.reusedHabit === true, r.reason);
  check('existe lembrete ATIVO às 09:00', rem.filter((x) => x.is_active && x.time.slice(0, 5) === '09:00').length === 1,
    JSON.stringify(rem.map((x) => ({ t: x.time, a: x.is_active }))));
  check('não criou duplicata', rem.length === 1);
  check('série encerrada só com lembrete ativo', depois.encerrada === true);
}

async function cenario4() {
  console.log('\n[4] A3 — hábito de mesmo nome com calendário diferente');
  const titulo = `${PREFIX} a3`;
  const tpl = await novaSerie(titulo, 'FREQ=WEEKLY;BYDAY=MO');       // tarefa: só segunda
  const hid = await novoHabito(titulo, 'daily', null, { time: '09:00', is_active: true }); // hábito: todo dia
  const r = await convertTaskToHabit({ supabase: sb, collaboratorId: ADMIN, taskTitle: titulo });
  const depois = await estadoSerie(tpl);
  const rem = await lembretes(hid);
  const txt = renderConversionResult(r);
  console.log('  ' + txt);
  check('não converteu em silêncio', r.ok === false, r.reason);
  check('motivo = habit_conflict', r.reason === 'habit_conflict');
  check('NÃO encerrou a série', depois.encerrada === false && depois.abertas === 3);
  check('não mexeu no hábito existente', rem.length === 1 && rem[0].is_active === true);
  check('texto mostra os DOIS calendários', /todo dia/.test(txt) && /toda segunda/.test(txt));
}

async function cenario5() {
  console.log('\n[5] A3/rodada 2 — o conflito precisa RESOLVER na resposta seguinte');
  // keep_habit: a pessoa quer o lembrete como está
  const tk = `${PREFIX} keep`;
  const tplK = await novaSerie(tk, 'FREQ=WEEKLY;BYDAY=MO');
  const hk = await novoHabito(tk, 'daily', null, { time: '09:00', is_active: true });
  const rk = await convertTaskToHabit({ supabase: sb, collaboratorId: ADMIN, taskTitle: tk, onConflict: 'keep_habit' });
  const { data: hkAfter } = await sb.from('habits').select('frequency, custom_days').eq('id', hk).single();
  const ek = await estadoSerie(tplK);
  console.log('  keep_habit → ' + renderConversionResult(rk));
  check('keep_habit converteu', rk.ok === true, rk.reason);
  check('keep_habit NÃO mexeu no calendário do lembrete', hkAfter.frequency === 'daily' && hkAfter.custom_days === null);
  check('keep_habit encerrou a série', ek.encerrada === true && ek.abertas === 0);
  check('keep_habit descreve o calendário mantido', /todo dia/.test(renderConversionResult(rk)));

  // adjust_habit: a pessoa quer o lembrete no calendário da rotina
  const ta = `${PREFIX} adjust`;
  const tplA = await novaSerie(ta, 'FREQ=WEEKLY;BYDAY=MO');
  const ha = await novoHabito(ta, 'daily', null, { time: '09:00', is_active: true });
  const ra = await convertTaskToHabit({ supabase: sb, collaboratorId: ADMIN, taskTitle: ta, onConflict: 'adjust_habit' });
  const { data: haAfter } = await sb.from('habits').select('frequency, custom_days').eq('id', ha).single();
  const ea = await estadoSerie(tplA);
  console.log('  adjust_habit → ' + renderConversionResult(ra));
  check('adjust_habit converteu', ra.ok === true, ra.reason);
  check('adjust_habit alinhou o calendário', haAfter.frequency === 'custom_days' && JSON.stringify(haAfter.custom_days) === '[1]',
    `${haAfter.frequency} ${JSON.stringify(haAfter.custom_days)}`);
  check('adjust_habit encerrou a série', ea.encerrada === true && ea.abertas === 0);

  // adjust que aborta depois: calendário volta ao original
  const tr = `${PREFIX} adjrb`;
  const tplR = await novaSerie(tr, 'FREQ=WEEKLY;BYDAY=MO');
  const hr = await novoHabito(tr, 'daily', null, { time: '09:00', is_active: true });
  const rr = await convertTaskToHabit({ supabase: semEncerrar(sb), collaboratorId: ADMIN, taskTitle: tr, onConflict: 'adjust_habit' });
  const { data: hrAfter } = await sb.from('habits').select('frequency, custom_days').eq('id', hr).single();
  const er = await estadoSerie(tplR);
  check('ajuste abortado NÃO deixa calendário alterado', hrAfter.frequency === 'daily' && hrAfter.custom_days === null,
    `${hrAfter.frequency} ${JSON.stringify(hrAfter.custom_days)}`);
  check('ajuste abortado não encerra a série', er.encerrada === false, rr.reason);
}

async function cenario6() {
  console.log('\n[6] C3 — frequência que o dispatcher não dispara (custom)');
  const titulo = `${PREFIX} c3`;
  const tpl = await novaSerie(titulo, 'FREQ=DAILY');
  const hid = await novoHabito(titulo, 'custom', [1, 2, 3, 4, 5, 6, 7], { time: '09:00', is_active: true });
  const r = await convertTaskToHabit({ supabase: sb, collaboratorId: ADMIN, taskTitle: titulo });
  const depois = await estadoSerie(tpl);
  console.log('  ' + renderConversionResult(r));
  check('não trocou a tarefa por um lembrete morto', r.ok === false && r.reason === 'habit_conflict', r.reason);
  check('série intacta', depois.encerrada === false);
  check('texto não oferece "manter" (seria manter algo que não toca)', !/mantenho o lembrete como está/.test(renderConversionResult(r)));
  // e o ajuste conserta
  const r2 = await convertTaskToHabit({ supabase: sb, collaboratorId: ADMIN, taskTitle: titulo, onConflict: 'adjust_habit' });
  const { data: hAfter } = await sb.from('habits').select('frequency').eq('id', hid).single();
  check('adjust_habit consertou a frequência morta', r2.ok === true && hAfter.frequency === 'daily', `${r2.reason} ${hAfter.frequency}`);
}

async function cleanup() {
  console.log('\n--- limpeza ---');
  const ids = [...new Set(criadas.habits)];
  for (const hid of ids) {
    await sb.from('habit_reminders').delete().eq('habit_id', hid);
    await sb.from('habits').delete().eq('id', hid);
  }
  if (criadas.tasks.length) await sb.from('tasks').delete().in('id', criadas.tasks);
  const { data: t } = await sb.from('tasks').select('id').in('id', criadas.tasks.length ? criadas.tasks : ['-']);
  const { data: h } = await sb.from('habits').select('id').eq('collaborator_id', ADMIN).like('name', `${PREFIX}%`);
  console.log(`sobrou: ${(t || []).length} tarefa(s), ${(h || []).length} hábito(s) — esperado 0 e 0`);
  if ((t || []).length || (h || []).length) falhas++;
}

(async () => {
  try {
    await cenario1();
    await cenario2();
    await cenario3();
    await cenario4();
    await cenario5();
    await cenario6();
  } catch (e) {
    console.error('ERRO:', e.message);
    falhas++;
  } finally {
    await cleanup();
    console.log(falhas === 0 ? '\n=== TODAS AS CHECAGENS PASSARAM ===' : `\n=== ${falhas} CHECAGEM(NS) FALHARAM ===`);
    process.exit(falhas ? 1 : 0);
  }
})();
