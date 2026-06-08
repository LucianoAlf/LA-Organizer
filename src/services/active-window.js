// src/services/active-window.js
//
// Horário-padrão de lembrete por JANELA ATIVA da pessoa.
// Quando alguém pede "me lembra amanhã" sem dar a hora, o TOM precisa de um
// horário-fallback coerente com a rotina da pessoa (Anne acorda tarde, Alf cedo).
// Aqui inferimos o "início típico do dia" a partir dos horários em que a pessoa
// realmente fala com o TOM (conversation_history, direction='inbound', 30d).
// Cold-start (pessoa nova / pouco dado) → 09h. Degrada gracioso: nunca lança.
//
// Decisão Alf 2026-06-07: Abordagem A (stat leve no contexto + LLM propõe).
// Uma janela por pessoa (sem split trabalho×pessoal). Spec:
// docs/superpowers/specs/2026-06-07-horario-fallback-lembrete-janela-ativa-design.md

'use strict';

const COLD_START_HOUR = 9;       // default global quando não há dado suficiente
const MIN_SAMPLES = 15;          // mínimo de mensagens inbound
const MIN_DISTINCT_DAYS = 5;     // em pelo menos N dias distintos
const LOOKBACK_DAYS = 30;        // janela de histórico
const START_PERCENTILE = 0.20;   // percentil ~20 = "início típico do dia"

/**
 * Função PURA. Recebe horas BRT (0-23) das mensagens inbound e devolve o
 * "início típico do dia" = percentil START_PERCENTILE das horas, arredondado
 * pra hora cheia. Retorna null se a amostra (após limpeza) for insuficiente.
 *
 * Usa percentil baixo (não mediana) de propósito: "me lembra amanhã" quer o
 * lembrete quando a pessoa COMEÇA o dia, não no meio da tarde.
 *
 * @param {number[]} hoursBrt
 * @param {{minSamples?:number}} [opts]
 * @returns {{hour:number, minute:number}|null}
 */
function computeStartHour(hoursBrt, opts = {}) {
  const minSamples = (opts && opts.minSamples != null) ? opts.minSamples : MIN_SAMPLES;
  const hours = (Array.isArray(hoursBrt) ? hoursBrt : [])
    .filter(h => Number.isInteger(h) && h >= 0 && h <= 23);
  if (hours.length < minSamples) return null;
  const sorted = hours.slice().sort((a, b) => a - b);
  const idx = Math.min(Math.floor(sorted.length * START_PERCENTILE), sorted.length - 1);
  return { hour: sorted[idx], minute: 0 };
}

/**
 * Converte ISO UTC → hora BRT (0-23) e dia YYYY-MM-DD (BRT). Usa Intl com
 * timeZone America/Sao_Paulo (cobre o offset -03:00 sem hardcode).
 * @param {string} iso
 * @returns {{hour:number|null, ymd:string|null}}
 */
function brtHourAndDay(iso) {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return { hour: null, ymd: null };
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', hour12: false,
  });
  const parts = fmt.formatToParts(new Date(ms));
  let yy = null, mm = null, dd = null, hh = null;
  for (const p of parts) {
    if (p.type === 'year') yy = p.value;
    else if (p.type === 'month') mm = p.value;
    else if (p.type === 'day') dd = p.value;
    else if (p.type === 'hour') hh = parseInt(p.value, 10);
  }
  if (hh === 24) hh = 0; // en-CA hour12:false pode emitir '24' à meia-noite
  if (yy == null || hh == null || Number.isNaN(hh)) return { hour: null, ymd: null };
  return { hour: hh, ymd: `${yy}-${mm}-${dd}` };
}

/**
 * Resolve o horário-padrão de lembrete da pessoa a partir do histórico inbound.
 * Degrada pra cold-start (09h) em QUALQUER falta de dado/erro — nunca lança.
 *
 * @param {object} supabase  cliente Supabase (injetado)
 * @param {string} collabId
 * @param {Date}   now
 * @returns {Promise<{hour:number,minute:number,confident:boolean,source:'learned'|'cold_start'}>}
 */
async function getActiveWindow(supabase, collabId, now) {
  const fallback = { hour: COLD_START_HOUR, minute: 0, confident: false, source: 'cold_start' };
  if (!supabase || !collabId) return fallback;
  const ref = (now instanceof Date && !Number.isNaN(now.getTime())) ? now : new Date();
  try {
    const sinceIso = new Date(ref.getTime() - LOOKBACK_DAYS * 86400000).toISOString();
    const { data, error } = await supabase
      .from('conversation_history')
      .select('created_at')
      .eq('collaborator_id', collabId)
      .eq('direction', 'inbound')
      .gte('created_at', sinceIso);
    if (error || !Array.isArray(data) || !data.length) return fallback;

    const hours = [];
    const days = new Set();
    for (const row of data) {
      const { hour, ymd } = brtHourAndDay(row && row.created_at);
      if (hour == null) continue;
      hours.push(hour);
      days.add(ymd);
    }
    if (hours.length < MIN_SAMPLES || days.size < MIN_DISTINCT_DAYS) return fallback;

    const res = computeStartHour(hours);
    if (!res) return fallback;
    return { hour: res.hour, minute: res.minute, confident: true, source: 'learned' };
  } catch (_e) {
    return fallback;
  }
}

module.exports = {
  computeStartHour,
  brtHourAndDay,
  getActiveWindow,
  COLD_START_HOUR,
  MIN_SAMPLES,
  MIN_DISTINCT_DAYS,
  LOOKBACK_DAYS,
};
