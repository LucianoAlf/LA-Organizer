'use strict';
// rrule-to-habit.js — traduz a RRULE de uma tarefa recorrente para o dialeto de
// agendamento que `habits` fala (frequency + custom_days ISO 1=seg..7=dom).
//
// Por que existe (Arthur, 02/08): "Verificar presenças do dia anterior" era uma tarefa
// recorrente diária. Tarefa COBRA — atraso, fechamento do dia, balanço de aderência,
// relatório do líder. Ele não queria parar de ser lembrado; queria parar de ser cobrado.
// A entidade que só lembra já existe (habits + habit_reminders, sem nenhuma superfície
// de cobrança), então converter tarefa→hábito resolve na raiz. Esta função é o pedaço
// determinístico dessa conversão: o CALENDÁRIO nunca é inferido pelo LLM.
//
// Precedente que justifica isso ser código, não prompt: HABIT-CREATE-FREQ-CUSTOM-DAYS
// (Arthur, 15/07) — o LLM emitia custom_days como strings em inglês e "weekends"
// (inexistente no CHECK); `custom_days.map(Number)` virava NaN e o hábito NUNCA
// disparava. Bug silencioso. Aqui a fonte é a RRULE que já está no banco.
//
// PRINCÍPIO: fora do alcance de `habits` (mensal, quinzenal, "1ª segunda") → retorna
// null. Null é falha HONESTA: o chamador avisa que não dá, em vez de aproximar e
// silenciar uma rotina que a pessoa achava que continuaria valendo.

// Tokens de dia do iCalendar → inteiro ISO (1=segunda .. 7=domingo), o mesmo dialeto
// de habits.custom_days e do inSchedule() do dispatcher.
const BYDAY_TO_ISO = { MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6, SU: 7 };

/** Quebra 'FREQ=WEEKLY;BYDAY=MO,TU' em { FREQ:'WEEKLY', BYDAY:'MO,TU' }. Tolera 'RRULE:' e caixa/espaços. */
function parseRule(rule) {
  const out = {};
  const raw = String(rule).trim().replace(/^RRULE:/i, '');
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i < 1) continue;
    const k = part.slice(0, i).trim().toUpperCase();
    const v = part.slice(i + 1).trim();
    if (k) out[k] = v;
  }
  return out;
}

/**
 * @param {string} rule RRULE da tarefa (tasks.recurrence_rule)
 * @param {{anchorDow?: number}} [opts] dia da semana ISO do due_date — só usado quando
 *   a regra é WEEKLY sem BYDAY (a recorrência ancora no dia da própria tarefa).
 * @returns {{frequency:'daily'|'weekdays'|'custom_days', custom_days:number[]|null}|null}
 *   null = sem equivalente em hábito (o chamador deve recusar a conversão).
 */
function rruleToHabitSchedule(rule, opts = {}) {
  if (typeof rule !== 'string' || !rule.trim()) return null;
  const p = parseRule(rule);
  const freq = String(p.FREQ || '').toUpperCase();

  // INTERVAL > 1 (dia sim/dia não, quinzenal) não existe em habits — não aproximar.
  if (p.INTERVAL != null && Number(p.INTERVAL) !== 1) return null;

  if (freq === 'DAILY') return { frequency: 'daily', custom_days: null };
  if (freq !== 'WEEKLY') return null; // MONTHLY / YEARLY / lixo

  let days = null;
  if (p.BYDAY != null && String(p.BYDAY).trim() !== '') {
    const toks = String(p.BYDAY).split(',').map((t) => t.trim().toUpperCase()).filter(Boolean);
    const ints = [];
    for (const t of toks) {
      // '1MO' (primeira segunda do mês) é posicional — hábito não tem isso.
      if (!Object.prototype.hasOwnProperty.call(BYDAY_TO_ISO, t)) return null;
      ints.push(BYDAY_TO_ISO[t]);
    }
    days = [...new Set(ints)].sort((a, b) => a - b);
  } else {
    // WEEKLY sem BYDAY: a série cai no mesmo dia da semana do due_date. Sem essa
    // âncora não dá pra saber o dia — e chutar segunda (o default do dispatcher)
    // mudaria o dia da rotina em silêncio.
    const dow = Number(opts && opts.anchorDow);
    if (!Number.isInteger(dow) || dow < 1 || dow > 7) return null;
    days = [dow];
  }

  if (!days.length) return null;
  if (days.length === 7) return { frequency: 'daily', custom_days: null };
  // seg-sex tem nome próprio no dialeto do dispatcher — usar o canônico.
  if (days.length === 5 && days.every((d, i) => d === i + 1)) {
    return { frequency: 'weekdays', custom_days: null };
  }
  return { frequency: 'custom_days', custom_days: days };
}

module.exports = { rruleToHabitSchedule };
