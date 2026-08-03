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
async function convertTaskToHabit({ supabase, collaboratorId, taskTitle, taskId, reminderTime, onConflict } = {}) {
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

  // 4.5) MEDIÇÃO ANTES — número, não impressão. Vai no retorno e no log.
  const before = await measure(supabase, collaboratorId, target.id);

  // 5) Hábito: reusar o de mesmo nome em vez de duplicar. O Arthur já tinha um hábito
  //    equivalente vivo ao lado da tarefa — duplicar daria dois lembretes do mesmo.
  //
  // ATOMICIDADE (contraponto do Alfredo, 02/08 — procede). O Supabase REST não dá
  // transação multi-statement, e `endSeries1on1` NÃO checa erro em nenhum dos 3 updates:
  // retorna {ended:true} incondicionalmente. Confiar nesse retorno era anunciar "encerrei
  // N tarefas" sem prova — a confabulação que passamos meses caçando, agora escrita por mim.
  // Como não há transação, a garantia é: escreve → RELÊ o banco → se não bateu, DESFAZ o que
  // este serviço criou e reporta. `undo` só guarda o que foi criado AQUI: hábito preexistente
  // reusado não é meu para apagar.
  const undo = { habitId: null, reminderId: null, habitPrev: null, reminderReactivatedId: null, habitSchedPrev: null };
  //
  //    C2 (Alfredo, rodada 2): esta leitura engolia o erro e seguia com habitRow=null —
  //    "não consegui ler" virava "não existe", e o serviço criava um hábito NOVO por cima
  //    de um que já existia. Erro transitório (rede/RLS) produziria duplicata permanente,
  //    e não há unique em habits(collaborator_id,name) pra segurar. Erro aqui aborta.
  let habitRow = null;
  let reusedHabit = false;
  {
    let hs = null;
    try {
      const res = await supabase
        .from('habits')
        .select('id, name, frequency, custom_days, is_active, notify_whatsapp')
        .eq('collaborator_id', collaboratorId)
        .eq('is_active', true)
        .limit(200);
      if (res.error) return { ok: false, reason: 'db_error', detail: `ler hábitos: ${res.error.message}`, before };
      hs = res.data;
    } catch (err) {
      return { ok: false, reason: 'db_error', detail: `ler hábitos: ${err.message}`, before };
    }
    const wanted = normTitle(target.title);
    habitRow = (hs || []).find((h) => normTitle(h.name) === wanted) || null;
    reusedHabit = !!habitRow;
  }

  // 5.05) A3 (Alfredo, 03/08): reusar por NOME sem olhar o calendário era desvio de produto
  //       e confabulação. Tarefa semanal de segunda + hábito diário de mesmo nome: o serviço
  //       encerrava a tarefa, mantinha o hábito diário e anunciava "toda segunda" — um
  //       calendário que não existe em lugar nenhum. Calendários diferentes agora são
  //       CONFLITO: não converte, não encerra nada, mostra os dois e devolve a decisão.
  //
  //       Rodada 2: a pergunta precisava de EXECUÇÃO do outro lado. Perguntar "mantenho ou
  //       ajusto?" sem handler é loop honesto — não corrompe dado, mas nunca resolve, e
  //       repete a armadilha de FIN-MSG-PROMETE-PREVIA (mensagem que ensina comando é
  //       contrato). `onConflict` é esse contrato: a resposta da pessoa volta como marker.
  //
  //       C3: o CHECK do banco aceita frequency='custom', mas o inSchedule() do dispatcher
  //       só trata daily/weekdays/weekly/custom_days — 'custom' cai no `return false` e o
  //       lembrete NUNCA toca. Reusar um hábito assim seria encerrar a tarefa em troca de
  //       um lembrete morto, então isso também é conflito (e `adjust_habit` conserta).
  const habitDispatchable = !habitRow || isDispatchableFrequency(habitRow.frequency);
  if (habitRow && (!habitDispatchable || !schedulesEquivalent(habitRow, sched))) {
    if (onConflict === 'adjust_habit') {
      undo.habitSchedPrev = { id: habitRow.id, frequency: habitRow.frequency, custom_days: habitRow.custom_days };
      const { error: adjErr } = await supabase.from('habits')
        .update({ frequency: sched.frequency, custom_days: sched.custom_days }).eq('id', habitRow.id);
      if (adjErr) return { ok: false, reason: 'db_error', detail: `ajustar calendário: ${adjErr.message}`, before };
      habitRow = { ...habitRow, frequency: sched.frequency, custom_days: sched.custom_days };
    } else if (onConflict !== 'keep_habit' || !habitDispatchable) {
      // 'keep_habit' não é oferecido quando o calendário atual não dispara — manter um
      // lembrete morto e encerrar a tarefa deixaria a pessoa sem nada.
      return {
        ok: false,
        reason: 'habit_conflict',
        template: { id: target.id, title: target.title },
        habitSchedule: { frequency: habitRow.frequency, custom_days: habitRow.custom_days },
        taskSchedule: { frequency: sched.frequency, custom_days: sched.custom_days },
        habitDispatchable,
        habit: { id: habitRow.id, name: habitRow.name },
        before,
      };
    }
    // 'keep_habit' com calendário disparável: segue sem tocar no hábito.
  }

  // 5.1) Hábito reusado com aviso DESLIGADO: religar é o próprio pedido da pessoa
  //      ("quero ser lembrado"). Sem isso ela ficaria sem cobrança E sem aviso — pior que
  //      antes. O estado anterior vai pro undo: se a conversão abortar, ele volta como era.
  let habitReactivated = false;
  if (habitRow && habitRow.notify_whatsapp === false) {
    undo.habitPrev = { id: habitRow.id, notify_whatsapp: habitRow.notify_whatsapp };
    const { error: upErr } = await supabase.from('habits')
      .update({ notify_whatsapp: true }).eq('id', habitRow.id);
    if (upErr) return { ok: false, reason: 'habit_not_verified', detail: `religar aviso: ${upErr.message}`, before };
    habitReactivated = true;
  }

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
    undo.habitId = created.id;
  }

  // 6) Lembrete no horário — habit_reminders é o que o dispatcher realmente lê, e ele
  //    filtra `is_active = true`.
  //
  //    A2 (Alfredo, 03/08): a busca comparava só (id, time), sem `is_active`. Uma linha
  //    INATIVA no mesmo horário bloqueava o insert E passava na verificação — série
  //    encerrada, TOM anunciando sucesso, e ninguém lembrado, porque o dispatcher ignora
  //    linha inativa. Agora: ativa no horário → nada a fazer; inativa → REATIVA (não há
  //    unique em (habit_id,time), então inserir criaria duplicata silenciosa); nenhuma → cria.
  let reminderCreated = false;
  try {
    const { data: existing } = await supabase
      .from('habit_reminders')
      .select('id, time, is_active')
      .eq('habit_id', habitRow.id)
      .limit(50);
    const noHorario = (existing || []).filter((r) => String(r.time || '').slice(0, 5) === time);
    const ativo = noHorario.find((r) => r.is_active !== false);
    const inativo = noHorario.find((r) => r.is_active === false);
    if (!ativo && inativo) {
      const { error: reErr } = await supabase.from('habit_reminders')
        .update({ is_active: true }).eq('id', inativo.id);
      if (reErr) {
        const rb = await rollback(supabase, undo);
        return { ok: false, reason: 'reminder_failed', detail: `reativar: ${reErr.message}`, rolledBack: rb, before };
      }
      undo.reminderReactivatedId = inativo.id;
      reminderCreated = true;
    } else if (!ativo) {
      const { data: rIns, error: rErr } = await supabase
        .from('habit_reminders').insert([{ habit_id: habitRow.id, time }]).select('id');
      if (rErr) {
        const rb = await rollback(supabase, undo);
        return { ok: false, reason: 'reminder_failed', detail: rErr.message, rolledBack: rb, before };
      }
      reminderCreated = true;
      undo.reminderId = (rIns && rIns[0] && rIns[0].id) || null;
    }
  } catch (err) {
    const rb = await rollback(supabase, undo);
    return { ok: false, reason: 'reminder_failed', detail: err.message, rolledBack: rb, before };
  }

  // 7) VERIFICA o lado do lembrete relendo o banco. O insert pode "passar" e o
  //    CHECK/RLS derrubar a linha — sem esta releitura, hábito mudo vira sucesso.
  const habitOk = await verifyHabitSide(supabase, habitRow.id, time);
  if (!habitOk.ok) {
    const rb = await rollback(supabase, undo);
    return { ok: false, reason: 'habit_not_verified', detail: habitOk.detail, rolledBack: rb, before };
  }

  // 8) Só agora a série morre — depois que o lembrete existe DE FATO (verificado).
  //    Invertido, uma falha deixaria a pessoa sem tarefa E sem lembrete.
  const ended = await endSeries1on1({ supabase, templateId: target.id, ownerId: collaboratorId });

  // 9) VERIFICA o encerramento relendo o banco — endSeries1on1 devolve {ended:true} mesmo
  //    quando os updates falham. Se a série não morreu, DESFAZ o lado do lembrete: melhor
  //    voltar ao estado inicial (cobrando, como antes) do que deixar meio convertido —
  //    cobrando E lembrando ao mesmo tempo, com o TOM anunciando que resolveu.
  //    A1: "não consegui ler" ≠ "não funcionou". Uma retentativa e, se ainda assim não der
  //    para saber, NÃO se destrói nada — o estado fica como está (no pior caso lembrando e
  //    cobrando, que é recuperável) e o texto diz que não deu para confirmar.
  let after = await measure(supabase, collaboratorId, target.id);
  if (!after.ok) after = await measure(supabase, collaboratorId, target.id);
  if (!after.ok) {
    console.error(`[TaskToHabit] VERIFICAÇÃO INDISPONÍVEL tpl=${String(target.id).slice(0, 8)} ` +
      `habit=${String(habitRow.id).slice(0, 8)} — encerramento não confirmado, NADA foi desfeito`);
    return {
      ok: false,
      reason: 'verification_unavailable',
      detail: 'não foi possível reler o estado da série após o encerramento',
      rolledBack: { undone: [], residue: [] },
      habit: { id: habitRow.id, name: habitRow.name || target.title },
      template: { id: target.id, title: target.title },
      before,
    };
  }
  if (!after.seriesEnded || after.serieAberta > 0) {
    const rb = await rollback(supabase, undo);
    return {
      ok: false,
      reason: 'series_end_failed',
      detail: `series_ended_at=${after.seriesEnded ? 'ok' : 'null'} instancias_abertas=${after.serieAberta}`,
      rolledBack: rb,
      template: { id: target.id, title: target.title },
      before,
      after,
    };
  }

  // A3: o calendário EFETIVO é o do hábito quando ele é reusado — é ele que dispara. Só o
  // hábito criado agora tem o calendário derivado da RRULE. Uma fonte só para o texto E
  // para o log: com `sched` no log, um `keep_habit` registrava o calendário da TAREFA
  // enquanto o lembrete tocava no do hábito — observabilidade contando outra história.
  const efetivo = (reusedHabit && habitRow.frequency)
    ? { frequency: habitRow.frequency, custom_days: habitRow.custom_days || null }
    : { frequency: sched.frequency, custom_days: sched.custom_days };

  console.log(`[TaskToHabit] convertido tpl=${String(target.id).slice(0, 8)} habit=${String(habitRow.id).slice(0, 8)} ` +
    `freq=${efetivo.frequency}${efetivo.custom_days ? JSON.stringify(efetivo.custom_days) : ''}@${time} ` +
    `reusado=${reusedHabit}${onConflict ? ` on_conflict=${onConflict}` : ''} | ${formatMeasureDelta(before, after)}`);

  return {
    ok: true,
    habit: {
      id: habitRow.id,
      name: habitRow.name || target.title,
      frequency: efetivo.frequency,
      custom_days: efetivo.custom_days,
      time,
    },
    template: { id: target.id, title: target.title },
    cancelled: (ended && ended.cancelled) || 0,
    reusedHabit,
    reminderCreated,
    timeWasDefaulted,
    before,
    after,
  };
}

