// src/utils/dates.js — Helpers de data resilientes a input ruim.
//
// Por que existe: `new Date(x).toISOString()` joga RangeError("Invalid time
// value") quando x não parseia. Em runtime, isso virava "[Queue] task err
// for XXXX: Invalid time value" sem stack — bug silencioso por mensagem.
// Esses helpers retornam null em vez de jogar.

function safeIsoDate(input) {
  if (input == null || input === '') return null;
  const d = input instanceof Date ? input : new Date(input);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

function safeDate(input) {
  if (input == null || input === '') return null;
  const d = input instanceof Date ? input : new Date(input);
  return isNaN(d.getTime()) ? null : d;
}

/**
 * Sprint 28 — Anotação de data relativa pra TOM nunca recalcular dias.
 * Recebe due_date (YYYY-MM-DD em BRT) e today (mesmo formato).
 * Retorna string tipo:
 *   "26/05 ter (HOJE)" | "27/05 qua (amanhã)" | "28/05 qui (em 2d)"
 *   "24/05 sáb (ATRASADA -2d)"
 *   "" se input inválido
 *
 * Filosofia: TOM lê o rótulo pronto. Zero aritmética mental.
 */
const _WEEKDAY_ABBR = ['dom','seg','ter','qua','qui','sex','sáb'];

function formatRelativeDate(dueDate, todayISO) {
  if (!dueDate || typeof dueDate !== 'string') return '';
  const dueYMD = dueDate.slice(0, 10);
  const todayYMD = (todayISO || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dueYMD) || !/^\d{4}-\d{2}-\d{2}$/.test(todayYMD)) return '';
  const dueD = new Date(dueYMD + 'T12:00:00.000Z');
  const todayD = new Date(todayYMD + 'T12:00:00.000Z');
  if (isNaN(dueD.getTime()) || isNaN(todayD.getTime())) return '';
  const diffDays = Math.round((dueD.getTime() - todayD.getTime()) / 86400000);
  const dd = String(dueD.getUTCDate()).padStart(2, '0');
  const mm = String(dueD.getUTCMonth() + 1).padStart(2, '0');
  const wd = _WEEKDAY_ABBR[dueD.getUTCDay()];
  let rel;
  if (diffDays === 0) rel = 'HOJE';
  else if (diffDays === 1) rel = 'amanhã';
  else if (diffDays === -1) rel = 'ATRASADA -1d';
  else if (diffDays < 0) rel = `ATRASADA ${diffDays}d`;
  else rel = `em ${diffDays}d`;
  return `${dd}/${mm} ${wd} (${rel})`;
}

/**
 * Sprint 27 — Janela de confirmação para pending_intents.
 * Retorna true se `askedAt` (ISO/Date) foi há no máximo `windowMinutes` minutos.
 * Usado pra evitar que um "sim" cru confirme uma intent stale de horas atrás
 * (bug: "sim" pra criar meta confirmou intent antiga de "cobrar o Rafinha").
 * Conservador: asked_at ausente/inválido → false (não auto-confirma).
 */
// F6 — janela ÚNICA de frescor pra confirmações curtas (engine auto-resolve, RSVP-bare,
// inbox do prompt). Mudar aqui muda em todos — fim das cópias de "20" espalhadas.
const FRESH_WINDOW_MIN = 20;

function withinConfirmWindow(askedAt, windowMinutes = FRESH_WINDOW_MIN) {
  const d = safeDate(askedAt);
  if (!d) return false;
  const ageMs = Date.now() - d.getTime();
  if (ageMs < 0) return true; // relógio/skew: trata futuro como recente
  return ageMs <= windowMinutes * 60 * 1000;
}

/**
 * Âncora temporal em BRT para o LLM nunca calcular dia-da-semana e errar.
 * Espelha o bloco do prompt do WhatsApp (system.js): "hoje + weekday" e uma
 * TABELA DE DATAS de 16 dias (weekday → data). Sem isto, o LLM resolve
 * "segunda-feira" por conta própria e erra +1 dia (caso GROUPCHAT-TASK-DUP-WEEKDAY,
 * 12/06: pediram segunda 15/06, TOM agendou 16/06).
 *
 * Tudo em America/Sao_Paulo (-03:00) — robusto à timezone do servidor e ao
 * deslocamento UTC pós-21h (ver LOCALYMD-UTC-SHIFT): o YMD de "hoje" sai via
 * Intl no fuso de SP, nunca de toISOString().slice(0,10).
 *
 * @param {Date} [now=new Date()] — instante de referência (injetável p/ teste).
 * @returns {string} bloco multilinha pronto pra colar no system prompt.
 */
