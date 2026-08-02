'use strict';
// task-to-habit.js — converte uma TAREFA RECORRENTE em LEMBRETE RECORRENTE (hábito).
//
// O problema real (Arthur, 02/08). Ele tinha 3 rotinas diárias como tarefa recorrente
// ("Verificar presenças do dia anterior", "Mensagem de feliz aniversário"). Tarefa é uma
// entidade que COBRA: num único dia (31/07) ele recebeu o briefing da manhã, 5 cobranças
// de atraso, o lembrete T-1, o fechamento do dia e o balanço de aderência — ~10 mensagens
// sobre 2 rotinas que ele já faz. O pedido dele foi "para de ser tarefa e vira lembrete".
//
// A entidade que só lembra JÁ EXISTE: `habits` + `habit_reminders`. Ela dispara no
// horário, respeita DND e quiet hours, e não tem NENHUMA superfície de cobrança —
// nem atraso, nem fechamento, nem aderência, nem relatório de líder. O que faltava era
// a ponte entre as duas. Sem a ponte o LLM improvisava: ou dizia que não dá, ou criava
// o hábito e deixava a tarefa viva — que é exatamente o estado em que o Arthur estava
// (hábito "Mensagem de aniversário para alunos" 10h + as tarefas cobrando em paralelo).
//
// DESENHO: o LLM só INTERPRETA a intenção e diz qual rotina. Tudo que é fato — achar o
// molde, traduzir o calendário, o horário, encerrar a série — é determinístico aqui.
// É o padrão do executor do financeiro (1,3% de falha vs 14% das tarefas).
//
// GARANTIA: falhou em qualquer ponto de decisão (não achou / ambíguo / recorrência sem
// equivalente) → NADA é criado e NADA é cancelado. A pessoa nunca perde a rotina por
// causa de um palpite errado.

const { rruleToHabitSchedule } = require('../utils/rrule-to-habit');
const { endSeries1on1 } = require('./recurrence-engine');

const DEFAULT_TIME = '09:00';

/** 'texto Com Acento!' → 'texto com acento' (comparação de título). */
function normTitle(s) {
  return String(s == null ? '' : s)
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Normaliza horário para 'HH:MM' com zero à esquerda — formato exigido pelo CHECK
 * `habit_reminders_time_check` ('^([01][0-9]|2[0-3]):[0-5][0-9]$'). Sem o padStart,
 * "9:00" passa no regex do engine mas o INSERT do lembrete é rejeitado pelo banco:
 * o hábito nasce mudo e o TOM ainda anuncia o horário. Retorna null se inválido.
 */
function normalizeHabitTime(t) {
  if (typeof t !== 'string') return null;
  const m = t.trim().match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (!(h >= 0 && h <= 23) || !(min >= 0 && min <= 59)) return null;
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

/** 'YYYY-MM-DD' → dia da semana ISO (1=segunda..7=domingo). Data pura, sem timezone. */
function isoDowOfYmd(ymd) {
  const m = String(ymd || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))).getUTCDay();
  return d === 0 ? 7 : d;
}

/**
 * Converte a tarefa recorrente em hábito e encerra a série.
 *
 * @param {object} p
 * @param {object} p.supabase cliente (injetado → testável)
 * @param {string} p.collaboratorId dono; o alvo SEMPRE é filtrado por ele
 * @param {string} [p.taskTitle] título dito pela pessoa (aproximado)
 * @param {string} [p.taskId] id exato, quando o LLM tem
 * @param {string} [p.reminderTime] horário pedido ('HH:MM')
 * @returns {Promise<object>} {ok, reason?, habit?, template?, cancelled?, reusedHabit?, timeWasDefaulted?, candidates?}
 */
