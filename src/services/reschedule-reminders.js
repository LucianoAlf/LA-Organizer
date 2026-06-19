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
function shiftTaskRemindAt(oldDueDate, newDueDate, remindAtIso) {
  if (!oldDueDate || !newDueDate || !remindAtIso) return null;
  // Datas date-only viram meia-noite UTC — delta em dias inteiros é exato.
  const oldMs = Date.parse(`${oldDueDate}T00:00:00Z`);
  const newMs = Date.parse(`${newDueDate}T00:00:00Z`);
  const remMs = Date.parse(remindAtIso);
  if (!Number.isFinite(oldMs) || !Number.isFinite(newMs) || !Number.isFinite(remMs)) return null;
  const deltaDays = Math.round((newMs - oldMs) / 86400000);
  if (deltaDays === 0) return null;
  return new Date(remMs + deltaDays * 86400000).toISOString();
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

module.exports = { shiftRemindersByReschedule, shiftTaskRemindAt, planReminderFloor };
