'use strict';
// habit-frequency.js — canonicaliza a frequência/dias de um marker HABIT_ACTION
// de CRIAÇÃO para o dialeto ÚNICO que o dispatcher e o PWA já falam:
//   frequency ∈ {daily, weekdays, weekly, custom_days}
//   custom_days = array de inteiros ISO 1=segunda .. 7=domingo
//
// HABIT-CREATE-FREQ-CUSTOM-DAYS (Arthur 15/07): a skill mandava o LLM emitir
// frequency:"weekly" + custom_days:["tuesday",...] (STRINGS em inglês) e
// frequency:"weekends" (inexistente no CHECK). O dispatcher faz custom_days.map(Number)
// → NaN → hábito de dias-específicos NUNCA disparava no dia certo (bug silencioso).
// Aqui o ENGINE tolera qualquer dialeto do LLM e grava o canônico — sem depender de
// mexer na voz (skill habitos-pessoais.md), que é vetada sem OK do Alf.

const DAY_TOKEN_TO_INT = {
  // Inteiros como string
  '1': 1, '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7,
  // Inglês
  monday: 1, mon: 1,
  tuesday: 2, tue: 2, tues: 2,
  wednesday: 3, wed: 3,
  thursday: 4, thu: 4, thurs: 4,
  friday: 5, fri: 5,
  saturday: 6, sat: 6,
  sunday: 7, sun: 7,
  // Português
  'segunda': 1, 'segunda-feira': 1, 'seg': 1,
  'terca': 2, 'terça': 2, 'terca-feira': 2, 'terça-feira': 2, 'ter': 2,
  'quarta': 3, 'quarta-feira': 3, 'qua': 3,
  'quinta': 4, 'quinta-feira': 4, 'qui': 4,
  'sexta': 5, 'sexta-feira': 5, 'sex': 5,
  'sabado': 6, 'sábado': 6, 'sab': 6, 'sáb': 6,
  'domingo': 7, 'dom': 7,
};

// Converte um token de dia (nome en/pt, ou inteiro/string 1-7) → inteiro ISO 1..7, ou null.
function dayTokenToInt(tok) {
  if (typeof tok === 'number') return Number.isInteger(tok) && tok >= 1 && tok <= 7 ? tok : null;
  if (typeof tok === 'string') {
    const t = tok.trim().toLowerCase();
    if (Object.prototype.hasOwnProperty.call(DAY_TOKEN_TO_INT, t)) return DAY_TOKEN_TO_INT[t];
  }
  return null;
}

// Normaliza um array de tokens → inteiros únicos ordenados. Retorna [] se nenhum válido.
function normalizeCustomDays(arr) {
  if (!Array.isArray(arr)) return null;
  const ints = arr.map(dayTokenToInt).filter(d => d != null);
  return [...new Set(ints)].sort((a, b) => a - b);
}

function normalizeHabitFrequency(a) {
  if (!a || typeof a !== 'object' || a.action !== 'create') return a;

  let freq = typeof a.frequency === 'string' ? a.frequency.trim().toLowerCase() : a.frequency;
  const hadArray = Array.isArray(a.custom_days);
  let days = hadArray ? normalizeCustomDays(a.custom_days) : null; // [] se array-mas-inválido

  const isWeekend = freq === 'weekends' || freq === 'weekend' || freq === 'fim de semana';
  if (isWeekend) {
    freq = 'custom_days';
    if (!days || !days.length) days = [6, 7];
  } else if (freq === 'custom') {
    freq = 'custom_days';
  } else if (freq === 'weekly' && days && days.length) {
    // weekly + dias explícitos = hábito de dias-específicos → canoniza
    freq = 'custom_days';
  }

  // custom_days sem nenhum dia válido nunca dispararia → degrada p/ daily (seguro).
  if (freq === 'custom_days' && (!days || !days.length)) {
    freq = 'daily';
    days = null;
  }

  if (typeof freq === 'string') a.frequency = freq;
  // Grava custom_days SEMPRE como inteiro (limpa strings). Sem dias válidos → DELETA a
  // chave (nunca null: validateHabitAction dropa a ação se custom_days for não-array).
  if (hadArray || freq === 'custom_days') {
    if (days && days.length) a.custom_days = days;
    else delete a.custom_days;
  }

  return a;
}

module.exports = { normalizeHabitFrequency, dayTokenToInt };