/**
 * Fotografia numérica do escopo da operação — antes e depois.
 *
 * A1 (Alfredo, 03/08): esta função ENGOLIA qualquer falha e devolvia
 * `{seriesEnded:false, serieAberta:0}` — indistinguível de "encerramento não funcionou".
 * Pior: o supabase-js não LANÇA em erro de query, devolve `{data:null, error}`; como o
 * `error` era ignorado, `(kids||[]).length` virava 0 sem nem passar pelo catch. Uma
 * leitura caída depois de um encerramento BEM-SUCEDIDO levava ao rollback do hábito —
 * a pessoa ficava sem cobrança E sem lembrete. Pior que o estado inicial.
 *
 * Agora a medição é honesta: `ok:false` significa "não sei", e quem chama trata "não sei"
 * como diferente de "falhou". Nunca se destrói estado com base em leitura indisponível.
 */
async function measure(supabase, collaboratorId, templateId) {
  const out = { ok: false, serieAberta: 0, totalAberto: 0, seriesEnded: false };
  try {
    const tplR = await supabase.from('tasks')
      .select('id, series_ended_at').eq('id', templateId).maybeSingle();
    if (tplR.error) return out;
    out.seriesEnded = !!(tplR.data && tplR.data.series_ended_at);
    // Instâncias da série ainda cobráveis (+ o próprio molde, se aberto).
    const kidsR = await supabase.from('tasks')
      .select('id').eq('recurrence_parent_id', templateId).eq('assigned_to', collaboratorId)
      .not('status', 'in', '("done","cancelled")');
    if (kidsR.error) return out;
    const selfR = await supabase.from('tasks')
      .select('id').eq('id', templateId).eq('assigned_to', collaboratorId)
      .not('status', 'in', '("done","cancelled")');
    if (selfR.error) return out;
    out.serieAberta = (kidsR.data || []).length + (selfR.data || []).length;
    const allR = await supabase.from('tasks')
      .select('id').eq('assigned_to', collaboratorId).not('status', 'in', '("done","cancelled")');
    if (allR.error) return out;
    out.totalAberto = (allR.data || []).length;
    out.ok = true;
  } catch (_) { return out; }
  return out;
}

