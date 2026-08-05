// src/services/reschedule-reminders.js
// Sprint 31.12 — ao REAGENDAR um evento, os lembretes (event_reminders) não-enviados
// precisam acompanhar o novo horário. Função PURA: desloca cada remind_at pelo MESMO
// delta (new_start - old_start), preservando o offset original (T-15min continua
// T-15min do novo horário). Caso Matheus/Bia 03/06: o reschedule mudava só o start_at
// e o lembrete velho disparava no horário antigo (cobrança fantasma "hoje").

'use strict';

/**
 * @param {Array<{id:string, remind_at:string}>} reminders — lembretes não-enviados
 * @param {string} oldStartIso — start_at ANTES do reschedule
 * @param {string} newStartIso — start_at DEPOIS do reschedule
 * @returns {Array<{id:string, remind_at:string}>} novos remind_at (ISO UTC), vazio se nada a fazer
 */
function shiftRemindersByReschedule(reminders, oldStartIso, newStartIso) {
  const oldMs = Date.parse(oldStartIso);
  const newMs = Date.parse(newStartIso);
  if (!Number.isFinite(oldMs) || !Number.isFinite(newMs)) return [];
  const delta = newMs - oldMs;
  if (delta === 0) return [];
  const out = [];
  for (const r of (reminders || [])) {
    const rm = Date.parse(r && r.remind_at);
    if (!Number.isFinite(rm)) continue;
    out.push({ id: r.id, remind_at: new Date(rm + delta).toISOString() });
  }
  return out;
}

/**
 * Sprint 31.13 (Yuri/Kinho 30/05) — versão TAREFA do shift acima.
 * Uma task tem UM `remind_at` (timestamp) e um `due_date` (date-only). Ao REAGENDAR
 * sem informar um lembrete novo, o `remind_at` antigo ficava congelado no passado —
 * o cron de lembrete (`checkReminders`) disparava no horário velho e, pior, marcava a
 * task como done (one-shot). Aqui deslocamos o `remind_at` pelo MESMO número de DIAS
 * que o due_date andou, preservando o horário do dia escolhido pelo usuário.
 *
 * @param {string} oldDueDate — due_date ANTES (YYYY-MM-DD) ou null
 * @param {string} newDueDate — due_date DEPOIS (YYYY-MM-DD)
 * @param {string} remindAtIso — remind_at atual (ISO) ou null
 * @returns {string|null} novo remind_at (ISO UTC), ou null se não há o que deslocar
 */
function shiftTaskRemindAt(oldDueDate, newDueDate, remindAtIso, nowMs) {
  if (!oldDueDate || !newDueDate || !remindAtIso) return null;
  // Datas date-only viram meia-noite UTC — delta em dias inteiros é exato.
  const oldMs = Date.parse(`${oldDueDate}T00:00:00Z`);
  const newMs = Date.parse(`${newDueDate}T00:00:00Z`);
  const remMs = Date.parse(remindAtIso);
  if (!Number.isFinite(oldMs) || !Number.isFinite(newMs) || !Number.isFinite(remMs)) return null;
  const deltaDays = Math.round((newMs - oldMs) / 86400000);
  if (deltaDays === 0) return null;
  const deslocado = remMs + deltaDays * 86400000;

  // PISO (caso Matheus, 04/08/2026) — o delta preserva a defasagem. "Finalizar inventário
  // de musicalização" tinha remind_at de 20/06 e due reagendada para 06/08: deslocar +2
  // dias deixaria o lembrete em 22/06, ainda no passado, e o cron ("remind_at <= agora?")
  // cobra na varredura seguinte — dois dias ANTES do prazo que a pessoa combinou.
  //
  // Quem cairia no passado é levado para a NOVA data mantendo a HORA que a pessoa tinha
  // (09:00 continua 09:00). Quem já estava no futuro segue o delta, intocado.
  // A guarda é sobre a NOVA data, não sobre o lembrete: reagendar para o PASSADO
  // (registrar algo retroativo) é legítimo e não deve ganhar lembrete futuro artificial.
  // O piso só protege quem foi remarcado para frente.
  const agora = Number.isFinite(nowMs) ? nowMs : Date.now();
  if (deslocado <= agora && newMs > agora) {
    const diaDoRemind = new Date(remMs).toISOString().slice(0, 10);
    const horaNoDia = remMs - Date.parse(`${diaDoRemind}T00:00:00Z`);
    return new Date(newMs + horaNoDia).toISOString();
  }
  return new Date(deslocado).toISOString();
}

