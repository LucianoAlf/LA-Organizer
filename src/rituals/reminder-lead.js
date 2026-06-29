'use strict';
// reminder_lead — antecedência de lembrete de tarefa com prazo (caso Fabi 29/06).
// Traduz a preferência do usuário em 2 decisões PURAS:
//   - shouldRemindEve(lead): dispara o lembrete de véspera (~18h)?
//   - briefingCutoffYmd(lead,...): até que dia o briefing matinal lista tarefas
//     (daily antecipa "vence amanhã"; senão só hoje+atrasadas).
// 'eve_and_day' é o DEFAULT global (backfill). Substitui o toggle binário notify_deadline_alerts.

const LEADS = { SAME_DAY: 'same_day', EVE_AND_DAY: 'eve_and_day', DAILY: 'daily' };
const VALID = new Set(Object.values(LEADS));

function normalizeLead(v) { return VALID.has(v) ? v : LEADS.EVE_AND_DAY; }
function shouldRemindEve(lead) { return normalizeLead(lead) !== LEADS.SAME_DAY; }
function briefingCutoffYmd(lead, todayYmd, tomorrowYmd) {
  return normalizeLead(lead) === LEADS.DAILY ? tomorrowYmd : todayYmd;
}

module.exports = { LEADS, normalizeLead, shouldRemindEve, briefingCutoffYmd };
