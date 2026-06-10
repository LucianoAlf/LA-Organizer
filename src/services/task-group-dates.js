// src/services/task-group-dates.js
// ESPELHO de web/src/lib/taskGroupDates.ts — manter em paridade.
const pad = (n) => String(n).padStart(2, '0');
function lastDay(y, m) { return new Date(Date.UTC(y, m, 0)).getUTCDate(); }

function dayOfMonthToYmd(day, refYmd) {
  const [y, m] = refYmd.split('-').map(Number);
  return `${y}-${pad(m)}-${pad(Math.min(day, lastDay(y, m)))}`;
}

function childDueDateForCycle(childTemplateDueYmd, motherInstanceDueYmd) {
  const childDay = Number(childTemplateDueYmd.split('-')[2]);
  return dayOfMonthToYmd(childDay, motherInstanceDueYmd);
}

module.exports = { dayOfMonthToYmd, childDueDateForCycle };