/**
 * Snooze/silêncio de lembrete POR TAREFA (item #5 audit 15/06, caso Jereh).
 * Função PURA: dado o conjunto de lembretes pendentes de UMA tarefa e um piso de horário
 * (notBefore), decide o que silenciar, se precisa garantir 1 lembrete no piso, e como
 * ajustar o remind_at one-shot da própria task. Semântica = PISO: limpa só o ANTERIOR ao
 * piso; mantém a grade posterior. Sem I/O — o caller aplica o plano.
 *
 * @param {Object} p
 * @param {Array<{id:string,remind_at:string,label?:string}>} p.pendingRows — task_reminders com sent_at IS NULL
 * @param {string|null} p.taskRemindAt   — tasks.remind_at (one-shot) ou null
 * @param {string|null} p.taskRemindedAt — tasks.reminded_at ou null (preenchido = one-shot já disparou)
 * @param {string|null} p.notBefore      — piso ISO 8601 com timezone (null quando clearAll)
 * @param {boolean} p.clearAll           — true = silenciar TODOS os pendentes (sem ensure-one)
 * @param {number} p.nowMs               — Date.now() do caller (injetado p/ função ficar pura)
 * @returns {{consumeReminderIds:string[], insertReminder:{remind_at:string,label:string|null}|null, taskPatch:{remind_at:string|null}|null}}
 */
function planReminderFloor({ pendingRows, taskRemindAt, taskRemindedAt, notBefore, clearAll, nowMs }) {
  const rows = Array.isArray(pendingRows) ? pendingRows : [];
  const out = { consumeReminderIds: [], insertReminder: null, taskPatch: null };

  // Modo "silenciar tudo": consome todos os pendentes e remove o lembrete one-shot
  // (se ainda não disparou). Sem ensure-one.
  if (clearAll || !notBefore) {
    out.consumeReminderIds = rows.map((r) => r.id);
    if (taskRemindAt && !taskRemindedAt) out.taskPatch = { remind_at: null };
    return out;
  }

  const floorMs = Date.parse(notBefore);
  if (!Number.isFinite(floorMs)) return out; // piso inválido → no-op defensivo

  // 1) PISO na grade: consome os rows ANTERIORES ao piso; mantém os >= piso.
  let coveredAtOrAfter = false;
  let labelForInsert = null;
  for (const r of rows) {
    const rm = Date.parse(r && r.remind_at);
    if (!Number.isFinite(rm)) continue;
    if (rm < floorMs) {
      out.consumeReminderIds.push(r.id);
      if (labelForInsert === null && typeof r.label === 'string' && r.label) labelForInsert = r.label;
    } else {
      coveredAtOrAfter = true;
    }
  }

  // 2) PISO no one-shot (tasks.remind_at): se anterior ao piso e ainda não disparou,
  //    move pro piso (vira a cobertura). Se já é >= piso, só marca como coberto.
  if (taskRemindAt && !taskRemindedAt) {
    const trm = Date.parse(taskRemindAt);
    if (Number.isFinite(trm)) {
      if (trm < floorMs) { out.taskPatch = { remind_at: notBefore }; coveredAtOrAfter = true; }
      else coveredAtOrAfter = true;
    }
  }

  // 3) ENSURE-ONE: só quando ALGO da grade foi silenciado e nada restou cobrindo o piso,
  //    e o piso é FUTURO. Não inventa lembrete do zero (task sem lembrete → "me lembra às X"
  //    é create/reschedule, não snooze). Nunca cria no passado (evita REMINDER-STALE-PAST).
  const silencedGrid = out.consumeReminderIds.length > 0;
  if (silencedGrid && !coveredAtOrAfter && floorMs > nowMs) {
    out.insertReminder = { remind_at: notBefore, label: labelForInsert };
  }

  return out;
}