async function convertTaskToHabit({ supabase, collaboratorId, taskTitle, taskId, reminderTime } = {}) {
  if (!supabase || !collaboratorId) return { ok: false, reason: 'missing_target' };
  const wantTitle = normTitle(taskTitle);
  if (!taskId && !wantTitle) return { ok: false, reason: 'missing_target' };

  // 1) Universo de alvos: só MOLDES vivos do próprio dono. Instância solta não é série.
  let templates;
  try {
    const { data, error } = await supabase
      .from('tasks')
      .select('id, title, recurrence_rule, due_date, due_time, status')
      .eq('assigned_to', collaboratorId)
      .not('recurrence_rule', 'is', null)
      .is('series_ended_at', null)
      .limit(200);
    if (error) return { ok: false, reason: 'db_error', detail: error.message };
    templates = data || [];
  } catch (err) {
    return { ok: false, reason: 'db_error', detail: err.message };
  }

  // 2) Resolver o alvo. id > título exato > título contido. Ambíguo NÃO chuta.
  let target = null;
  if (taskId) target = templates.find((t) => t.id === taskId) || null;
  if (!target && wantTitle) {
    const exact = templates.filter((t) => normTitle(t.title) === wantTitle);
    const pool = exact.length ? exact
      : templates.filter((t) => {
        const n = normTitle(t.title);
        return n.includes(wantTitle) || wantTitle.includes(n);
      });
    if (pool.length > 1) {
      return { ok: false, reason: 'ambiguous', candidates: pool.map((t) => ({ id: t.id, title: t.title })) };
    }
    target = pool[0] || null;
  }
  if (!target) return { ok: false, reason: 'not_found' };

  // 3) Calendário — traduzido da RRULE, nunca do que o LLM achou que era.
  const sched = rruleToHabitSchedule(target.recurrence_rule, { anchorDow: isoDowOfYmd(target.due_date) });
  if (!sched) {
    return { ok: false, reason: 'unsupported_recurrence', template: { id: target.id, title: target.title }, rule: target.recurrence_rule };
  }

  // 4) Horário: pedido > da tarefa > default explícito (a resposta avisa que foi default).
  const asked = normalizeHabitTime(reminderTime);
  const fromTask = normalizeHabitTime(target.due_time);
  const time = asked || fromTask || DEFAULT_TIME;
  const timeWasDefaulted = !asked && !fromTask;

  // 5) Hábito: reusar o de mesmo nome em vez de duplicar. O Arthur já tinha um hábito
  //    equivalente vivo ao lado da tarefa — duplicar daria dois lembretes do mesmo.
  let habitRow = null;
  let reusedHabit = false;
  try {
    const { data: hs } = await supabase
      .from('habits')
      .select('id, name, frequency, custom_days, is_active')
      .eq('collaborator_id', collaboratorId)
      .eq('is_active', true)
      .limit(200);
    const wanted = normTitle(target.title);
    habitRow = (hs || []).find((h) => normTitle(h.name) === wanted) || null;
    reusedHabit = !!habitRow;
  } catch (_) { /* sem hábito prévio → cria */ }

  if (!habitRow) {
    const { data: created, error: cErr } = await supabase
      .from('habits')
      .insert({
        collaborator_id: collaboratorId,
        name: String(target.title || '').trim().slice(0, 200),
        icon: '⏰',
        color: '#3B82F6',
        frequency: sched.frequency,
        custom_days: sched.custom_days,
        reminder_time: `${time}:00`,
        notify_whatsapp: true,
        is_active: true,
        current_streak: 0,
        best_streak: 0,
        habit_type: 'binary',
      })
      .select('id, name')
      .single();
    if (cErr || !created) return { ok: false, reason: 'db_error', detail: cErr ? cErr.message : 'habit insert vazio' };
    habitRow = created;
  }

  // 6) Lembrete no horário — habit_reminders é o que o dispatcher realmente lê.
  let reminderCreated = false;
  try {
    const { data: existing } = await supabase
      .from('habit_reminders')
      .select('id, time')
      .eq('habit_id', habitRow.id)
      .limit(50);
    const has = (existing || []).some((r) => String(r.time || '').slice(0, 5) === time);
    if (!has) {
      const { error: rErr } = await supabase.from('habit_reminders').insert([{ habit_id: habitRow.id, time }]);
      if (rErr) return { ok: false, reason: 'reminder_failed', detail: rErr.message, habit: { id: habitRow.id } };
      reminderCreated = true;
    }
  } catch (err) {
    return { ok: false, reason: 'reminder_failed', detail: err.message, habit: { id: habitRow.id } };
  }

  // 7) Só agora a série morre — depois que o lembrete existe de fato. A ordem importa:
  //    se invertesse e o hábito falhasse, a pessoa ficaria sem tarefa E sem lembrete.
  const ended = await endSeries1on1({ supabase, templateId: target.id, ownerId: collaboratorId });

  return {
    ok: true,
    habit: {
      id: habitRow.id,
      name: habitRow.name || target.title,
      frequency: sched.frequency,
      custom_days: sched.custom_days,
      time,
    },
    template: { id: target.id, title: target.title },
    cancelled: (ended && ended.cancelled) || 0,
    reusedHabit,
    reminderCreated,
    timeWasDefaulted,
  };
}