/**
 * Canoniza um calendário (de hábito ou de RRULE traduzida) num CONJUNTO de dias ISO,
 * para comparar dialetos diferentes que significam a mesma coisa: 'weekdays' e
 * 'weekly'+[1..5] são o mesmo calendário; 'daily' e custom_days [1..7] também.
 */
function scheduleDaySet(frequency, customDays) {
  const f = String(frequency || '').toLowerCase();
  if (f === 'daily') return [1, 2, 3, 4, 5, 6, 7];
  if (f === 'weekdays') return [1, 2, 3, 4, 5];
  const days = Array.isArray(customDays)
    ? [...new Set(customDays.map(Number).filter((d) => d >= 1 && d <= 7))].sort((a, b) => a - b)
    : [];
  if (days.length) return days;
  // 'weekly' sem dias cai na segunda — é o que o inSchedule() do dispatcher faz.
  if (f === 'weekly' || f === 'custom' || f === 'custom_days') return [1];
  return [];
}

// C3: frequências que o inSchedule() do dispatcher realmente trata. O CHECK do banco
// aceita 'custom' também, mas o dispatcher cai no `return false` — hábito com essa
// frequência é lembrete morto. Esta lista é o contrato REAL, não o do banco.
const DISPATCHABLE_FREQUENCIES = new Set(['daily', 'weekdays', 'weekly', 'custom_days']);