/**
 * EVENT-RESCHED-REMINDER-NOREGEN (28/06, caso Reunião ADM) — plano COMPLETO do reschedule
 * de evento. O `shiftRemindersByReschedule` sozinho só desloca lembretes NÃO-enviados; se o
 * único lembrete do evento JÁ disparou (sent_at != null) antes do reschedule, ou se não havia
 * lembrete nenhum, o evento reagendado ficava SEM lembrete pendente (o `checkEventReminders`
 * dispara na tabela event_reminders, não na coluna events.remind_at). Aqui, quando NÃO há row
 * pendente, garantimos UMA row default (T-`defaultMin` do novo start) — espelha o default do
 * CREATE (engine.js applyEventActions T-15min). PURA: o caller aplica shifts (update) + inserts.
 *
 * @param {Object} p
 * @param {Array<{id:string, remind_at:string}>} p.unsentRows — event_reminders com sent_at IS NULL
 * @param {string} p.oldStartIso — start_at ANTES do reschedule
 * @param {string} p.newStartIso — start_at DEPOIS do reschedule
 * @param {string} p.eventId     — id do evento (FK do default a inserir)
 * @param {number} [p.defaultMin=15] — minutos antes do start pro lembrete default
 * @returns {{shifts:Array<{id:string,remind_at:string}>, inserts:Array<{event_id:string,remind_at:string}>}}
 */
function planRescheduleReminders({ unsentRows, oldStartIso, newStartIso, eventId, defaultMin = 15, nowMs }) {
  const rows = Array.isArray(unsentRows) ? unsentRows : [];
  const agora = Number.isFinite(nowMs) ? nowMs : Date.now();
  const shifts = shiftRemindersByReschedule(rows, oldStartIso, newStartIso);

  // PISO (caso Matheus, 04/08/2026) — deslocar por delta preserva a defasagem: um
  // remind_at 45 dias vencido, movido +2 dias, continua 43 dias no passado, e o cron
  // ("remind_at <= agora?") cobra na varredura seguinte. O usuário foi cobrado ANTES do
  // prazo que ele mesmo combinou.
  //
  // A regra já existia em planReminderFloor, usada só no ramo de SNOOZE. Aqui ela vira o
  // mínimo necessário: quem cairia no passado é recalculado para a NOVA data, com a mesma
  // antecedência padrão. Quem já estava no futuro mantém o delta — a antecedência que a
  // pessoa escolheu é preservada.
  const newMs = Date.parse(newStartIso);
  const mins = Number(defaultMin);
  const alvoPadrao = (Number.isFinite(newMs) && Number.isFinite(mins) && mins >= 0)
    ? newMs - mins * 60_000
    : null;
  // Mesma guarda do caminho de tarefa: só protege remarcação para FRENTE. Reagendar um
  // evento para o passado é legítimo e não deve ganhar lembrete futuro inventado.
  if (alvoPadrao != null && newMs > agora) {
    for (const s of shifts) {
      if (Date.parse(s.remind_at) <= agora) s.remind_at = new Date(alvoPadrao).toISOString();
    }
  }

  let inserts = [];
  // ENSURE-PENDING: só inventa default quando NÃO havia NENHUMA row pendente. O gate é
  // `rows.length` (não `shifts.length`) — reschedule pra mesmo horário (delta 0) zera os shifts
  // mas NÃO deve criar um lembrete duplicado se já existe pendente.
  if (rows.length === 0 && eventId) {
    const newMs = Date.parse(newStartIso);
    const mins = Number(defaultMin);
    if (Number.isFinite(newMs) && Number.isFinite(mins) && mins >= 0) {
      inserts = [{ event_id: eventId, remind_at: new Date(newMs - mins * 60_000).toISOString() }];
    }
  }
  return { shifts, inserts };
}

module.exports = { shiftRemindersByReschedule, shiftTaskRemindAt, planReminderFloor, planRescheduleReminders };
