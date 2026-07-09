'use strict';
// habit-field-alias.js — normaliza aliases de identificação de hábito nos markers
// HABIT_ACTION. Extraído do engine (Sprint 31.6/B3 + HABIT-LOG-TITLE-ALIAS 22/06)
// para módulo puro testável — comportamento IDÊNTICO + o alias novo `habit`.
//
// HABIT-FIELD-ALIAS-HABIT (Ana Paula 08/07 21:09): o LLM emitiu o log com o campo
// `habit` ([{"action":"log","habit":"Ir para academia"}]) → schema_invalid → o "Ok"
// dela aos 2 lembretes se perdeu (o chokepoint segurou a confab e pediu de novo, mas
// a ação caiu). Mesma família de tolerância de validador (meta-padrão dos audits):
// recipient/to/name · message/body/content · until/snooze_until · title/habit_slug —
// agora `habit`, que é a forma MAIS natural de nomear o campo.
//
// Regras (as mesmas do bloco que vivia inline no engine):
//   create: title → name (se name ausente)
//   log/query_progress/delete: habit_slug > habit > title → habit_name
//     (só quando NÃO há habit_id nem habit_name — sem clobber)
function normalizeHabitAliases(a) {
  if (!a || typeof a !== 'object') return a;
  if (a.action === 'create' && !a.name && typeof a.title === 'string') a.name = a.title;
  if ((a.action === 'log' || a.action === 'query_progress' || a.action === 'delete')
      && !a.habit_id && !a.habit_name) {
    if (typeof a.habit_slug === 'string') a.habit_name = a.habit_slug.replace(/[-_]+/g, ' ').trim();
    else if (typeof a.habit === 'string') a.habit_name = a.habit;
    else if (typeof a.title === 'string') a.habit_name = a.title;
  }
  return a;
}

module.exports = { normalizeHabitAliases };