/** O dispatcher consegue disparar essa frequência? (C3) */
function isDispatchableFrequency(freq) {
  return DISPATCHABLE_FREQUENCIES.has(String(freq || '').toLowerCase());
}

/** Formata a medição pro log sem transformar "não medi" em zero. (C1) */
function formatMeasureDelta(before, after) {
  const n = (m) => (m && m.ok ? m.serieAberta : '?');
  const t = (m) => (m && m.ok ? m.totalAberto : '?');
  return `serie_aberta ${n(before)}→${n(after)} | total_cobravel ${t(before)}→${t(after)}`;
}

/** Dois calendários disparam nos mesmos dias? (A3) */
function schedulesEquivalent(a, b) {
  const sa = scheduleDaySet(a && a.frequency, a && a.custom_days);
  const sb = scheduleDaySet(b && b.frequency, b && b.custom_days);
  return sa.length > 0 && sa.length === sb.length && sa.every((d, i) => d === sb[i]);
}

/** Relê o banco e confirma que o lembrete existe DE VERDADE no horário certo. */
async function verifyHabitSide(supabase, habitId, time) {
  try {
    const { data: h } = await supabase.from('habits')
      .select('id, is_active, notify_whatsapp').eq('id', habitId).maybeSingle();
    if (!h) return { ok: false, detail: 'hábito não encontrado após criar' };
    if (!h.is_active || !h.notify_whatsapp) return { ok: false, detail: 'hábito inativo ou sem notificação' };
    const { data: rem } = await supabase.from('habit_reminders')
      .select('id, time, is_active').eq('habit_id', habitId);
    // A2: só conta lembrete ATIVO — é o único que o dispatcher dispara.
    const hit = (rem || []).some((r) => String(r.time || '').slice(0, 5) === time && r.is_active !== false);
    if (!hit) return { ok: false, detail: `nenhum lembrete ATIVO gravado às ${time}` };
    return { ok: true };
  } catch (err) {
    return { ok: false, detail: err.message };
  }
}

