// src/services/prefs-quiet-context.js
//
// Validação dos campos de SILÊNCIO POR CONTEXTO (work/personal) que o chat
// (PREFS_UPDATE) passa a aceitar. Razão: o PWA grava silêncio só em colunas de
// contexto (quiet_*_work / quiet_*_personal) — o global é legado. Pro chat
// refletir fielmente o que o PWA faz, ele precisa gravar essas mesmas colunas.
//
// Módulo puro (sem supabase/log) → testável isolado. O engine consome em
// parsePrefsMarker. Decisão de produto: o TOM PERGUNTA o contexto antes de
// emitir o marker; aqui só validamos o que veio.

'use strict';

const HHMM_RE = /^([01]?\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;

const CONTEXT_QUIET_TIME_FIELDS = new Set([
  'quiet_start_time_work', 'quiet_end_time_work',
  'quiet_start_time_personal', 'quiet_end_time_personal',
]);
const CONTEXT_QUIET_DAYS_FIELDS = new Set(['quiet_days_work', 'quiet_days_personal']);
const CONTEXT_QUIET_BOOL_FIELDS = new Set(['quiet_weekends_work', 'quiet_weekends_personal']);

const CONTEXT_QUIET_FIELDS = new Set([
  ...CONTEXT_QUIET_TIME_FIELDS,
  ...CONTEXT_QUIET_DAYS_FIELDS,
  ...CONTEXT_QUIET_BOOL_FIELDS,
]);

function isContextQuietField(key) {
  return CONTEXT_QUIET_FIELDS.has(key);
}

/**
 * Valida o valor de um campo de silêncio por contexto.
 * Espelha a validação dos campos globais equivalentes em engine.js.
 * @returns {{ok:true, value:any} | {ok:false, reason:string}}
 */
function validateContextQuietField(key, v) {
  if (CONTEXT_QUIET_TIME_FIELDS.has(key)) {
    if (v === null) return { ok: true, value: null }; // null = limpar o contexto
    if (typeof v === 'string' && HHMM_RE.test(v)) {
      return { ok: true, value: v.length === 5 ? v + ':00' : v };
    }
    return { ok: false, reason: 'bad_time' };
  }
  if (CONTEXT_QUIET_DAYS_FIELDS.has(key)) {
    if (Array.isArray(v) && v.every(n => Number.isInteger(n) && n >= 0 && n <= 6)) {
      return { ok: true, value: [...new Set(v)] };
    }
    return { ok: false, reason: 'bad_dow_array' };
  }
  if (CONTEXT_QUIET_BOOL_FIELDS.has(key)) {
    if (typeof v === 'boolean') return { ok: true, value: v };
    return { ok: false, reason: 'not_bool' };
  }
  return { ok: false, reason: 'unknown_field' };
}

module.exports = {
  isContextQuietField,
  validateContextQuietField,
  CONTEXT_QUIET_FIELDS,
  CONTEXT_QUIET_TIME_FIELDS,
  CONTEXT_QUIET_DAYS_FIELDS,
  CONTEXT_QUIET_BOOL_FIELDS,
};