const DOW_ABBR = { 1: 'seg', 2: 'ter', 3: 'qua', 4: 'qui', 5: 'sex', 6: 'sáb', 7: 'dom' };
// Um dia só ganha nome inteiro e artigo certo — "toda seg" soa a formulário.
const DOW_SINGLE = {
  1: 'toda segunda', 2: 'toda terça', 3: 'toda quarta', 4: 'toda quinta',
  5: 'toda sexta', 6: 'todo sábado', 7: 'todo domingo',
};

/**
 * Descreve o calendário do hábito em português, a partir do que FOI GRAVADO.
 * Existe para o texto nunca divergir do banco: o LLM escreve a resposta dele, mas
 * o dia/horário sai daqui. Sem isso, "todo dia às 8h" convive com seg-sáb 09:00
 * gravado — a confabulação exata que a Camada 1 passa o dia inteiro caçando.
 */
function describeSchedule(frequency, customDays) {
  if (frequency === 'daily') return 'todo dia';
  if (frequency === 'weekdays') return 'de segunda a sexta';
  const days = Array.isArray(customDays) ? [...new Set(customDays)].filter((d) => DOW_ABBR[d]).sort((a, b) => a - b) : [];
  if (!days.length) return '';
  if (days.length === 1) return DOW_SINGLE[days[0]];
  // Sequência contínua vira intervalo ("seg a sáb"); salteada vira lista ("seg, qua e sex").
  const contiguous = days.every((d, i) => i === 0 || d === days[i - 1] + 1);
  if (contiguous) return `de ${DOW_ABBR[days[0]]} a ${DOW_ABBR[days[days.length - 1]]}`;
  const labels = days.map((d) => DOW_ABBR[d]);
  return `${labels.slice(0, -1).join(', ')} e ${labels[labels.length - 1]}`;
}

/**
 * Rodapé factual da conversão — sai do RESULTADO, não do que o LLM achou que fez.
 * Mesmo padrão do progressFooters do hábito e do renderChecklistBlock: a voz do TOM
 * fica no texto dele; o fato (dias, horário, o que foi encerrado) vem daqui.
 * @param {object} r retorno de convertTaskToHabit
 * @returns {string} linha pronta pra anexar na resposta (vazio = não anexa nada)
 */
function renderConversionResult(r) {
  if (!r || typeof r !== 'object') return '';
  if (r.ok) {
    const quando = describeSchedule(r.habit.frequency, r.habit.custom_days);
    const partes = [`_⏰ *${r.habit.name}* virou lembrete: ${quando} às ${r.habit.time}.`];
    if (r.timeWasDefaulted) partes.push('(horário padrão — me diz outro se preferir)');
    partes.push('Não te cobro mais essa, só te lembro.');
    if (r.cancelled > 0) partes.push(`Encerrei as ${r.cancelled} tarefas em aberto dessa rotina.`);
    return `${partes.join(' ')}_`;
  }
  switch (r.reason) {
    case 'not_found':
      return '_não achei essa rotina recorrente no teu nome pra virar lembrete — me diz o nome exato dela?_';
    case 'ambiguous': {
      const nomes = (r.candidates || []).map((c) => `*${c.title}*`).join(' / ');
      return `_tenho mais de uma rotina com esse nome (${nomes}) — qual delas?_`;
    }
    case 'unsupported_recurrence':
      return '_essa rotina não é diária nem semanal, e lembrete recorrente só faz esses dois — essa eu não consigo converter._';
    case 'missing_target':
      return '_me diz qual rotina você quer que vire lembrete._';
    default:
      return '_não consegui fazer essa conversão agora — tenta de novo em instantes._';
  }
}

module.exports = {
  convertTaskToHabit, normalizeHabitTime, normTitle, isoDowOfYmd,
  describeSchedule, renderConversionResult, DEFAULT_TIME,
};