/**
 * Desfaz SÓ o que este serviço criou nesta chamada. Hábito reusado (preexistente) e
 * lembrete que já estava lá não são tocados. Retorna o que conseguiu desfazer e o que
 * sobrou — resíduo é reportado, nunca engolido.
 */
async function rollback(supabase, undo) {
  const done = [];
  const residue = [];
  try {
    if (undo.reminderId) {
      const { error } = await supabase.from('habit_reminders').delete().eq('id', undo.reminderId);
      if (error) residue.push(`habit_reminders:${undo.reminderId}`); else done.push('lembrete');
    }
    if (undo.reminderReactivatedId) {
      // A2: lembrete que já existia e este serviço religou — volta a inativo, como estava
      const { error } = await supabase.from('habit_reminders')
        .update({ is_active: false }).eq('id', undo.reminderReactivatedId);
      if (error) residue.push(`habit_reminders.is_active:${undo.reminderReactivatedId}`);
      else done.push('lembrete reativado');
    }
    if (undo.habitId) {
      // limpa lembretes filhos antes (FK) — o hábito é novo, então são todos deste serviço
      await supabase.from('habit_reminders').delete().eq('habit_id', undo.habitId);
      const { error } = await supabase.from('habits').delete().eq('id', undo.habitId);
      if (error) residue.push(`habits:${undo.habitId}`); else done.push('hábito');
    }
    if (undo.habitSchedPrev) {
      // A3/rodada 2: calendário do hábito que este serviço ajustou — volta ao original
      const { error } = await supabase.from('habits')
        .update({ frequency: undo.habitSchedPrev.frequency, custom_days: undo.habitSchedPrev.custom_days })
        .eq('id', undo.habitSchedPrev.id);
      if (error) residue.push(`habits.schedule:${undo.habitSchedPrev.id}`);
      else done.push('calendário do hábito');
    }
    if (undo.habitPrev) {
      // hábito preexistente que este serviço religou: volta ao estado que a pessoa tinha
      const { error } = await supabase.from('habits')
        .update({ notify_whatsapp: undo.habitPrev.notify_whatsapp }).eq('id', undo.habitPrev.id);
      if (error) residue.push(`habits.notify:${undo.habitPrev.id}`); else done.push('aviso do hábito');
    }
  } catch (err) {
    residue.push(`erro:${err.message}`);
  }
  if (residue.length) console.error(`[TaskToHabit] ROLLBACK INCOMPLETO — resíduo: ${residue.join(', ')}`);
  return { undone: done, residue };
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
    // Falhas de meio-caminho: dizer o que ficou de pé, não só "deu erro". Se sobrou
    // resíduo do rollback, a pessoa precisa saber que existe algo estranho lá.
    case 'series_end_failed': {
      const sujo = r.rolledBack && r.rolledBack.residue && r.rolledBack.residue.length;
      return sujo
        ? '_criei o lembrete mas não consegui encerrar a tarefa antiga, e a limpeza também falhou — pode ser que você receba os dois hoje. Já estou de olho nisso._'
        : '_criei o lembrete mas não consegui encerrar a tarefa antiga, então desfiz pra não te deixar com os dois. Está tudo como antes — tenta de novo em instantes?_';
    }
    case 'reminder_failed':
    case 'habit_not_verified':
      return '_não consegui criar o lembrete agora, então não mexi na tua rotina — ela segue como estava. Tenta de novo em instantes?_';
    // A1: escrevi, mas não consegui reler pra confirmar. Não afirmar sucesso e não
    // prometer desfeito — dizer exatamente o que sei e o que não sei.
    case 'verification_unavailable':
      return '_criei o lembrete, mas não consegui confirmar se a tarefa antiga foi encerrada — pode ser que hoje você receba as duas coisas. Não desfiz nada; me chama que eu confiro._';
    // A3: dois calendários diferentes com o mesmo nome. Quem decide é a pessoa.
    case 'habit_conflict': {
      const doHabito = describeSchedule(r.habitSchedule && r.habitSchedule.frequency, r.habitSchedule && r.habitSchedule.custom_days);
      const daTarefa = describeSchedule(r.taskSchedule && r.taskSchedule.frequency, r.taskSchedule && r.taskSchedule.custom_days);
      const nome = (r.habit && r.habit.name) || '';
      // C3: calendário que o dispatcher não dispara — "manter" não é saída, seria trocar a
      // tarefa por um lembrete morto. Aqui só existe uma opção honesta.
      if (r.habitDispatchable === false) {
        return `_você já tem um lembrete *${nome}*, mas ele está com uma configuração que não chega a tocar. Quer que eu ajuste ele pra ${daTarefa} e encerre a tarefa?_`;
      }
      return `_você já tem um lembrete *${nome}* que toca ${doHabito}, e essa rotina é ${daTarefa}. Não quis mexer sem te perguntar: mantenho o lembrete como está e encerro a tarefa, ou ajusto o lembrete pra ${daTarefa}?_`;
    }
    default:
      return '_não consegui fazer essa conversão agora — tenta de novo em instantes._';
  }
}

module.exports = {
  convertTaskToHabit, normalizeHabitTime, normTitle, isoDowOfYmd,
  describeSchedule, renderConversionResult, formatMeasureDelta, isDispatchableFrequency,
  schedulesEquivalent, DEFAULT_TIME,
};
