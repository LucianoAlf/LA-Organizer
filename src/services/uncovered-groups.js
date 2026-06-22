// src/services/uncovered-groups.js
// Função pura (testável) que identifica grupos com tarefas atrasadas cuja cobrança
// de atrasadas (preset 'overdue') está desligada. NÃO sabe de retroativa/done-twin:
// recebe `tasksByGroup` já SHAPED (o chamador usa queryGroupTasks do builder, fonte
// única — evita reintroduzir GROUPREPORT-DONE-TWIN-OVERDUE).
'use strict';

// Dias de atraso (>0) de due relativo a today (ambos 'YYYY-MM-DD'); hoje/futuro/sem prazo → 0.
function daysLate(dueYmd, todayYmd) {
  if (!dueYmd || !todayYmd) return 0;
  const [y1, m1, d1] = String(todayYmd).split('-').map(Number);
  const [y2, m2, d2] = String(dueYmd).split('-').map(Number);
  if ([y1, m1, d1, y2, m2, d2].some((n) => Number.isNaN(n))) return 0;
  const diff = Math.round((Date.UTC(y1, m1 - 1, d1) - Date.UTC(y2, m2 - 1, d2)) / 86400000);
  return diff > 0 ? diff : 0;
}

// groups: [{ id, name }]
// coveredGroupIds: Set<groupId> (ou array) com preset 'overdue' enabled
// tasksByGroup: Map<groupId, Array<{ due_date }>> já SHAPED (retroativa/done-twin fora)
// → { count, groups: [{ name, overdue }] } ordenado desc por overdue
function summarizeUncoveredGroups({ groups, coveredGroupIds, tasksByGroup, today, minDaysLate = 2 } = {}) {
  const covered = coveredGroupIds instanceof Set ? coveredGroupIds : new Set(coveredGroupIds || []);
  const byGroup = tasksByGroup instanceof Map ? tasksByGroup : new Map();
  const flagged = [];
  for (const g of (groups || [])) {
    if (covered.has(g.id)) continue;
    const tasks = byGroup.get(g.id) || [];
    const overdue = tasks.filter((t) => daysLate(t.due_date, today) >= minDaysLate).length;
    if (overdue > 0) flagged.push({ name: g.name, overdue });
  }
  flagged.sort((a, b) => b.overdue - a.overdue);
  return { count: flagged.length, groups: flagged };
}

module.exports = { summarizeUncoveredGroups, daysLate };