const _WEEKDAY_FULL = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];

function buildBrtDateAnchor(now = new Date()) {
  const tzFmt = new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  });
  const parts = tzFmt.formatToParts(now);
  const get = (k) => (parts.find((p) => p.type === k) || {}).value;
  const todayISO = `${get('year')}-${get('month')}-${get('day')}`;
  const nowHHMM = `${get('hour')}:${get('minute')}`;
  // Âncora ao meio-dia BRT (15:00Z) — fixa o dia civil sem ambiguidade de fuso.
  const anchor = new Date(todayISO + 'T15:00:00.000Z');
  const todayWD = _WEEKDAY_FULL[anchor.getUTCDay()];

  const calParts = [];
  for (let i = 0; i <= 15; i++) {
    const d = new Date(anchor);
    d.setUTCDate(d.getUTCDate() + i);
    const dd = String(d.getUTCDate()).padStart(2, '0');
    const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
    const wd = _WEEKDAY_FULL[d.getUTCDay()];
    const tag = i === 0 ? ' (HOJE)' : i === 1 ? ' (amanhã)' : '';
    calParts.push(`${wd} ${dd}/${mm}${tag}`);
  }

  return [
    `**Data/hora agora (BRT):** ${todayISO} ${nowHHMM} (${todayWD})`,
    `**TABELA DE DATAS — Use SEMPRE esta tabela para converter dia-da-semana em data. NUNCA calcule mentalmente. "segunda" = a PRÓXIMA segunda desta tabela. Se pedirem além do último dia, pergunte a data exata.**`,
    calParts.join(' | '),
    `**Timezone para markers:** America/Sao_Paulo. Sempre ISO -03:00 em due_date/remind_at/start_at (ex.: remind_at "${todayISO}T09:00:00-03:00").`,
  ].join('\n');
}

// todayYmdSP — 'YYYY-MM-DD' de HOJE em America/Sao_Paulo, via Intl (NUNCA toISOString().slice,
// robusto ao shift UTC pós-21h — LOCALYMD-UTC-SHIFT). now injetável p/ teste.
// Usado pelo staged-reschedule (i) p/ a guarda de data-no-passado no partition.
function todayYmdSP(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now);
  const get = (k) => (parts.find((p) => p.type === k) || {}).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/**
 * Dias ÚTEIS de atraso — quantos dias úteis (domingo excluído) decorreram DESDE o
 * vencimento até hoje. Sábado CONTA (a LA dá aula sábado); só domingo é pulado.
 * Determinístico: weekday via Date.UTC sobre componentes YMD, sem fuso.
 *   businessDaysOverdue('2026-07-17'(sex), '2026-07-21'(ter)) === 3
 * @param {string} dueYmd   'YYYY-MM-DD'
 * @param {string} todayYmd 'YYYY-MM-DD'
 * @returns {number} 0 se today <= due; senão nº de dias úteis decorridos.
 */
function businessDaysOverdue(dueYmd, todayYmd) {
  const [dy, dm, dd] = String(dueYmd).split('-').map(Number);
  const [ty, tm, td] = String(todayYmd).split('-').map(Number);
  const due = Date.UTC(dy, dm - 1, dd);
  const today = Date.UTC(ty, tm - 1, td);
  if (today <= due) return 0;
  let uteis = 0;
  // Conta cada dia APÓS o vencimento até hoje (inclusive); domingo (getUTCDay===0) não soma.
  for (let t = due + 86400000; t <= today; t += 86400000) {
    if (new Date(t).getUTCDay() !== 0) uteis += 1;
  }
  return uteis;
}

module.exports = { safeIsoDate, safeDate, formatRelativeDate, withinConfirmWindow, FRESH_WINDOW_MIN, buildBrtDateAnchor, todayYmdSP, businessDaysOverdue };
